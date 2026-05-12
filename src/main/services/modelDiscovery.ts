import * as pty from 'node-pty'
import { kvGetSecret, kvSetSecret } from './db'
import { getEnginePath } from './engine'
import type { Engine } from '@shared/types'

export interface DiscoveredModel {
  id: string
  label?: string
}

const CACHE_KEY_PREFIX = 'models.discovered.'
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 // 24h

interface CacheEntry {
  ts: number
  models: DiscoveredModel[]
}

function cacheKey(engine: Engine): string {
  return CACHE_KEY_PREFIX + engine
}

export function getCachedDiscoveredModels(engine: Engine): DiscoveredModel[] | null {
  const raw = kvGetSecret(cacheKey(engine))
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as CacheEntry
    if (Date.now() - obj.ts > CACHE_TTL_MS) return null
    return obj.models
  } catch {
    return null
  }
}

function setCache(engine: Engine, models: DiscoveredModel[]) {
  const entry: CacheEntry = { ts: Date.now(), models }
  kvSetSecret(cacheKey(engine), JSON.stringify(entry))
}

/**
 * Probe a CLI for its available models by spawning it in interactive mode (PTY), sending the
 * `/model` slash command, waiting for the menu output, and parsing model identifiers.
 *
 * This is best-effort — both CLIs render with ANSI codes and their menu format can change.
 * If we can't find anything, we return an empty array and the caller falls back to the
 * curated list.
 */
export async function discoverModels(engine: Engine): Promise<DiscoveredModel[]> {
  const bin = getEnginePath(engine)
  return new Promise((resolve) => {
    let buffer = ''
    let sentSlash = false
    let captureStarted = false
    let lastCaptureLen = 0
    let stableTicks = 0

    const term = pty.spawn(bin, [], {
      name: 'xterm-color',
      cols: 120,
      rows: 40,
      env: {
        ...process.env,
        NO_COLOR: '1',
        TERM: 'xterm',
        CI: '1'
      } as { [k: string]: string }
    })

    const overall = setTimeout(() => finish('timeout'), 12_000)
    const idleCheck = setInterval(() => {
      if (!captureStarted) return
      if (buffer.length === lastCaptureLen) {
        stableTicks++
        if (stableTicks >= 3) finish('idle')
      } else {
        stableTicks = 0
        lastCaptureLen = buffer.length
      }
    }, 300)

    function finish(_reason: string) {
      clearTimeout(overall)
      clearInterval(idleCheck)
      try {
        term.kill()
      } catch {
        // ignore
      }
      resolve(parseModelList(engine, buffer))
    }

    term.onData((d) => {
      buffer += d
      const clean = stripAnsi(buffer)
      if (!sentSlash) {
        // Look for some indication the TUI is ready: a prompt indicator, banner, or input box.
        // Use a permissive trigger so we send the slash quickly.
        if (/[>›❯$#]\s*$/m.test(clean) || /Welcome|ready|claude|codex/i.test(clean)) {
          sentSlash = true
          setTimeout(() => {
            try {
              term.write('/model\r')
            } catch {
              // ignore
            }
          }, 250)
        }
      } else if (!captureStarted) {
        if (/model/i.test(stripAnsi(buffer.slice(-2000)))) {
          captureStarted = true
          lastCaptureLen = buffer.length
        }
      }
    })

    term.onExit(() => finish('exit'))
  })
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, '')
}

/**
 * Parse the (ANSI-stripped) TUI output for model identifiers. We're permissive: pull anything
 * that looks like a model id and de-duplicate.
 *
 * Recognised patterns:
 *  - "claude-opus-4-1-20250805"
 *  - "claude-sonnet-4-5"
 *  - "gpt-5", "gpt-5-codex", "gpt-4.1", "o3", "o4-mini"
 *  - aliases shown in the menu: "opus", "sonnet", "haiku" (claude only)
 */
function parseModelList(engine: Engine, buffer: string): DiscoveredModel[] {
  const text = stripAnsi(buffer)
  const ids = new Set<string>()

  // Claude-style: claude-(opus|sonnet|haiku)-N-N(-DATE)? or aliases.
  const claudeRe = /\bclaude-(?:opus|sonnet|haiku)-\d+(?:-\d+)*(?:-\d{8})?\b/gi
  // Codex/OpenAI-style: gpt-X, o3, o4-mini, gpt-5-codex, gpt-4o, etc.
  const codexRe = /\b(?:gpt-[\d.]+(?:-[a-z0-9]+)*|o\d+(?:-[a-z]+)?|gpt-[0-9]+o)\b/gi
  const aliasRe = /\b(opus|sonnet|haiku)\b/gi

  if (engine === 'claude') {
    for (const m of text.match(claudeRe) ?? []) ids.add(m.toLowerCase())
    for (const m of text.match(aliasRe) ?? []) ids.add(m.toLowerCase())
  } else {
    for (const m of text.match(codexRe) ?? []) ids.add(m.toLowerCase())
  }

  // Pull adjacent label lines (best-effort): match "ID — Label" or "ID  Label" on the same line.
  const result: DiscoveredModel[] = []
  for (const id of ids) {
    const labelMatch = new RegExp(
      `${escapeRe(id)}\\s*[—\\-:|]?\\s*([A-Z][\\w \\-]{2,80})`
    ).exec(text)
    result.push({ id, label: labelMatch?.[1]?.trim() })
  }
  return result
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Convenience: discover-and-cache. Returns the freshly discovered list (may be empty).
 */
export async function refreshDiscoveredModels(engine: Engine): Promise<DiscoveredModel[]> {
  const models = await discoverModels(engine)
  setCache(engine, models)
  return models
}
