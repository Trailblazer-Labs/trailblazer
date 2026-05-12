import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { kvGetSecret, kvSetSecret } from './db'
import { isAutoModel } from '@shared/models'
import type { Engine, EngineDetection } from '@shared/types'

const execFileP = promisify(execFile)

export const KEY_ENGINE = 'engine.kind'
const KEY_CLAUDE_PATH = 'engine.claude.path'
const KEY_CODEX_PATH = 'engine.codex.path'

export function getEngine(): Engine | null {
  const v = kvGetSecret(KEY_ENGINE)
  return v === 'claude' || v === 'codex' ? v : null
}

export function getEnginePath(engine: Engine): string {
  const stored = kvGetSecret(engine === 'claude' ? KEY_CLAUDE_PATH : KEY_CODEX_PATH)
  return stored || (engine === 'claude' ? 'claude' : 'codex')
}

export function setEngine(args: { engine: Engine; path?: string }) {
  kvSetSecret(KEY_ENGINE, args.engine)
  if (args.path) {
    kvSetSecret(args.engine === 'claude' ? KEY_CLAUDE_PATH : KEY_CODEX_PATH, args.path)
  }
}

async function detect(bin: string): Promise<{ found: boolean; path?: string; version?: string }> {
  const candidates: string[] = []
  try {
    const which = await execFileP('which', [bin])
    const p = which.stdout.trim()
    if (p) candidates.push(p)
  } catch {
    // ignore
  }
  candidates.push(`/opt/homebrew/bin/${bin}`, `/usr/local/bin/${bin}`)

  for (const p of candidates) {
    try {
      // Use a subcommand that actually loads the native binary — `--help` of a real
      // subcommand will fail with ENOENT if the platform-specific binary is missing,
      // unlike top-level `--version` which is often handled by an npm wrapper.
      const probe = bin === 'codex' ? ['exec', '--help'] : ['--version']
      await execFileP(p, probe)
      let version: string | undefined
      try {
        const v = await execFileP(p, ['--version'])
        version = v.stdout.trim().split('\n')[0]
      } catch {
        // ignore
      }
      return { found: true, path: p, version }
    } catch {
      // try next candidate
    }
  }
  return { found: false }
}

export async function detectEngines(): Promise<EngineDetection> {
  const [claude, codex] = await Promise.all([detect('claude'), detect('codex')])
  return { claude, codex }
}

/**
 * Build CLI args for the chosen engine for a non-interactive, prompt-driven run.
 * @param mode 'read' = read-only sandbox (issue expansion); 'write' = workspace-write (resolve).
 * @param opts.resume optional session id to continue an existing conversation
 */
export function buildAgentArgs(
  engine: Engine,
  prompt: string,
  mode: 'read' | 'write',
  opts?: { resume?: string; model?: string }
): string[] {
  if (engine === 'claude') {
    // Claude Code CLI — non-interactive, streaming structured events.
    const base = [
      '-p',
      prompt,
      '--dangerously-skip-permissions',
      '--output-format',
      'stream-json',
      '--verbose'
    ]
    if (opts?.model && !isAutoModel(opts.model)) base.push('--model', opts.model)
    if (opts?.resume) base.push('--resume', opts.resume)
    return base
  }
  // Codex CLI — `codex exec` is the non-interactive entrypoint.
  const sandbox = mode === 'write' ? 'workspace-write' : 'read-only'
  const base = ['exec', '--sandbox', sandbox, '--skip-git-repo-check', '--json']
  if (opts?.model) base.push('--model', opts.model)
  if (opts?.resume) base.push('resume', opts.resume, '--')
  base.push(prompt)
  return base
}

/**
 * Spawn the agent and stream stdout/stderr through callbacks; returns final code + captured text.
 */
export function spawnAgent(
  engine: Engine,
  prompt: string,
  mode: 'read' | 'write',
  cwd: string,
  onChunk?: (stream: 'stdout' | 'stderr', chunk: string) => void,
  opts?: { resume?: string; model?: string }
) {
  const bin = getEnginePath(engine)
  const args = buildAgentArgs(engine, prompt, mode, opts)
  const proc = spawn(bin, args, {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', (b: Buffer) => {
    const s = b.toString('utf8')
    stdout += s
    onChunk?.('stdout', s)
  })
  proc.stderr.on('data', (b: Buffer) => {
    const s = b.toString('utf8')
    stderr += s
    onChunk?.('stderr', s)
  })
  proc.on('error', (e: NodeJS.ErrnoException) => {
    // Capture spawn errors (e.g., ENOENT when the platform binary is missing).
    const msg =
      e.code === 'ENOENT'
        ? `${engine} CLI binary not found at ${e.path}. Try reinstalling it (e.g. \`npm i -g @openai/${engine === 'codex' ? 'codex' : 'claude-code'}\`).`
        : `${engine} failed to start: ${e.message}`
    stderr += msg + '\n'
    onChunk?.('stderr', msg + '\n')
  })
  const done = new Promise<number>((resolve) =>
    proc.on('close', (c) => resolve(c ?? 1))
  )
  return { proc, done, getStdout: () => stdout, getStderr: () => stderr }
}
