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
