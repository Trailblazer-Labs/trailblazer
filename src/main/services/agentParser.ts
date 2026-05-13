import { randomUUID } from 'node:crypto'
import type { AgentActivity, Engine } from '@shared/types'

export interface AgentParser {
  feed(stream: 'stdout' | 'stderr', chunk: string): AgentActivity[]
  flush(): AgentActivity[]
}

export function createParser(engine: Engine): AgentParser {
  return engine === 'claude' ? createClaudeParser() : createCodexParser()
}

// ── Claude stream-json parser ─────────────────────────────────────────────────
function createClaudeParser(): AgentParser {
  let buffer = ''
  const toolById = new Map<string, AgentActivity>()

  function consumeLine(line: string, out: AgentActivity[]) {
    const s = line.trim()
    if (!s.startsWith('{')) return
    let ev: any
    try {
      ev = JSON.parse(s)
    } catch {
      return
    }
    if (!ev || typeof ev !== 'object') return

    if (ev.type === 'system' && ev.subtype === 'init') {
      out.push({
        id: randomUUID(),
        kind: 'system',
        label: 'Claude session started',
        detail: ev.model ? `model: ${ev.model}` : undefined,
        ts: Date.now()
      })
      return
    }

    if (ev.type === 'assistant' && ev.message?.content) {
      for (const c of ev.message.content) {
        if (c.type === 'text' && c.text?.trim()) {
          out.push({
            id: randomUUID(),
            kind: 'message',
            label: c.text.trim(),
            ts: Date.now()
          })
        } else if (c.type === 'tool_use') {
          const a: AgentActivity = {
            id: c.id,
            kind: 'tool',
            tool: c.name,
            label: summarizeTool(c.name, c.input),
            detail: detailTool(c.name, c.input),
            status: 'running',
            ts: Date.now()
          }
          toolById.set(c.id, a)
          out.push(a)
        }
      }
      return
    }

    if (ev.type === 'user' && ev.message?.content) {
      for (const c of ev.message.content) {
        if (c.type === 'tool_result') {
          const a = toolById.get(c.tool_use_id)
          if (a) {
            a.status = c.is_error ? 'failed' : 'done'
            // emit an update event with same id; renderer dedupes by id
            out.push({ ...a })
          }
        }
      }
      return
    }

    if (ev.type === 'result') {
      const failed = ev.is_error || ev.error || ev.api_error_status || ev.subtype !== 'success'
      out.push({
        id: randomUUID(),
        kind: failed ? 'error' : 'final',
        label: failed && typeof ev.result === 'string' ? truncate(ev.result, 240) : 'Done',
        detail: typeof ev.result === 'string' ? truncate(ev.result, 240) : undefined,
        status: failed ? 'failed' : 'done',
        ts: Date.now()
      })
    }
  }

  return {
    feed(_stream, chunk) {
      buffer += chunk
      const out: AgentActivity[] = []
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        consumeLine(line, out)
      }
      return out
    },
    flush() {
      const out: AgentActivity[] = []
      if (buffer.trim()) consumeLine(buffer, out)
      buffer = ''
      return out
    }
  }
}

function summarizeTool(name: string, input: any): string {
  switch (name) {
    case 'Read':
      return `Read ${shorten(input?.file_path)}`
    case 'Write':
      return `Write ${shorten(input?.file_path)}`
    case 'Edit':
      return `Edit ${shorten(input?.file_path)}`
    case 'MultiEdit':
      return `Edit ${shorten(input?.file_path)}`
    case 'Bash':
      return `Bash: ${truncate(shortenInString(input?.command ?? ''), 100)}`
    case 'Grep':
      return `Grep "${truncate(input?.pattern ?? '', 50)}"`
    case 'Glob':
      return `Glob ${input?.pattern ?? ''}`
    case 'LS':
      return `List ${shorten(input?.path)}`
    case 'TodoWrite':
      return 'Update plan'
    case 'WebFetch':
      return `Fetch ${shorten(input?.url)}`
    default:
      return name
  }
}

function detailTool(name: string, input: any): string | undefined {
  if (name === 'Edit' && input?.old_string && input?.new_string) {
    return `${truncate(input.old_string, 80)} → ${truncate(input.new_string, 80)}`
  }
  if (name === 'Bash' && input?.description) {
    return input.description
  }
  return undefined
}

