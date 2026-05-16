import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  FilePenLine,
  FileSearch,
  ListTree,
  MessageSquareText,
  Search,
  Sparkles,
  Terminal,
  type LucideIcon
} from 'lucide-react'
import { cn } from '../lib/cn'
import type { AgentActivity } from '@shared/types'

type ActivityCategory = 'change' | 'inspect' | 'command' | 'search' | 'reasoning' | 'system' | 'error'

interface ActivityGroupModel {
  id: ActivityCategory
  label: string
  description: string
  icon: LucideIcon
  items: AgentActivity[]
}

const GROUP_META: Record<
  ActivityCategory,
  { label: string; description: string; icon: LucideIcon; chip: string }
> = {
  change: {
    label: 'Changing files',
    description: 'Writes, edits, patches, and todo updates',
    icon: FilePenLine,
    chip: 'Changes'
  },
  inspect: {
    label: 'Inspecting code',
    description: 'Reads, directory listings, and file exploration',
    icon: FileSearch,
    chip: 'Inspect'
  },
  command: {
    label: 'Commands',
    description: 'Shell and command execution',
    icon: Terminal,
    chip: 'Bash'
  },
  search: {
    label: 'Search',
    description: 'Repo search, globbing, grep, and web fetches',
    icon: Search,
    chip: 'Search'
  },
  reasoning: {
    label: 'Reasoning',
    description: 'Agent thoughts and messages',
    icon: MessageSquareText,
    chip: 'Reasoning'
  },
  system: {
    label: 'Other',
    description: 'Session, token, and system events',
    icon: ListTree,
    chip: 'Other'
  },
  error: {
    label: 'Errors',
    description: 'Failed tools and agent errors',
    icon: AlertTriangle,
    chip: 'Errors'
  }
}

const GROUP_ORDER: ActivityCategory[] = [
  'change',
  'inspect',
  'command',
  'search',
  'reasoning',
  'system',
  'error'
]

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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const visibleItems = useMemo(() => items.filter((a) => !isSessionStartActivity(a)), [items])
  const grouped = useMemo(() => groupActivities(visibleItems), [visibleItems])
  const latestRunning = useMemo(
    () => [...visibleItems].reverse().find((a) => a.status === 'running'),
    [visibleItems]
  )
  const runningCategory = latestRunning ? toolCategory(latestRunning) : null
  const hasErrors = visibleItems.some((a) => a.kind === 'error' || a.status === 'failed')

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
  }, [visibleItems])

  useEffect(() => {
    if (!busy && !hasErrors) return
    const nextOpen: Record<string, boolean> = {}
    if (busy && runningCategory) nextOpen[runningCategory] = true
    if (hasErrors) nextOpen.error = true
    if (Object.keys(nextOpen).length === 0) return
    setExpanded((prev) => ({ ...prev, ...nextOpen }))
  }, [busy, runningCategory, hasErrors])

  const prevBusyRef = useRef(busy)
  useEffect(() => {
    if (prevBusyRef.current && !busy) {
      setExpanded((prev) => {
        if (hasErrors) {
          const next: Record<string, boolean> = {}
          for (const key of Object.keys(prev)) next[key] = key === 'error' ? prev[key] : false
          next.error = true
          return next
        }
        return {}
      })
    }
    prevBusyRef.current = busy
  }, [busy, hasErrors])

  if (visibleItems.length === 0) {
    return (
      <div className="rounded-md border border-border bg-bg/50 p-3">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="tb-pulse inline-block w-2 h-2 rounded-full bg-accent" />
          <span className="font-medium text-text/80">{engineLabel}</span>
          <span>{emptyLabel}</span>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className="rounded-md border border-border bg-bg/45 max-h-[360px] overflow-auto shadow-inner shadow-black/20"
    >
      <ActivitySummary
        items={visibleItems}
        groups={grouped}
        engineLabel={engineLabel}
        busy={busy}
        latestRunning={latestRunning}
      />
      <div className="border-t border-border/60">
        {grouped.map((group) => (
          <ActivityGroup
            key={group.id}
            group={group}
            expanded={!!expanded[group.id]}
            busy={busy}
            latestRunningId={latestRunning?.id ?? null}
            onToggle={() =>
              setExpanded((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
            }
          />
        ))}
        {busy && !latestRunning && (
          <div className="px-3 py-2.5 flex items-center gap-2 text-xs text-muted border-t border-border/40">
            <span className="tb-pulse inline-block w-2 h-2 rounded-full bg-accent" />
            {engineLabel} is thinking...
          </div>
        )}
      </div>
    </div>
  )
}

function ActivitySummary({
  items,
  groups,
  engineLabel,
  busy,
  latestRunning
}: {
  items: AgentActivity[]
  groups: ActivityGroupModel[]
  engineLabel: string
  busy: boolean
  latestRunning?: AgentActivity
}) {
  const errorCount = items.filter((a) => a.kind === 'error' || a.status === 'failed').length
  const statusLabel = busy ? 'Live' : errorCount > 0 ? 'Needs review' : 'Complete'

  return (
    <div className="p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-block h-2 w-2 rounded-full',
                busy ? 'tb-pulse bg-accent' : errorCount > 0 ? 'bg-red-400' : 'bg-green-400'
              )}
            />
            <span className="text-sm text-text">{engineLabel} activity</span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider',
                busy
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : errorCount > 0
                    ? 'border-red-400/40 bg-red-400/10 text-red-300'
                    : 'border-border bg-panel text-muted'
              )}
            >
              {statusLabel}
            </span>
          </div>
          <div className="mt-1 min-w-0 text-xs text-muted">
            {latestRunning ? (
              <span className="block truncate">Now: {latestRunning.label}</span>
            ) : busy ? (
              <span>{engineLabel} is thinking...</span>
            ) : (
              <span>{summaryText(groups)}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {groups.map((g) => (
          <SummaryChip key={g.id} group={g} />
        ))}
      </div>
    </div>
  )
}

