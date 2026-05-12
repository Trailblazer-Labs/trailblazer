import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from '../lib/cn'
import { useApp } from '../stores/app'
import NewFeatureModal from './NewFeatureModal'
import type { Feature, FeatureSession, Repo } from '@shared/types'

const STORAGE_KEY = 'trailblazer.featureSwitcher.collapsed'
const EXPANDED_KEY = 'trailblazer.featureSwitcher.expanded'

export function useFeatureSwitcherCollapsed(): [boolean, (v: boolean) => void] {
  const [c, setC] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  function set(v: boolean) {
    setC(v)
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
    } catch {
      // ignore
    }
  }
  return [c, set]
}

function loadExpanded(): Set<number> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    return new Set(raw ? (JSON.parse(raw) as number[]) : [])
  } catch {
    return new Set()
  }
}
function saveExpanded(ids: Set<number>) {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    // ignore
  }
}

export default function FeatureSwitcher({
  projectId,
  currentFeatureId,
  currentSessionId,
  repos,
  collapsed,
  onToggle
}: {
  projectId: number
  currentFeatureId: number
  currentSessionId?: number
  repos: Repo[]
  collapsed: boolean
  onToggle: () => void
}) {
  const setView = useApp((s) => s.setView)
  const qc = useQueryClient()
  const { data: features = [] } = useQuery<Feature[]>({
    queryKey: ['features', projectId],
    queryFn: () => window.api.features.list(projectId)
  })
  const [creating, setCreating] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(loadExpanded)

  useEffect(() => {
    // Auto-expand the current feature so its sessions are visible.
    setExpanded((prev) => {
      if (prev.has(currentFeatureId)) return prev
      const next = new Set(prev)
      next.add(currentFeatureId)
      saveExpanded(next)
      return next
    })
  }, [currentFeatureId])

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveExpanded(next)
      return next
    })
  }

  return (
    <aside
      className={cn(
        'h-full border-r border-border bg-bg/40 flex flex-col shrink-0 transition-[width] duration-200',
        collapsed ? 'w-12' : 'w-64'
      )}
    >
      <div
        className={cn(
          'h-12 flex items-center border-b border-border px-2 shrink-0',
          collapsed ? 'justify-center' : 'justify-between'
        )}
      >
        {!collapsed && (
          <div className="text-[10px] uppercase tracking-wider text-muted pl-1">Features</div>
        )}
        <button
          onClick={onToggle}
          title={collapsed ? 'Expand' : 'Collapse'}
          className="w-7 h-7 rounded-md hover:bg-panel flex items-center justify-center text-muted hover:text-text"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d={collapsed ? 'M6 4l4 4-4 4' : 'M10 4L6 8l4 4'}
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-auto py-1">
        {features.map((f) => {
          const active = f.id === currentFeatureId
          if (collapsed) {
            return (
              <button
                key={f.id}
                onClick={() => setView({ kind: 'feature', projectId, featureId: f.id })}
                title={f.name}
                className={cn(
                  'group w-full h-9 flex items-center justify-center transition-colors relative',
                  active ? 'text-accent' : 'text-muted hover:text-text'
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />
                )}
                <span className="w-6 h-6 rounded-md border border-border flex items-center justify-center text-[10px] font-mono uppercase">
                  {initials(f.name)}
                </span>
              </button>
            )
          }
          return (
            <FeatureNode
              key={f.id}
              feature={f}
              active={active}
              expanded={expanded.has(f.id)}
              currentSessionId={active ? currentSessionId : undefined}
              onToggle={() => toggleExpand(f.id)}
              onOpen={() => setView({ kind: 'feature', projectId, featureId: f.id })}
              onOpenSession={(sessionId) =>
                setView({ kind: 'feature', projectId, featureId: f.id, sessionId })
              }
              onAfterMutate={() => {
                void qc.invalidateQueries({ queryKey: ['feature-sessions', f.id] })
              }}
            />
          )
        })}
      </div>

      <div className="border-t border-border p-2 shrink-0">
        {collapsed ? (
          <button
            onClick={() => setCreating(true)}
            title="New feature"
            className="w-full h-8 rounded-md border border-dashed border-border hover:border-accent/60 hover:text-accent text-muted flex items-center justify-center text-sm"
          >
            +
          </button>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full h-8 rounded-md border border-dashed border-border hover:border-accent/60 hover:text-accent text-muted text-xs flex items-center justify-center gap-1.5"
          >
            <span className="text-sm leading-none">+</span> New feature
          </button>
        )}
      </div>

      {creating && (
        <NewFeatureModal
          projectId={projectId}
          repos={repos}
          onClose={() => setCreating(false)}
          onCreated={(f) => {
            void qc.invalidateQueries({ queryKey: ['features', projectId] })
            setCreating(false)
            setView({ kind: 'feature', projectId, featureId: f.id })
          }}
        />
      )}
    </aside>
  )
}

