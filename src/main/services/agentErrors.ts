import type { Engine } from '@shared/types'

export function extractAgentApiError(stdout: string): string | null {
  for (const line of stdout.trim().split('\n').reverse()) {
    const s = line.trim()
    if (!s.startsWith('{')) continue
    try {
      const ev = JSON.parse(s)
      if (ev?.error === 'rate_limit') {
        return stringResult(ev) ?? 'Agent rate limit reached.'
      }
      if (ev?.is_error || ev?.api_error_status) {
        return stringResult(ev) ?? `Agent API error${ev.api_error_status ? ` ${ev.api_error_status}` : ''}.`
      }
      if (ev?.type === 'result' && (ev?.is_error || ev?.subtype === 'error')) {
        return stringResult(ev) ?? 'Agent returned an error.'
      }
    } catch {
      // ignore non-agent JSON
    }
  }
  return null
}

export function formatAgentExitError(args: {
  engine: Engine
  code: number
  stdout: string
  stderr: string
}): string {
  const apiError = extractAgentApiError(args.stdout) ?? extractAgentApiError(args.stderr)
  if (apiError) return apiError

  const detail = firstUsefulLine(args.stderr) ?? firstUsefulLine(args.stdout)
  const label = args.engine === 'claude' ? 'Claude' : 'Codex'
  if (detail) return `${label} stopped: ${detail}`

  return `${label} stopped before returning a response (exit code ${args.code}). Run \`${args.engine}\` in a terminal to check login, subscription, or CLI setup.`
}

function stringResult(ev: any): string | null {
  if (typeof ev?.result === 'string' && ev.result.trim()) return ev.result.trim()
  const content = ev?.message?.content
  if (Array.isArray(content)) {
    const text = content
      .map((item) => (item?.type === 'text' && typeof item.text === 'string' ? item.text : ''))
      .join('\n')
      .trim()
    if (text) return text
  }
  if (typeof ev?.message === 'string' && ev.message.trim()) return ev.message.trim()
  return null
}

function firstUsefulLine(value: string): string | null {
  for (const raw of value.trim().split('\n').reverse()) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('{')) {
      try {
        const parsed = JSON.parse(line)
        const text = stringResult(parsed)
        if (text) return text
      } catch {
        // fall through to normal line handling
      }
      continue
    }
    if (/^(claude|codex) session started$/i.test(line)) continue
    if (/^model:/i.test(line)) continue
    if (/^done$/i.test(line)) continue
    return line.length > 240 ? `${line.slice(0, 237)}...` : line
  }
  return null
}
