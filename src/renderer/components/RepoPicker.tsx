import { useEffect, useState } from 'react'
import { Input } from './ui'
import type { RepoSearchResult } from '@shared/types'

export default function RepoPicker({
  selected,
  onChange
}: {
  selected: RepoSearchResult[]
  onChange: (next: RepoSearchResult[]) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<RepoSearchResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await window.api.github.searchRepos(q)
        if (!cancelled) setResults(r)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q])

  function toggle(r: RepoSearchResult) {
    const exists = selected.find((s) => s.fullName === r.fullName)
    if (exists) onChange(selected.filter((s) => s.fullName !== r.fullName))
    else onChange([...selected, r])
  }

  return (
    <div className="space-y-2">
      <Input
        placeholder="Search your repositories…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="max-h-64 overflow-auto rounded-md border border-border bg-bg">
        {loading && <div className="text-xs text-muted px-3 py-2">Searching…</div>}
        {!loading && results.length === 0 && (
          <div className="text-xs text-muted px-3 py-2">No repositories.</div>
        )}
        {results.map((r) => {
          const active = !!selected.find((s) => s.fullName === r.fullName)
          return (
            <button
              key={r.fullName}
              onClick={() => toggle(r)}
              className={
                'w-full text-left px-3 py-2 flex items-center justify-between text-sm hover:bg-panel ' +
                (active ? 'bg-[#1a1414]' : '')
              }
            >
              <span>
                <span className="text-muted">{r.owner}/</span>
                <span>{r.name}</span>
                {r.private && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-muted">private</span>
                )}
              </span>
              <span className={active ? 'text-accent' : 'text-muted'}>{active ? '✓' : '+'}</span>
            </button>
          )
        })}
      </div>
      {selected.length > 0 && (
        <div className="text-xs text-muted">{selected.length} selected</div>
      )}
    </div>
  )
}