function FeatureNode({
  feature,
  active,
  expanded,
  currentSessionId,
  onToggle,
  onOpen,
  onOpenSession,
  onAfterMutate
}: {
  feature: Feature
  active: boolean
  expanded: boolean
  currentSessionId?: number
  onToggle: () => void
  onOpen: () => void
  onOpenSession: (sessionId: number) => void
  onAfterMutate: () => void
}) {
  const { data: sessions = [], isLoading } = useQuery<FeatureSession[]>({
    queryKey: ['feature-sessions', feature.id],
    queryFn: () => window.api.features.listSessions(feature.id),
    enabled: expanded
  })

  async function newSession() {
    const s = await window.api.features.createSession(feature.id)
    onAfterMutate()
    onOpenSession(s.id)
  }

  return (
    <div className={cn('relative', active && 'bg-[#1a1414]/40')}>
      {active && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent" />}
      <div className="flex items-center gap-1 pr-1 hover:bg-panel/60">
        <button
          onClick={onToggle}
          className="w-5 h-7 flex items-center justify-center text-muted hover:text-text"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 9 9"
            className={cn('transition-transform', expanded && 'rotate-90')}
          >
            <path d="M3 1.5L6 4.5L3 7.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
          </svg>
        </button>
        <button
          onClick={onOpen}
          className={cn(
            'flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left',
            active ? 'text-text' : 'text-text/85 hover:text-text'
          )}
        >
          <span className="w-5 h-5 rounded-md border border-border flex items-center justify-center text-[9px] font-mono uppercase shrink-0 text-muted">
            {initials(feature.name)}
          </span>
          <span className="text-[12.5px] truncate">{feature.name}</span>
        </button>
      </div>
      {expanded && (
        <div className="pb-1">
          {isLoading && (
            <div className="px-7 py-1 text-[10.5px] text-muted">Loading…</div>
          )}
          {!isLoading &&
            sessions.map((s) => (
              <SessionNode
                key={s.id}
                session={s}
                active={s.id === currentSessionId}
                onOpen={() => onOpenSession(s.id)}
                onAfterMutate={onAfterMutate}
              />
            ))}
          {!isLoading && sessions.length === 0 && (
            <div className="px-7 py-1 text-[10.5px] text-muted italic">No sessions yet</div>
          )}
          <button
            onClick={newSession}
            className="ml-6 mt-0.5 mb-1 mr-2 w-[calc(100%-2rem)] h-6 rounded-md border border-dashed border-border hover:border-accent/60 hover:text-accent text-muted text-[10.5px] flex items-center justify-center gap-1"
          >
            <span className="leading-none">+</span> New session
          </button>
        </div>
      )}
    </div>
  )
}

function SessionNode({
  session,
  active,
  onOpen,
  onAfterMutate
}: {
  session: FeatureSession
  active: boolean
  onOpen: () => void
  onAfterMutate: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  async function commitRename() {
    const v = draft.trim()
    setEditing(false)
    if (!v || v === session.name) return
    await window.api.features.renameSession(session.id, v)
    onAfterMutate()
  }

  async function remove() {
    if (!confirm(`Delete session "${session.name}"? Its messages will be lost.`)) return
    await window.api.features.deleteSession(session.id)
    onAfterMutate()
  }

  return (
    <div
      className={cn(
        'group flex items-center pl-7 pr-2 py-1 text-[11.5px] hover:bg-panel/60',
        active && 'bg-[#1a1414] text-accent'
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full mr-2 shrink-0 bg-muted/40 group-hover:bg-muted" />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            else if (e.key === 'Escape') {
              setEditing(false)
              setDraft(session.name)
            }
          }}
          className="flex-1 bg-bg border border-border rounded px-1 py-0.5 text-[11.5px] outline-none focus:border-accent"
        />
      ) : (
        <button
          onClick={onOpen}
          onDoubleClick={() => {
            setDraft(session.name)
            setEditing(true)
          }}
          className="flex-1 min-w-0 text-left truncate"
        >
          {session.name}
        </button>
      )}
      {!editing && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            void remove()
          }}
          className="ml-1 text-muted/70 hover:text-red-400 opacity-0 group-hover:opacity-100 text-[10px]"
          title="Delete session"
        >
          ✕
        </button>
      )}
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s-_]+/).filter(Boolean)
  if (parts.length === 0) return '··'
  if (parts.length === 1) return parts[0].slice(0, 2)
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