function summaryText(groups: ActivityGroupModel[]): string {
  const parts = groups
    .filter((g) => g.id !== 'system')
    .map((g) => `${g.items.length} ${GROUP_META[g.id].chip.toLowerCase()}`)
  return parts.length ? parts.join(' · ') : 'No tool activity recorded'
}

function SummaryChip({ group }: { group: ActivityGroupModel }) {
  const Icon = group.icon
  const failed = group.items.some((a) => a.kind === 'error' || a.status === 'failed')
  const running = group.items.some((a) => a.status === 'running')
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider',
        failed
          ? 'border-red-400/40 bg-red-400/10 text-red-300'
          : running
            ? 'border-accent/40 bg-accent/10 text-accent'
            : 'border-border bg-panel/70 text-muted'
      )}
    >
      <Icon size={11} />
      {GROUP_META[group.id].chip}
      <span className="font-mono tracking-normal">{group.items.length}</span>
    </span>
  )
}

function ActivityGroup({
  group,
  expanded,
  busy,
  latestRunningId,
  onToggle
}: {
  group: ActivityGroupModel
  expanded: boolean
  busy: boolean
  latestRunningId: string | null
  onToggle: () => void
}) {
  const Icon = group.icon
  const running = group.items.some((a) => a.status === 'running')
  const failed = group.items.some((a) => a.kind === 'error' || a.status === 'failed')

  return (
    <div className="border-t border-border/40 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-2.5 text-left hover:bg-panel/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown size={14} className="text-muted" />
          ) : (
            <ChevronRight size={14} className="text-muted" />
          )}
          <span
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
              failed
                ? 'border-red-400/30 bg-red-400/10 text-red-300'
                : running
                  ? 'border-accent/30 bg-accent/10 text-accent'
                  : 'border-border bg-bg text-muted'
            )}
          >
            <Icon size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text/90">{group.label}</span>
              {running && <span className="tb-pulse h-1.5 w-1.5 rounded-full bg-accent" />}
              {failed && <span className="h-1.5 w-1.5 rounded-full bg-red-400" />}
            </div>
            <div className="truncate text-[10px] text-muted">{group.description}</div>
          </div>
          <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-mono text-muted">
            {group.items.length}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="pb-1">
          {group.items.map((a, i) => (
            <ActivityEventRow
              key={`${a.id}:${i}`}
              activity={a}
              isCurrentRunning={busy && a.id === latestRunningId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ActivityEventRow({
  activity,
  isCurrentRunning
}: {
  activity: AgentActivity
  isCurrentRunning: boolean
}) {
  const Icon = iconFor(activity)
  const tone =
    activity.status === 'failed'
      ? 'text-red-400'
      : activity.kind === 'final'
        ? 'text-accent'
        : activity.kind === 'error'
          ? 'text-red-400'
          : 'text-text/90'

  return (
    <div className="px-3 py-2 text-[12.5px] leading-5">
      <div className="flex items-start gap-2 pl-8">
        <span
          className={cn(
            'mt-0.5 w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-sm',
            isCurrentRunning ? 'text-accent' : iconColor(activity)
          )}
        >
          {isCurrentRunning ? (
            <Circle size={12} className="tb-spin" />
          ) : (
            <Icon size={13} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn('truncate', tone)}>
            {activity.kind === 'message' ? (
              <span className="text-text/85 whitespace-pre-wrap break-words block">
                {activity.label}
              </span>
            ) : (
              activity.label
            )}
          </div>
          {activity.detail && activity.kind !== 'message' && (
            <div className="text-[11px] text-muted truncate font-mono">{activity.detail}</div>
          )}
        </div>
        {activity.kind === 'tool' && activity.status === 'done' && (
          <Check size={13} className="mt-1 text-green-500/80" />
        )}
        {activity.kind === 'tool' && activity.status === 'failed' && (
          <AlertTriangle size={13} className="mt-1 text-red-400" />
        )}
      </div>
    </div>
  )
}

function groupActivities(items: AgentActivity[]): ActivityGroupModel[] {
  const byCategory = new Map<ActivityCategory, AgentActivity[]>()
  for (const item of items) {
    const category = toolCategory(item)
    byCategory.set(category, [...(byCategory.get(category) ?? []), item])
  }
  return GROUP_ORDER.flatMap((id) => {
    const groupItems = byCategory.get(id) ?? []
    if (groupItems.length === 0) return []
    const meta = GROUP_META[id]
    return {
      id,
      label: meta.label,
      description: meta.description,
      icon: meta.icon,
      items: groupItems
    }
  })
}

function toolCategory(a: AgentActivity): ActivityCategory {
  if (a.kind === 'error' || a.status === 'failed') return 'error'
  if (a.kind === 'thinking' || a.kind === 'message' || a.kind === 'final') return 'reasoning'
  if (a.kind === 'system') return 'system'
  switch (a.tool) {
    case 'Read':
    case 'LS':
      return 'inspect'
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'TodoWrite':
      return 'change'
    case 'Bash':
      return 'command'
    case 'Grep':
    case 'Glob':
    case 'WebFetch':
      return 'search'
    default:
      return 'system'
  }
}

function iconFor(a: AgentActivity): LucideIcon {
  if (a.kind === 'thinking') return Sparkles
  if (a.kind === 'message') return MessageSquareText
  if (a.kind === 'final') return Check
  if (a.kind === 'error') return AlertTriangle
  if (a.kind === 'system') return ListTree
  switch (a.tool) {
    case 'Read':
    case 'LS':
      return FileSearch
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return FilePenLine
    case 'Bash':
      return Terminal
    case 'Grep':
    case 'Glob':
    case 'WebFetch':
      return Search
    case 'TodoWrite':
      return ListTree
    default:
      return Code2
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

function isSessionStartActivity(a: AgentActivity) {
  return a.kind === 'system' && /^(Claude|Codex) session started$/i.test(a.label)
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
