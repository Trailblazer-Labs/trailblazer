import { useMemo, useState } from 'react'
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

interface CommandSummary {
  commands: AgentActivity[]
  changes: AgentActivity[]
  inspect: AgentActivity[]
  search: AgentActivity[]
  errors: AgentActivity[]
  other: AgentActivity[]
}

export default function ChatActivityStream({
  items,
  busy,
  emptyLabel = 'Starting...'
}: {
  items: AgentActivity[]
  busy: boolean
  emptyLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = useMemo(() => summarizeActivity(items), [items])
  const reasoning = items.filter((a) => a.kind === 'thinking' || a.kind === 'message')
  const visibleReasoning = reasoning.length > 0 ? reasoning : latestNonCommandItems(items)
  const latestRunning = [...items].reverse().find((a) => a.status === 'running')
  const errorCount = summary.errors.length
  const ranCount =
    summary.commands.length + summary.changes.length + summary.inspect.length + summary.search.length

  if (items.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="tb-pulse inline-block h-2 w-2 rounded-full bg-accent" />
          {emptyLabel}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <div className="space-y-2">
        {visibleReasoning.slice(-6).map((activity, index) => (
          <ReasoningLine
            key={`${activity.id}:${index}`}
            activity={activity}
            current={busy && activity.id === latestRunning?.id}
          />
        ))}
        {busy && latestRunning && !visibleReasoning.some((a) => a.id === latestRunning.id) && (
          <ReasoningLine activity={latestRunning} current />
        )}
        {busy && !latestRunning && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="tb-pulse h-1.5 w-1.5 rounded-full bg-accent" />
            Thinking...
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'group flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
          errorCount > 0
            ? 'border-red-400/30 bg-red-400/10 hover:bg-red-400/15'
            : 'border-border/80 bg-bg/35 hover:bg-panel/60'
        )}
      >
        {expanded ? (
          <ChevronDown size={15} className="shrink-0 text-muted" />
        ) : (
          <ChevronRight size={15} className="shrink-0 text-muted" />
        )}
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-panel">
          {errorCount > 0 ? (
            <AlertTriangle size={14} className="text-red-300" />
          ) : (
            <Terminal size={14} className="text-accent" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-text/90">
            {errorCount > 0
              ? `${errorCount} issue${errorCount === 1 ? '' : 's'} during run`
              : ranCount > 0
                ? `Ran ${ranCount} action${ranCount === 1 ? '' : 's'}`
                : 'No tool calls yet'}
          </div>
          <div className="truncate text-xs text-muted">
            {summaryLabel(summary)}
          </div>
        </div>
        {busy && <span className="tb-pulse h-1.5 w-1.5 rounded-full bg-accent" />}
      </button>

      {expanded && (
        <div className="space-y-2 pl-10">
          <CommandGroup title="Commands" items={summary.commands} />
          <CommandGroup title="File changes" items={summary.changes} />
          <CommandGroup title="Inspected" items={summary.inspect} />
          <CommandGroup title="Searched" items={summary.search} />
          <CommandGroup title="Errors" items={summary.errors} />
          <CommandGroup title="Other" items={summary.other} />
        </div>
      )}
    </div>
  )
}

function ReasoningLine({
  activity,
  current
}: {
  activity: AgentActivity
  current: boolean
}) {
  const Icon = iconFor(activity)
  const isError = activity.kind === 'error' || activity.status === 'failed'
  return (
    <div className="flex items-start gap-2 text-sm">
      <span
        className={cn(
          'mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm',
          current ? 'text-accent' : isError ? 'text-red-400' : 'text-muted'
        )}
      >
        {current ? <Circle size={12} className="tb-spin" /> : <Icon size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('whitespace-pre-wrap break-words', isError ? 'text-red-300' : 'text-text/85')}>
          {activity.label}
        </div>
        {activity.detail && (
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{activity.detail}</div>
        )}
      </div>
    </div>
  )
}

function CommandGroup({ title, items }: { title: string; items: AgentActivity[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">{title}</div>
      <div className="space-y-1">
        {items.map((item, index) => (
          <CommandRow key={`${item.id}:${index}`} activity={item} />
        ))}
      </div>
    </div>
  )
}

function CommandRow({ activity }: { activity: AgentActivity }) {
  const Icon = iconFor(activity)
  const isError = activity.kind === 'error' || activity.status === 'failed'
  return (
    <div className="flex items-start gap-2 rounded-md bg-bg/35 px-2.5 py-2">
      <span className={cn('mt-0.5 shrink-0', isError ? 'text-red-400' : iconColor(activity))}>
        <Icon size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-xs', isError ? 'text-red-300' : 'text-text/85')}>
          {activity.label}
        </div>
        {activity.detail && (
          <div className="truncate font-mono text-[11px] text-muted">{activity.detail}</div>
        )}
      </div>
      {activity.status === 'done' && <Check size={13} className="mt-0.5 text-green-500/80" />}
      {activity.status === 'running' && <Circle size={12} className="tb-spin mt-0.5 text-accent" />}
      {activity.status === 'failed' && <AlertTriangle size={13} className="mt-0.5 text-red-400" />}
    </div>
  )
}

function summarizeActivity(items: AgentActivity[]): CommandSummary {
  const summary: CommandSummary = {
    commands: [],
    changes: [],
    inspect: [],
    search: [],
    errors: [],
    other: []
  }
  for (const item of items) {
    const category = toolCategory(item)
    if (category === 'error') summary.errors.push(item)
    else if (category === 'command') summary.commands.push(item)
    else if (category === 'change') summary.changes.push(item)
    else if (category === 'inspect') summary.inspect.push(item)
    else if (category === 'search') summary.search.push(item)
    else if (category === 'system') summary.other.push(item)
  }
  return summary
}

function summaryLabel(summary: CommandSummary): string {
  const parts = [
    summary.commands.length ? `${summary.commands.length} command${summary.commands.length === 1 ? '' : 's'}` : '',
    summary.changes.length ? `${summary.changes.length} file action${summary.changes.length === 1 ? '' : 's'}` : '',
    summary.inspect.length ? `${summary.inspect.length} inspection${summary.inspect.length === 1 ? '' : 's'}` : '',
    summary.search.length ? `${summary.search.length} search${summary.search.length === 1 ? '' : 'es'}` : ''
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Working through the request'
}

function latestNonCommandItems(items: AgentActivity[]): AgentActivity[] {
  return items.filter((item) => {
    const category = toolCategory(item)
    return category === 'reasoning' || category === 'error'
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
  return 'text-muted'
}
