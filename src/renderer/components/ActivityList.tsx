import { useEffect, useRef } from 'react'
import { cn } from '../lib/cn'
import type { AgentActivity } from '@shared/types'

export default function ActivityList({
  items,
  emptyLabel = 'Starting…',
  engineLabel,
  busy
}: {
  items: AgentActivity[]
  emptyLabel?: string
  engineLabel: string
  busy: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    function onScroll() {
      if (!el) return
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (stickRef.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [items])

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-border bg-bg/50 p-4 text-xs text-muted flex items-center gap-2">
        <span className="tb-pulse inline-block w-2 h-2 rounded-full bg-accent" />
        {emptyLabel}
      </div>
    )
  }

  // Identify the currently-running tool (last running activity) to add a spinner.
  const runningTool = [...items].reverse().find((a) => a.kind === 'tool' && a.status === 'running')

  return (
    <div
      ref={ref}
      className="rounded-md border border-border bg-bg/40 max-h-[360px] overflow-auto"
    >
      <ul className="divide-y divide-border/50">
        {items.map((a, i) => (
          <ActivityRow
            key={a.id + ':' + i}
            a={a}
            isCurrentRunning={busy && a === runningTool}
          />
        ))}
        {busy && !runningTool && (
          <li className="px-3 py-2 flex items-center gap-2 text-xs text-muted">
            <span className="tb-pulse inline-block w-2 h-2 rounded-full bg-accent" />
            {engineLabel} is thinking…
          </li>
        )}
      </ul>
    </div>
  )
}

function ActivityRow({ a, isCurrentRunning }: { a: AgentActivity; isCurrentRunning: boolean }) {
  const icon = iconFor(a)
  const tone =
    a.status === 'failed'
      ? 'text-red-400'
      : a.kind === 'final'
        ? 'text-accent'
        : a.kind === 'error'
          ? 'text-red-400'
          : 'text-text/90'

  return (
    <li className="px-3 py-2 text-[12.5px] leading-5">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-0.5 w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-sm text-[11px] font-mono',
            isCurrentRunning ? 'tb-spin text-accent' : iconColor(a)
          )}
        >
          {isCurrentRunning ? '◐' : icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn('truncate', tone)}>
            {a.kind === 'message' ? (
              <span className="text-text/85 whitespace-pre-wrap break-words block">{a.label}</span>
            ) : (
              a.label
            )}
          </div>
          {a.detail && a.kind !== 'message' && (
            <div className="text-[11px] text-muted truncate font-mono">{a.detail}</div>
          )}
        </div>
        {a.kind === 'tool' && a.status === 'done' && (
          <span className="text-green-500/80 text-xs">✓</span>
        )}
        {a.kind === 'tool' && a.status === 'failed' && (
          <span className="text-red-400 text-xs">✕</span>
        )}
      </div>
    </li>
  )
}

function iconFor(a: AgentActivity): string {
  if (a.kind === 'thinking') return '✦'
  if (a.kind === 'message') return '›'
  if (a.kind === 'final') return '★'
  if (a.kind === 'error') return '!'
  if (a.kind === 'system') return '•'
  switch (a.tool) {
    case 'Read':
      return '↧'
    case 'Write':
      return '↥'
    case 'Edit':
    case 'MultiEdit':
      return '✎'
    case 'Bash':
      return '$'
    case 'Grep':
      return '⌕'
    case 'Glob':
      return '⁂'
    case 'LS':
      return '≡'
    case 'TodoWrite':
      return '☰'
    case 'WebFetch':
      return '⤓'
    default:
      return '•'
  }
}

function iconColor(a: AgentActivity): string {
  if (a.kind === 'final') return 'text-accent'
  if (a.kind === 'error' || a.status === 'failed') return 'text-red-400'
  if (a.kind === 'tool') return 'text-accent/80'
  if (a.kind === 'message') return 'text-muted'
  if (a.kind === 'thinking') return 'text-muted'
  return 'text-muted'
}

/**
 * Reducer for incoming activities — dedupes by id so a tool that goes running→done
 * updates in place instead of producing a duplicate row.
 */
export function applyActivity(prev: AgentActivity[], next: AgentActivity): AgentActivity[] {
  const idx = prev.findIndex((p) => p.id === next.id)
  if (idx === -1) return [...prev, next]
  const copy = prev.slice()
  copy[idx] = { ...copy[idx], ...next }
  return copy
}
