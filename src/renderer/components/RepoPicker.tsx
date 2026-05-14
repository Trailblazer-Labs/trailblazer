import { useEffect, useState } from 'react'
import { Input } from './ui'
import type { RepoSearchResult } from '@shared/types'

export default function RepoPicker({
  selected,
  onChange,
  disabledFullNames = []
}: {
  selected: RepoSearchResult[]
  onChange: (next: RepoSearchResult[]) => void
  disabledFullNames?: string[]
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<RepoSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const disabled = new Set(disabledFullNames)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const t = setTimeout(async () => {
      try {
        const r = await window.api.github.searchRepos(q)
        if (!cancelled) setResults(r)
      } catch (e) {
        if (!cancelled) {
          setResults([])
          setError(e instanceof Error ? e.message : 'Repository search failed')
        }
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
    if (disabled.has(r.fullName)) return
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
        {!loading && error && (
          <div className="text-xs text-red-300 px-3 py-2">{error}</div>
        )}
        {!loading && !error && results.length === 0 && (
          <div className="text-xs text-muted px-3 py-2">No repositories.</div>
        )}
        {results.map((r) => {
          const active = !!selected.find((s) => s.fullName === r.fullName)
          const isDisabled = disabled.has(r.fullName)
          return (
            <button
              key={r.fullName}
              disabled={isDisabled}
              onClick={() => toggle(r)}
              className={
                'w-full text-left px-3 py-2 flex items-center justify-between text-sm hover:bg-panel disabled:cursor-default disabled:hover:bg-transparent ' +
                (active ? 'bg-[#1a1414]' : '') +
                (isDisabled ? ' opacity-55' : '')
              }
            >
              <span>
                <span className="text-muted">{r.owner}/</span>
                <span>{r.name}</span>
                {r.private && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-muted">private</span>
                )}
              </span>
              <span className={active ? 'text-accent' : 'text-muted'}>
                {isDisabled ? 'Added' : active ? '✓' : '+'}
              </span>
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
