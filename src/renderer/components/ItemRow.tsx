import { cn } from '../lib/cn'
import { Pill } from './ui'

type State =
  | 'open'           // open issue or PR
  | 'closed'         // closed without merge
  | 'merged'         // merged PR
  | 'draft'

export interface ItemRowProps {
  kind: 'issue' | 'pr'
  number: number
  title: string
  state: State
  repoName: string
  meta?: string                       // e.g. "closes #4" or "head→base"
  active?: boolean
  onClick?: () => void
  onOpen?: () => void                 // expand modal
}

export default function ItemRow({
  kind,
  number,
  title,
  state,
  repoName,
  meta,
  active,
  onClick,
  onOpen
}: ItemRowProps) {
  return (
    <div
      onClick={onClick}
      onDoubleClick={onOpen}
      className={cn(
        'group h-14 px-3 flex items-center gap-3 cursor-pointer transition-colors border-b border-border/50',
        active ? 'bg-[#1a1414]' : 'hover:bg-panel'
      )}
    >
      <StateIcon kind={kind} state={state} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted font-mono shrink-0">#{number}</span>
          <span className="truncate text-[13px] text-text/95">{title}</span>
        </div>
        <div className="mt-0.5 text-[10.5px] text-muted truncate">
          {repoName}
          {meta && (
            <>
              <span className="mx-1.5 opacity-40">·</span>
              <span>{meta}</span>
            </>
          )}
        </div>
      </div>
      <Pill tone={toneFor(state)}>{state}</Pill>
      {onOpen && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          className="text-muted hover:text-accent w-5 text-center opacity-0 group-hover:opacity-100 transition-opacity"
          title="Open"
          aria-label="Open"
        >
          ↗
        </button>
      )}
    </div>
  )
}

function toneFor(s: State): 'open' | 'merged' | 'closed' | 'default' {
  if (s === 'merged') return 'merged'
  if (s === 'closed') return 'closed'
  if (s === 'open') return 'open'
  return 'default'
}

function StateIcon({ kind, state }: { kind: 'issue' | 'pr'; state: State }) {
  // Match GitHub's visual language: green for open, purple for merged, red for closed, grey for draft.
  const color =
    state === 'merged'
      ? 'text-purple-400'
      : state === 'closed'
        ? 'text-red-400'
        : state === 'draft'
          ? 'text-muted'
          : 'text-green-400'

  return (
    <span
      className={cn(
        'w-6 h-6 shrink-0 flex items-center justify-center rounded-full border bg-bg/50',
        color,
        'border-current/30'
      )}
      aria-hidden
    >
      {kind === 'issue' ? <IssueDot state={state} /> : <PRGlyph state={state} />}
    </span>
  )
}

function IssueDot({ state }: { state: State }) {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function PRGlyph({ state }: { state: State }) {
  if (state === 'merged') {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <circle cx="5" cy="3" r="1.5" fill="currentColor" />
        <circle cx="11" cy="13" r="1.5" fill="currentColor" />
        <circle cx="11" cy="6" r="1.5" fill="currentColor" />
        <path d="M5 4.5v8M5 6c0 2 2 3 6 3" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  }
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <circle cx="5" cy="3" r="1.5" fill="currentColor" />
      <circle cx="5" cy="13" r="1.5" fill="currentColor" />
      <circle cx="11" cy="13" r="1.5" fill="currentColor" />
      <path d="M5 4.5v7" stroke="currentColor" strokeWidth="1.3" />
      <path d="M11 4.5v7" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.5 4.5h-3l1.2-1.2M9.5 4.5l-1.2 1.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
