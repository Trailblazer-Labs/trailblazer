import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { EventEmitter } from 'node:events'
import * as pty from 'node-pty'
import { kvGetSecret, kvSetSecret, kvDelete } from './db'
import { setPat } from './github'

const execFileP = promisify(execFile)

export type GhEvent =
  | { type: 'code'; code: string; url: string }
  | { type: 'progress'; message: string }
  | { type: 'done'; login: string }
  | { type: 'error'; message: string }

export const ghBus = new EventEmitter()

const AUTH_MODE_KEY = 'auth.mode' // 'gh' | 'pat'

export function getAuthMode(): 'gh' | 'pat' | null {
  const v = kvGetSecret(AUTH_MODE_KEY)
  return v === 'gh' || v === 'pat' ? v : null
}

export function setAuthMode(m: 'gh' | 'pat') {
  kvSetSecret(AUTH_MODE_KEY, m)
}

export function clearAuthMode() {
  kvDelete(AUTH_MODE_KEY)
}

export async function detectGh(): Promise<{ found: boolean; path?: string; version?: string }> {
  // Try `which gh` first; if Electron's PATH is stripped, fall back to common Homebrew locations.
  const candidates: string[] = []
  try {
    const which = await execFileP('which', ['gh'])
    const p = which.stdout.trim()
    if (p) candidates.push(p)
  } catch {
    // ignore
  }
  candidates.push('/opt/homebrew/bin/gh', '/usr/local/bin/gh')
  for (const p of candidates) {
    try {
      const v = await execFileP(p, ['--version'])
      return { found: true, path: p, version: v.stdout.trim().split('\n')[0] }
    } catch {
      // try next
    }
  }
  return { found: false }
}

export async function ghAuthStatus(): Promise<{ signedIn: boolean; login?: string }> {
  try {
    const d = await detectGh()
    if (!d.found || !d.path) return { signedIn: false }
    const { stdout } = await execFileP(d.path, ['api', 'user', '--jq', '.login'])
    const login = stdout.trim()
    if (!login) return { signedIn: false }
    return { signedIn: true, login }
  } catch {
    return { signedIn: false }
  }
}

export async function ghGetToken(): Promise<string | null> {
  try {
    const d = await detectGh()
    if (!d.found || !d.path) return null
    const { stdout } = await execFileP(d.path, ['auth', 'token'])
    const t = stdout.trim()
    return t || null
  } catch {
    return null
  }
}

let activeTerm: pty.IPty | null = null

async function resolveGhPath(): Promise<string> {
  const d = await detectGh()
  return d.path || 'gh'
}

function buildEnv(): { [k: string]: string } {
  // macOS Electron may not have Homebrew bin in PATH; prepend common locations.
  const env = { ...process.env } as { [k: string]: string }
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
  const cur = env.PATH || ''
  const merged = Array.from(new Set([...extra, ...cur.split(':')])).join(':')
  env.PATH = merged
  return env
}

export async function startGhLogin(force = false) {
  cancelGhLogin()

  // If we're already signed in (and not forcing re-auth), short-circuit.
  if (!force) {
    const status = await ghAuthStatus()
    const token = await ghGetToken()
    if (status.signedIn && token) {
      setAuthMode('gh')
      setPat(token)
      ghBus.emit('event', { type: 'done', login: status.login! } as GhEvent)
      return
    }
  }

  const ghPath = await resolveGhPath()
  const args = ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']
  if (force) args.push('--force')

  // eslint-disable-next-line no-console
  console.log('[ghAuth] spawning', ghPath, args.join(' '))

  let term: pty.IPty
  try {
    term = pty.spawn(ghPath, args, {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      env: buildEnv()
    })
  } catch (e) {
    ghBus.emit('event', {
      type: 'error',
      message: `Failed to spawn gh: ${e instanceof Error ? e.message : String(e)}`
    } as GhEvent)
    return
  }
  activeTerm = term

  let codeEmitted = false
  let buffer = ''
  let pressEnterSent = false
  let yesSent = false
  let lastSize = 0
  const watchdog = setTimeout(() => {
    if (!codeEmitted) {
      ghBus.emit('event', {
        type: 'progress',
        message: 'Still waiting on gh… (open Window → Developer Tools to see raw output)'
      } as GhEvent)
    }
  }, 8000)

  term.onData((data) => {
    // Surface raw output to main-process console for debugging.
    process.stdout.write(`[gh] ${data}`)
    buffer += data
    if (buffer.length - lastSize > 4000) buffer = buffer.slice(-4000)
    lastSize = buffer.length
    const clean = buffer.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')

    if (!codeEmitted) {
      const codeMatch = clean.match(/one-time code:?\s*\*?\s*([A-Z0-9]{4}-?[A-Z0-9]{4})/i)
      const urlMatch = clean.match(/(https:\/\/github\.com\/login\/device)/)
      if (codeMatch) {
        codeEmitted = true
        ghBus.emit('event', {
          type: 'code',
          code: codeMatch[1],
          url: urlMatch ? urlMatch[1] : 'https://github.com/login/device'
        } as GhEvent)
      }
    }

    if (!pressEnterSent && /Press Enter to open/i.test(clean)) {
      pressEnterSent = true
      term.write('\r')
    }

    // Any "(Y/n)" or "(y/N)" prompt — accept default Yes.
    if (!yesSent && /\(Y\/n\)|\(y\/N\)/i.test(clean)) {
      yesSent = true
      term.write('y\r')
    }

    if (/Authentication complete/i.test(clean)) {
      ghBus.emit('event', { type: 'progress', message: 'Authentication complete' } as GhEvent)
    }
    if (/already logged in/i.test(clean)) {
      ghBus.emit('event', {
        type: 'progress',
        message: 'Already signed in — refreshing token…'
      } as GhEvent)
    }
  })

  term.onExit(async ({ exitCode }) => {
    clearTimeout(watchdog)
    activeTerm = null
    // eslint-disable-next-line no-console
    console.log('[ghAuth] gh exited with code', exitCode)
    // Even on non-zero exit, the token might already exist (e.g. "already logged in" path).
    const status = await ghAuthStatus()
    const token = await ghGetToken()
    if (status.signedIn && token) {
      setAuthMode('gh')
      setPat(token)
      ghBus.emit('event', { type: 'done', login: status.login! } as GhEvent)
      return
    }
    if (exitCode === 0) {
      ghBus.emit('event', {
        type: 'error',
        message: 'gh exited cleanly but no token was found. Run `gh auth status` in a terminal.'
      } as GhEvent)
    } else {
      ghBus.emit('event', {
        type: 'error',
        message: `gh exited with code ${exitCode}`
      } as GhEvent)
    }
  })
}

export function cancelGhLogin() {
  if (activeTerm) {
    try {
      activeTerm.kill()
    } catch {
      // ignore
    }
    activeTerm = null
  }
}

export async function ghSignOut() {
  try {
    const d = await detectGh()
    if (d.found && d.path) {
      await execFileP(d.path, ['auth', 'logout', '--hostname', 'github.com'])
    }
  } catch {
    // best effort
  }
  clearAuthMode()
}