function shorten(p: string | undefined): string {
  if (!p) return ''
  // Strip the noisy Electron-userData prefix and surface just the workspace-relative path.
  // Features workspace: .../features/<id-slug>/<repo>/<rest>  → <repo>/<rest>
  const feat = p.match(/features\/[^/]+\/(.+)$/)
  if (feat) return feat[1]
  // Issue-resolve worktrees: .../worktrees/<id>/<rest>  → <rest>
  const wt = p.match(/worktrees\/[^/]+\/(.+)$/)
  if (wt) return wt[1]
  // Repos cache: .../repos/<owner>-<repo>/<rest>  → <rest>
  const repo = p.match(/repos\/[^/]+\/(.+)$/)
  if (repo) return repo[1]
  return p
}

/**
 * Strip the long workspace prefix from inside an arbitrary string (e.g. a Bash command
 * containing absolute paths). Preserves the workspace-relative remainder.
 *
 * Paths on macOS contain spaces ("Application Support") so we can't use \s as a delimiter
 * for the absolute prefix; use quote/newline boundaries instead.
 */
function shortenInString(s: string): string {
  if (!s) return s
  return s
    // /<anything>/features/<id-slug>/<repo>/... → <repo>/...
    .replace(/\/[^"'\n]*?\/features\/[^/"'\n]+\//g, '')
    // /<anything>/worktrees/<id>/... → <id>/...
    .replace(/\/[^"'\n]*?\/worktrees\/[^/"'\n]+\//g, '')
    // /<anything>/repos/<owner-repo>/... → <owner-repo>/...
    .replace(/\/[^"'\n]*?\/repos\/[^/"'\n]+\//g, '')
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

// ── Codex JSONL parser (`codex exec --json`) ─────────────────────────────────
function createCodexParser(): AgentParser {
  let buffer = ''
  // Track activities by event/item id so begin/end pairs collapse into a single updating row.
  const byId = new Map<string, AgentActivity>()

  function emitItem(
    out: AgentActivity[],
    type: string,
    rawItem: any,
    fallbackId: string
  ) {
    const item = rawItem ?? {}
    const itemId: string = item.id ?? fallbackId
    const itemType: string = item.item_type ?? item.type ?? ''
    const now = Date.now()
    const status: 'running' | 'done' | 'failed' =
      type === 'item.completed' || type === 'item.finished'
        ? item.success === false || item.is_error
          ? 'failed'
          : 'done'
        : 'running'

    switch (itemType) {
      case 'message':
      case 'agent_message':
      case 'assistant_message': {
        // Codex agent message — surface as a message bubble that updates in place.
        const rawText =
          item.text ??
          item.message ??
          (typeof item.content === 'string'
            ? item.content
            : Array.isArray(item.content)
              ? item.content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('')
              : '')
        const text: string = typeof rawText === 'string' ? rawText : ''
        if (!text.trim()) return
        const a: AgentActivity = {
          id: itemId,
          kind: 'message',
          label: truncate(text.trim(), 4000),
          ts: now
        }
        byId.set(itemId, a)
        out.push(a)
        return
      }

      case 'reasoning':
      case 'thinking':
      case 'agent_reasoning': {
        const text: string = item.summary ?? item.text ?? item.content ?? ''
        if (!text.trim()) return
        const a: AgentActivity = {
          id: itemId,
          kind: 'thinking',
          label: truncate(text.trim(), 240),
          ts: now
        }
        byId.set(itemId, a)
        out.push(a)
        return
      }

      case 'command_execution':
      case 'exec_command':
      case 'shell_command':
      case 'tool_call': {
        const cmdRaw = item.command ?? item.cmd ?? item.input?.command
        const cmd: string =
          typeof cmdRaw === 'string'
            ? cmdRaw
            : Array.isArray(cmdRaw)
              ? cmdRaw.join(' ')
              : item.name ?? 'command'
        const a: AgentActivity = {
          id: itemId,
          kind: 'tool',
          tool: 'Bash',
          label: `Bash: ${truncate(shortenInString(cmd), 100)}`,
          detail: item.cwd ? `cwd: ${shortenPath(item.cwd)}` : undefined,
          status,
          ts: now
        }
        byId.set(itemId, a)
        out.push(a)
        return
      }

      case 'file_change':
      case 'patch_apply':
      case 'apply_patch':
      case 'edit':
      case 'write': {
        const files = extractItemFiles(item)
        const isWrite = itemType === 'write'
        const a: AgentActivity = {
          id: itemId,
          kind: 'tool',
          tool: isWrite ? 'Write' : 'Edit',
          label:
            files.length === 1
              ? `${isWrite ? 'Write' : 'Edit'} ${shortenPath(files[0])}`
              : files.length > 1
                ? `${isWrite ? 'Write' : 'Edit'} ${files.length} files`
                : isWrite
                  ? 'Write file'
                  : 'Apply patch',
          detail: files.length > 1 ? files.map(shortenPath).join(', ') : undefined,
          status,
          ts: now
        }
        byId.set(itemId, a)
        out.push(a)
        return
      }

      case 'read':
      case 'file_read': {
        const p: string = item.path ?? item.file ?? ''
        if (!p) return
        const a: AgentActivity = {
          id: itemId,
          kind: 'tool',
          tool: 'Read',
          label: `Read ${shortenPath(p)}`,
          status,
          ts: now
        }
        byId.set(itemId, a)
        out.push(a)
        return
      }

      case 'web_search':
      case 'search': {
        const q: string = item.query ?? item.q ?? ''
        const a: AgentActivity = {
          id: itemId,
          kind: 'tool',
          tool: 'WebFetch',
          label: `Web search: ${truncate(q, 80)}`,
          status,
          ts: now
        }
        byId.set(itemId, a)
        out.push(a)
        return
      }

      default: {
        // Last resort: show whatever readable text the item carries.
        const human =
          item.label ??
          item.title ??
          item.summary ??
          item.text ??
          (typeof item.name === 'string' ? item.name : null)
        if (human) {
          out.push({
            id: itemId,
            kind: 'system',
            label: truncate(human, 200),
            status,
            ts: now
          })
        }
        // Otherwise: drop silently so we don't spam the feed.
        return
      }
    }
  }

  function consumeLine(line: string, out: AgentActivity[]) {
    const s = line.trim()
    if (!s) return
    if (!s.startsWith('{')) {
      out.push({ id: randomUUID(), kind: 'system', label: truncate(s, 120), ts: Date.now() })
      return
    }
    let ev: any
    try {
      ev = JSON.parse(s)
    } catch {
      return
    }
    if (!ev || typeof ev !== 'object') return

    const eventId: string = ev.id ?? randomUUID()
    const msg = ev.msg ?? ev
    const type: string = msg?.type ?? ev?.type ?? ''
    const now = Date.now()

    // ─── New "item" envelope (recent codex) ───────────────────────────
    if (type === 'item.started' || type === 'item.updated' || type === 'item.completed' || type === 'item.finished') {
      emitItem(out, type, msg.item ?? ev.item, eventId)
      return
    }

    // ─── Lifecycle ────────────────────────────────────────────────────
    if (type === 'thread.started' || type === 'session.started' || type === 'session_configured') {
      out.push({
        id: randomUUID(),
        kind: 'system',
        label: 'Codex session started',
        detail: msg.thread_id ? `thread: ${msg.thread_id.slice(0, 8)}` : undefined,
        ts: now
      })
      return
    }
    if (type === 'turn.started') {
      // Quiet — turn boundaries don't add value in the activity feed.
      return
    }
    if (type === 'turn.completed' || type === 'turn.finished') {
      const usage = msg.usage
      if (usage) {
        out.push({
          id: randomUUID(),
          kind: 'system',
          label: `Tokens · in ${usage.input_tokens ?? '?'} · out ${usage.output_tokens ?? '?'}`,
          ts: now
        })
      }
      out.push({ id: randomUUID(), kind: 'final', label: 'Done', status: 'done', ts: now })
      return
    }
    if (type === 'turn.failed') {
      const errMsg = msg?.error?.message ?? 'turn failed'
      out.push({ id: randomUUID(), kind: 'error', label: truncate(errMsg, 200), ts: now })
      return
    }

    // ─── Older event names still seen in the wild ────────────────────
    if (type === 'agent_message' || type === 'agent_message_delta') {
      const text = msg.message ?? msg.text ?? msg.delta ?? ''
      if (!text.trim()) return
      const prev = byId.get(eventId)
      const label = prev ? truncate((prev.label ?? '') + text, 4000) : truncate(text, 4000)
      const a: AgentActivity = { id: eventId, kind: 'message', label, ts: now }
      byId.set(eventId, a)
      out.push(a)
      return
    }
    if (type === 'agent_reasoning' || type === 'agent_reasoning_delta') {
      const text = msg.text ?? msg.delta ?? ''
      if (!text.trim()) return
      out.push({ id: eventId, kind: 'thinking', label: truncate(text.trim(), 240), ts: now })
      return
    }
    if (type === 'exec_command_begin' || type === 'exec_command_end') {
      const cmd: string =
        typeof msg.command === 'string'
          ? msg.command
          : Array.isArray(msg.command)
            ? msg.command.join(' ')
            : ''
      const a: AgentActivity = {
        id: eventId,
        kind: 'tool',
        tool: 'Bash',
        label: `Bash: ${truncate(shortenInString(cmd), 100)}`,
        detail: msg.cwd ? `cwd: ${shortenPath(msg.cwd)}` : undefined,
        status: type === 'exec_command_end' ? (msg.exit_code === 0 ? 'done' : 'failed') : 'running',
        ts: now
      }
      byId.set(eventId, a)
      out.push(a)
      return
    }
    if (type === 'patch_apply_begin' || type === 'patch_apply_end') {
      const files = filenamesFromChanges(msg.changes)
      const a: AgentActivity = {
        id: eventId,
        kind: 'tool',
        tool: 'Edit',
        label:
          files.length === 1
            ? `Edit ${shortenPath(files[0])}`
            : files.length > 1
              ? `Edit ${files.length} files`
              : 'Apply patch',
        status: type === 'patch_apply_end' ? (msg.success ? 'done' : 'failed') : 'running',
        ts: now
      }
      byId.set(eventId, a)
      out.push(a)
      return
    }

    if (type === 'error' || type === 'stream_error') {
      out.push({
        id: randomUUID(),
        kind: 'error',
        label: truncate(msg.message ?? 'error', 200),
        ts: now
      })
      return
    }

    // Unknown event — drop silently to avoid polluting the activity feed.
  }

  return {
    feed(_stream, chunk) {
      buffer += chunk
      const out: AgentActivity[] = []
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        consumeLine(line, out)
      }
      return out
    },
    flush() {
      const out: AgentActivity[] = []
      if (buffer.trim()) consumeLine(buffer, out)
      buffer = ''
      return out
    }
  }
}

/**
 * Codex events use several shapes for "what files did this touch":
 *   item.files = ["path", ...]
 *   item.files = [{ path: "..." }, ...]
 *   item.changes = ["path", ...] | [{ path: "..." }] | { "path": {...} }
 *   item.path / item.file_path / item.file / item.target = "path"
 * Pull them all into a single string[].
 */
function extractItemFiles(item: Record<string, unknown> | null | undefined): string[] {
  if (!item) return []
  const fromList = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr
          .map((c) => {
            if (typeof c === 'string') return c
            const obj = c as Record<string, unknown>
            return (
              (obj?.path as string) ??
              (obj?.file as string) ??
              (obj?.filename as string) ??
              ''
            )
          })
          .filter((s): s is string => typeof s === 'string' && s.length > 0)
      : []
  const fromFiles = fromList(item.files)
  if (fromFiles.length) return fromFiles
  const fromChanges = fromList(item.changes)
  if (fromChanges.length) return fromChanges
  if (item.changes && typeof item.changes === 'object' && !Array.isArray(item.changes)) {
    return Object.keys(item.changes as Record<string, unknown>)
  }
  const single =
    (typeof item.path === 'string' && item.path) ||
    (typeof item.file_path === 'string' && item.file_path) ||
    (typeof item.file === 'string' && item.file) ||
    (typeof item.target === 'string' && item.target) ||
    ''
  return single ? [single as string] : []
}

function filenamesFromChanges(changes: unknown): string[] {
  if (!changes) return []
  if (Array.isArray(changes)) {
    return changes
      .map((c) => {
        if (typeof c === 'string') return c
        const obj = c as Record<string, unknown>
        return (obj?.path as string) ?? (obj?.file as string) ?? ''
      })
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
  }
  if (typeof changes !== 'object') return []
  return Object.keys(changes as Record<string, unknown>)
}

function shortenPath(p: string | undefined): string {
  return shorten(p)
}
