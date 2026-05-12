import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '../lib/cn'
import type { Repo } from '@shared/types'

/**
 * Compact "Repos" pill + popover used in the ProjectView header.
 * Lists repos in the project and lets the user change each repo's working branch.
 */
export default function ReposPopover({ repos }: { repos: Repo[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'no-drag h-8 px-2.5 rounded-md border border-border text-xs flex items-center gap-2',
          open
            ? 'bg-[#1a1414] text-text border-accent/40'
            : 'bg-panel text-muted hover:text-text hover:bg-[#1d1d1d]'
        )}
      >
        <AvatarStack owners={repos.map((r) => r.owner)} />
        <span>
          {repos.length} repo{repos.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 z-30 rounded-md border border-border bg-panel shadow-xl overflow-hidden">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted border-b border-border">
            Repositories
          </div>
          <ul className="max-h-[60vh] overflow-auto py-1">
            {repos.map((r) => (
              <li key={r.id}>
                <RepoBranchRow repo={r} />
              </li>
            ))}
          </ul>
          <div className="px-3 py-2 border-t border-border text-[10px] text-muted">
            Pick the branch new issue/feature branches will fork from.
          </div>
        </div>
      )}
    </div>
  )
}

function RepoBranchRow({ repo }: { repo: Repo }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [branches, setBranches] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const current = repo.workingBranch ?? repo.defaultBranch

  useEffect(() => {
    if (!editing || branches) return
    setLoading(true)
    window.api.features
      .listRepoBranches(repo.id)
      .then(setBranches)
      .finally(() => setLoading(false))
  }, [editing, branches, repo.id])

  async function pick(b: string) {
    setSaving(true)
    try {
      await window.api.repos.setWorkingBranch(repo.id, b === repo.defaultBranch ? null : b)
      await qc.invalidateQueries({ queryKey: ['repos', repo.projectId] })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-2 py-1.5">
      <div className="flex items-center gap-2 px-1">
        <Avatar owner={repo.owner} />
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] truncate">{repo.name}</div>
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-[10.5px] text-muted hover:text-text font-mono truncate text-left"
            title="Change working branch"
          >
            <span className={repo.workingBranch ? 'text-accent' : ''}>{current}</span>
            <span className="ml-1 opacity-60">{editing ? '×' : '✎'}</span>
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-1.5 ml-9 rounded border border-border bg-bg/60 max-h-44 overflow-auto">
          {loading && <div className="px-3 py-1.5 text-[11px] text-muted">Loading branches…</div>}
          {!loading &&
            branches?.map((b) => {
              const active = b === current
              return (
                <button
                  key={b}
                  disabled={saving}
                  onClick={() => pick(b)}
                  className={cn(
                    'w-full text-left px-3 py-1 text-[11px] flex items-center justify-between hover:bg-panel',
                    active && 'text-accent'
                  )}
                >
                  <span className="font-mono truncate">{b}</span>
                  {b === repo.defaultBranch && (
                    <span className="text-[10px] text-muted">default</span>
                  )}
                  {active && <span className="text-accent">✓</span>}
                </button>
              )
            })}
        </div>
      )}
    </div>
  )
}

function AvatarStack({ owners }: { owners: string[] }) {
  const unique = Array.from(new Set(owners)).slice(0, 3)
  return (
    <div className="flex -space-x-1.5">
      {unique.map((o) => (
        <Avatar key={o} owner={o} />
      ))}
    </div>
  )
}

function Avatar({ owner }: { owner: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className="w-5 h-5 rounded-full bg-bg border border-panel flex items-center justify-center text-[10px] text-muted ring-1 ring-border">
        {owner.charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={`https://github.com/${encodeURIComponent(owner)}.png?size=40`}
      alt={owner}
      onError={() => setFailed(true)}
      className="w-5 h-5 rounded-full border border-panel bg-bg object-cover ring-1 ring-border"
    />
  )
}
