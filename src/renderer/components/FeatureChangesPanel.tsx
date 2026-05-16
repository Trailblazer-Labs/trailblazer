import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from '../lib/cn'
import { Modal } from './NewIssueModal'
import { Button, Card, Pill } from './ui'
import DiffView from './DiffView'
import type {
  FeatureChangedFile,
  FeatureCommitResult,
  FeatureDevCommandEvent,
  FeatureRepo,
  FeatureRepoChanges,
  DevProfile,
  DevSetupState
} from '@shared/types'

type Scope = 'session' | 'overall'

export default function FeatureChangesPanel({
  featureId,
  sessionId
}: {
  featureId: number
  sessionId?: number
}) {
  const qc = useQueryClient()
  const [scope, setScope] = useState<Scope>(sessionId ? 'session' : 'overall')
  const effectiveScope: Scope = sessionId ? scope : 'overall'

  const { data: changes = [], isFetching } = useQuery<FeatureRepoChanges[]>({
    queryKey: ['feature-changes', featureId, effectiveScope, sessionId],
    queryFn: () =>
      window.api.features.getChanges({
        featureId,
        scope: effectiveScope,
        sessionId
      }),
    refetchOnMount: 'always'
  })
  const { data: featureRepos = [] } = useQuery<FeatureRepo[]>({
    queryKey: ['feature-repos', featureId],
    queryFn: () => window.api.features.listRepos(featureId)
  })
  const { data: feature } = useQuery({
    queryKey: ['feature', featureId],
    queryFn: () => window.api.features.get(featureId)
  })
  const { data: devProfiles = [] } = useQuery<DevProfile[]>({
    queryKey: ['dev-profiles', feature?.projectId],
    queryFn: () => window.api.devProfiles.list(feature!.projectId),
    enabled: !!feature
  })
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<{
    repo: FeatureRepoChanges
    file: FeatureChangedFile
  } | null>(null)
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
  const [committing, setCommitting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [showCommit, setShowCommit] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [commitError, setCommitError] = useState<string | null>(null)
  const [commitResult, setCommitResult] = useState<FeatureCommitResult[] | null>(null)
  const [repoCommit, setRepoCommit] = useState<{ repoId: number; message: string } | null>(null)
  const [repoCommitting, setRepoCommitting] = useState<number | null>(null)
  const [repoPublishing, setRepoPublishing] = useState<number | null>(null)
  const [rebranchRepo, setRebranchRepo] = useState<FeatureRepoChanges | null>(null)

  const totalFiles = useMemo(() => changes.reduce((n, r) => n + r.files.length, 0), [changes])
  const totalAdds = useMemo(
    () => changes.reduce((n, r) => n + r.files.reduce((a, f) => a + f.additions, 0), 0),
    [changes]
  )
  const totalDels = useMemo(
    () => changes.reduce((n, r) => n + r.files.reduce((a, f) => a + f.deletions, 0), 0),
    [changes]
  )

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['feature-changes', featureId] })
  }

  const hasUncommitted = changes.some((r) => r.hasUncommitted)
  const hasPendingCommits = changes.some((r) => r.commitsAhead > 0)

  async function commit() {
    setCommitting(true)
    setCommitError(null)
    try {
      const result = await window.api.features.commit({
        featureId,
        message: commitMsg.trim()
      })
      setCommitResult(result)
      setShowCommit(false)
      setCommitMsg('')
      void qc.invalidateQueries({ queryKey: ['feature-changes', featureId] })
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : 'commit failed')
    } finally {
      setCommitting(false)
    }
  }

  async function commitAndPublish() {
    setPublishing(true)
    setCommitError(null)
    try {
      const result = await window.api.features.commitAndPublish({
        featureId,
        message: commitMsg.trim()
      })
      setCommitResult(result)
      setShowCommit(false)
      setCommitMsg('')
      void qc.invalidateQueries({ queryKey: ['feature-changes', featureId] })
      void qc.invalidateQueries({ queryKey: ['feature-repos', featureId] })
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : 'publish failed')
    } finally {
      setPublishing(false)
    }
  }

  async function commitRepo(repo: FeatureRepoChanges, publishAfter = false) {
    const message = repoCommit?.repoId === repo.repoId ? repoCommit.message.trim() : ''
    if (publishAfter) setRepoPublishing(repo.repoId)
    else setRepoCommitting(repo.repoId)
    setCommitError(null)
    try {
      const result = publishAfter
        ? await window.api.features.commitAndPublish({
            featureId,
            repoId: repo.repoId,
            message
          })
        : await window.api.features.commit({
            featureId,
            repoId: repo.repoId,
            message
          })
      setCommitResult(result)
      setRepoCommit(null)
      void qc.invalidateQueries({ queryKey: ['feature-changes', featureId] })
      void qc.invalidateQueries({ queryKey: ['feature-repos', featureId] })
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : publishAfter ? 'publish failed' : 'commit failed')
    } finally {
      if (publishAfter) setRepoPublishing(null)
      else setRepoCommitting(null)
    }
  }

  async function publish() {
    setPushing(true)
    setCommitError(null)
    try {
      const result = await window.api.features.publish(featureId)
      setCommitResult(result)
      void qc.invalidateQueries({ queryKey: ['feature-changes', featureId] })
      void qc.invalidateQueries({ queryKey: ['feature-repos', featureId] })
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : 'push failed')
    } finally {
      setPushing(false)
    }
  }

  async function pull() {
    setPulling(true)
    setCommitError(null)
    try {
      const result = await window.api.features.pull(featureId)
      setCommitResult(result)
      void qc.invalidateQueries({ queryKey: ['feature-changes', featureId] })
      void qc.invalidateQueries({ queryKey: ['feature-repos', featureId] })
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : 'pull failed')
    } finally {
      setPulling(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-bg/40">
      <header className="border-b border-border shrink-0">
        <div className="px-3 pt-2.5 flex items-center gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h3 className="text-xs uppercase tracking-wider text-muted">Changes</h3>
            {totalFiles > 0 && (
              <span className="text-[11px] text-muted tabular-nums">
                {totalFiles} file{totalFiles === 1 ? '' : 's'}
              </span>
            )}
            {(totalAdds > 0 || totalDels > 0) && (
              <span className="text-[10px] font-mono">
                <span className="text-green-400">+{totalAdds}</span>{' '}
                <span className="text-red-400">−{totalDels}</span>
              </span>
            )}
            {isFetching && (
              <span className="tb-pulse inline-block w-1.5 h-1.5 rounded-full bg-accent" />
            )}
          </div>
          <button
            onClick={refresh}
            title="Refresh"
            aria-label="Refresh"
            className={cn(
              'no-drag w-6 h-6 rounded-md border border-border bg-panel hover:bg-[#1d1d1d] flex items-center justify-center text-muted hover:text-text',
              isFetching && 'tb-spin'
            )}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
              <path
                d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 3v3.5H10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <div className="px-3 mt-2 flex items-center gap-2">
          {sessionId && (
            <div className="inline-flex p-0.5 rounded-md border border-border bg-bg">
              <ScopeTab active={scope === 'session'} onClick={() => setScope('session')}>
                This session
              </ScopeTab>
              <ScopeTab active={scope === 'overall'} onClick={() => setScope('overall')}>
                Overall
              </ScopeTab>
            </div>
          )}
          <div className="flex-1" />
          <button
            onClick={pull}
            disabled={committing || publishing || pushing || pulling}
            className="no-drag h-7 px-2.5 rounded-md border border-border bg-panel text-[11px] text-muted hover:text-text hover:bg-[#1d1d1d] disabled:opacity-50"
          >
            {pulling ? 'Pulling...' : 'Pull'}
          </button>
          {hasUncommitted && (
            <button
              onClick={() => setShowCommit((v) => !v)}
              disabled={committing || publishing || pushing || pulling}
              className="no-drag h-7 px-2.5 rounded-md border border-accent/40 bg-[#1a1414] text-[11px] text-accent hover:bg-[#221212] disabled:opacity-50"
            >
              {publishing ? 'Publishing…' : committing ? 'Committing…' : 'Commit'}
            </button>
          )}
          {!hasUncommitted && hasPendingCommits && (
            <button
              onClick={publish}
              disabled={committing || publishing || pushing || pulling}
              className="no-drag h-7 px-2.5 rounded-md border border-accent/40 bg-[#1a1414] text-[11px] text-accent hover:bg-[#221212] disabled:opacity-50"
            >
              {pushing ? 'Pushing…' : 'Push'}
            </button>
          )}
        </div>
        {showCommit && (
          <div className="px-3 mt-2 mb-2 space-y-1.5">
            <input
              autoFocus
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commit()
                else if (e.key === 'Escape') {
                  setShowCommit(false)
                  setCommitMsg('')
                }
              }}
              placeholder="Commit message (Enter to commit, Esc to cancel)"
              className="no-drag w-full h-7 rounded bg-panel border border-border px-2 text-[11px] outline-none focus:border-accent"
            />
            {commitError && <div className="text-[10px] text-red-400">{commitError}</div>}
            <div className="flex gap-1.5 justify-end">
              <button
                onClick={() => {
                  setShowCommit(false)
                  setCommitMsg('')
                }}
                className="text-[11px] text-muted hover:text-text"
              >
                Cancel
              </button>
              <button
                onClick={commit}
                disabled={committing || publishing}
                className="text-[11px] text-accent hover:text-text disabled:opacity-50"
              >
                Commit all
              </button>
              <button
                onClick={commitAndPublish}
                disabled={committing || publishing}
                className="text-[11px] text-accent hover:text-text disabled:opacity-50"
              >
                Commit & publish
              </button>
            </div>
          </div>
        )}
        {commitResult && commitResult.length > 0 && (
          <div className="px-3 mt-1 mb-2 space-y-0.5">
            {commitResult.map((r) => (
              <div key={r.repoId} className="text-[10px] text-muted flex items-center gap-2">
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    r.status === 'committed'
                      ? 'bg-green-400'
                      : r.status === 'published'
                        ? 'bg-accent'
                      : r.status === 'pulled'
                        ? 'bg-blue-400'
                      : r.status === 'failed'
                        ? 'bg-red-400'
                        : 'bg-muted/40'
                  )}
                />
                <span className="truncate">
                  {r.repoName}: {resultLabel(r)}
                </span>
              </div>
            ))}
            <button
              onClick={() => setCommitResult(null)}
              className="text-[10px] text-muted hover:text-text"
            >
              dismiss
            </button>
          </div>
        )}
      </header>

      <div className="px-3 py-2 border-b border-border shrink-0">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files…"
          className="no-drag w-full h-7 rounded bg-panel border border-border px-2 text-[11px] outline-none focus:border-accent placeholder:text-muted"
        />
      </div>

      <div className="flex-1 overflow-auto">
        <>
          {changes.length === 0 ? (
            <div className="px-3 py-8 text-center text-[11px] text-muted">
              No changes yet. Send a prompt and the agent will write to these branches.
            </div>
          ) : (
            <>
          {changes.map((repo) => {
            const visible = repo.files.filter((f) =>
              filter ? f.path.toLowerCase().includes(filter.toLowerCase()) : true
            )
            if (visible.length === 0 && filter) return null
            const open = !collapsed[repo.repoId]
            return (
              <section key={repo.repoId} className="border-b border-border/60">
                <div className="flex items-center gap-2 px-3 py-2 hover:bg-panel/60">
                  <button
                    onClick={() =>
                      setCollapsed((prev) => ({ ...prev, [repo.repoId]: !prev[repo.repoId] }))
                    }
                    className="min-w-0 flex flex-1 items-center gap-2 text-left"
                  >
                    <span className={cn('text-muted text-[10px] transition-transform', open && 'rotate-90')}>
                      ▶
                    </span>
                    <span className="text-xs flex-1 truncate">{repo.repoName}</span>
                    <span className="hidden xl:inline text-[10px] text-muted truncate">
                      {repo.branch} · base {repo.baseBranch}
                    </span>
                    {repo.commitsAhead > 0 && (
                      <span className="text-[10px] text-accent tabular-nums">
                        {repo.prNumber
                          ? `${repo.commitsAhead} commit${repo.commitsAhead === 1 ? '' : 's'} in review`
                          : `${repo.commitsAhead} ahead`}
                      </span>
                    )}
                    <span className="text-[10px] text-muted tabular-nums">{visible.length}</span>
                    {repo.prNumber && (
                      <Pill tone="open">PR #{repo.prNumber}</Pill>
                    )}
                  </button>
                  <button
                    onClick={() => setRebranchRepo(repo)}
                    className="no-drag rounded border border-border bg-panel px-1.5 py-0.5 text-[10px] text-muted hover:text-text hover:bg-[#1d1d1d]"
                  >
                    Continue
                  </button>
                </div>
                {open && (
                  <ul>
                    {visible.length === 0 && (
                      <li className="px-3 py-2 text-[11px] text-muted italic">No changes</li>
                    )}
                    {visible.map((f) => (
                      <li
                        key={`${repo.repoId}-${f.path}-${f.state}`}
                        onClick={() => setSelected({ repo, file: f })}
                        className="group px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-panel/80"
                      >
                        <FileStatusGlyph status={f.status} state={f.state} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-mono truncate">{f.path}</div>
                          {f.state === 'uncommitted' && (
                            <div className="text-[9px] uppercase tracking-wider text-amber-400/80">
                              Uncommitted
                            </div>
                          )}
                        </div>
                        <div className="text-[10px] font-mono tabular-nums shrink-0">
                          <span className="text-green-400">+{f.additions}</span>{' '}
                          <span className="text-red-400">−{f.deletions}</span>
                        </div>
                      </li>
                    ))}
                    {repo.hasUncommitted && (
                      <li className="px-3 py-2 border-t border-border/40 bg-bg/35">
                        {repoCommit?.repoId === repo.repoId ? (
                          <div className="space-y-1.5">
                            <input
                              autoFocus
                              value={repoCommit.message}
                              onChange={(e) =>
                                setRepoCommit({ repoId: repo.repoId, message: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void commitRepo(repo)
                                else if (e.key === 'Escape') setRepoCommit(null)
                              }}
                              placeholder={`Commit message for ${repo.repoName}`}
                              className="no-drag w-full h-7 rounded bg-panel border border-border px-2 text-[11px] outline-none focus:border-accent"
                            />
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setRepoCommit(null)}
                                className="text-[11px] text-muted hover:text-text"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => void commitRepo(repo)}
                                disabled={repoCommitting === repo.repoId || repoPublishing === repo.repoId}
                                className="text-[11px] text-accent hover:text-text disabled:opacity-50"
                              >
                                {repoCommitting === repo.repoId ? 'Committing...' : 'Commit repo'}
                              </button>
                              <button
                                onClick={() => void commitRepo(repo, true)}
                                disabled={repoCommitting === repo.repoId || repoPublishing === repo.repoId}
                                className="text-[11px] text-accent hover:text-text disabled:opacity-50"
                              >
                                {repoPublishing === repo.repoId ? 'Publishing...' : 'Commit & publish'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 text-[11px] text-muted">
                              Uncommitted changes in this repo
                            </div>
                            <button
                              onClick={() =>
                                setRepoCommit({
                                  repoId: repo.repoId,
                                  message: `chore: update ${repo.repoName}`
                                })
                              }
                              disabled={repoCommitting !== null || repoPublishing !== null}
                              className="no-drag h-7 px-2.5 rounded-md border border-accent/40 bg-[#1a1414] text-[11px] text-accent hover:bg-[#221212] disabled:opacity-50"
                            >
                              Commit repo
                            </button>
                          </div>
                        )}
                      </li>
                    )}
                  </ul>
                )}
              </section>
            )
          })}
            </>
          )}
        </>
        <DevConsole featureId={featureId} repos={featureRepos} profiles={devProfiles} />
      </div>

      {selected && (
        <FileDiffModal
          repo={selected.repo}
          file={selected.file}
          onClose={() => setSelected(null)}
        />
      )}
      {rebranchRepo && (
        <RebranchRepoModal
          featureId={featureId}
          repo={rebranchRepo}
          onClose={() => setRebranchRepo(null)}
          onDone={() => {
            setRebranchRepo(null)
            void qc.invalidateQueries({ queryKey: ['feature-changes', featureId] })
            void qc.invalidateQueries({ queryKey: ['feature-repos', featureId] })
            void qc.invalidateQueries({ queryKey: ['feature', featureId] })
          }}
        />
      )}
    </div>
  )
}

function RebranchRepoModal({
  featureId,
  repo,
  onClose,
  onDone
}: {
  featureId: number
  repo: FeatureRepoChanges
  onClose: () => void
  onDone: () => void
}) {
  const [baseBranch, setBaseBranch] = useState(repo.baseBranch)
  const [branches, setBranches] = useState<string[]>([repo.baseBranch])
  const [discard, setDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.features
      .listRepoBranches(repo.repoId)
      .then((items) => {
        if (!cancelled) {
          setBranches(Array.from(new Set([repo.baseBranch, ...items])).filter(Boolean))
        }
      })
      .catch(() => {
        // Keep current base as the only option if branch discovery fails.
      })
    return () => {
      cancelled = true
    }
  }, [repo.baseBranch, repo.repoId])

  async function rebranch() {
    setBusy(true)
    setError(null)
    try {
      await window.api.features.rebranchRepo({
        featureId,
        repoId: repo.repoId,
        baseBranch,
        force: discard
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to continue repo from base')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <Card className="w-[460px] p-4">
        <div className="text-xs uppercase tracking-wider text-muted mb-1">
          Continue repo from base
        </div>
        <h3 className="text-base mb-2">{repo.repoName}</h3>
        <p className="text-xs leading-5 text-muted mb-4">
          This removes this feature's current worktree checkout for the repo and creates a new
          feature branch from the selected base. The old branch is left alone, and the old PR link
          is cleared for this repo.
        </p>
        <label className="block mb-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">Base branch</div>
          <select
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            disabled={busy}
            className="no-drag w-full rounded-md bg-panel border border-border px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          >
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-md border border-border bg-bg px-3 py-2 text-[11px] leading-5 text-muted">
          Current branch: <span className="font-mono text-text/80">{repo.branch}</span>
          <br />
          New branch: <span className="font-mono text-text/80">next available feature branch</span>
        </div>
        {repo.hasUncommitted && (
          <label className="mt-3 flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
            <input
              type="checkbox"
              checked={discard}
              onChange={(e) => setDiscard(e.target.checked)}
              disabled={busy}
              className="mt-0.5 accent-accent"
            />
            <span>
              Discard uncommitted changes in this repo worktree. Committed work and the old branch
              remain in git.
            </span>
          </label>
        )}
        {error && <div className="mt-3 text-xs text-red-300">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={rebranch}
            disabled={busy || !baseBranch.trim() || (repo.hasUncommitted && !discard)}
          >
            {busy ? 'Continuing...' : 'Continue from base'}
          </Button>
        </div>
      </Card>
    </Modal>
  )
}

function DevConsole({
  featureId,
  repos,
  profiles
}: {
  featureId: number
  repos: FeatureRepo[]
  profiles: DevProfile[]
}) {
  const storageKey = `feature-dev-command:${featureId}`
  const [repoId, setRepoId] = useState<number | null>(repos[0]?.repoId ?? null)
  const [cwd, setCwd] = useState('.')
  const [command, setCommand] = useState(() => {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem(storageKey) ?? ''
  })
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(profiles[0]?.id ?? null)
  const logRef = useRef<HTMLPreElement>(null)
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null
  const { data: setupState, refetch: refetchSetupState } = useQuery<DevSetupState>({
    queryKey: ['dev-setup-state', featureId, selectedProfileId],
    queryFn: () =>
      window.api.features.getDevSetupState({
        featureId,
        profileId: selectedProfileId!
      }),
    enabled: !!selectedProfileId,
    refetchInterval: 2000
  })

  useEffect(() => {
    if (repoId === null && repos[0]) setRepoId(repos[0].repoId)
  }, [repoId, repos])

  useEffect(() => {
    if (selectedProfileId === null && profiles[0]) setSelectedProfileId(profiles[0].id)
    if (selectedProfileId !== null && !profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(profiles[0]?.id ?? null)
    }
  }, [profiles, selectedProfileId])

  useEffect(() => {
    window.localStorage.setItem(storageKey, command)
  }, [command, storageKey])

  useEffect(() => {
    const unsub = window.api.features.onDevEvent((evt: FeatureDevCommandEvent) => {
      if (evt.featureId !== featureId) return
      if (evt.type === 'start') {
        setRunning(true)
        setError(null)
        setLogs((current) =>
          `${current}${current ? '\n' : ''}$ ${evt.command}\n# cwd: ${evt.cwd}\n`
        )
      } else if (evt.type === 'output') {
        setLogs((current) => current + evt.chunk)
      } else if (evt.type === 'exit') {
        setRunning(false)
        setLogs((current) => `${current}\n# exited with code ${evt.code ?? 'null'}\n`)
      } else if (evt.type === 'error') {
        setRunning(false)
        setError(evt.message)
        setLogs((current) => `${current}\n# error: ${evt.message}\n`)
      }
    })
    return unsub
  }, [featureId])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  async function start() {
    if (!repoId || !command.trim()) return
    setError(null)
    setLogs('')
    try {
      await window.api.features.runDevCommand({
        featureId,
        repoId,
        cwd,
        command
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to start command')
    }
  }

  async function runSetup() {
    if (!selectedProfile) return
    setError(null)
    setLogs('')
    try {
      await window.api.features.runDevSetup({ featureId, profileId: selectedProfile.id })
      void refetchSetupState()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to run setup')
    }
  }

  async function startProfile() {
    if (!selectedProfile) return
    setError(null)
    setLogs('')
    try {
      await window.api.features.runDevProfile({ featureId, profileId: selectedProfile.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to start dev command')
    }
  }

  async function stop() {
    await window.api.features.stopDevCommand(featureId)
  }

  return (
    <section className="border-t border-border/80 px-3 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted">Dev console</div>
          <div className="text-[11px] text-muted">Run a long-lived command in a feature worktree.</div>
        </div>
        {running && <span className="tb-pulse h-2 w-2 rounded-full bg-amber-300" />}
      </div>
      {profiles.length > 0 && (
        <div className="rounded-md border border-border bg-panel/50 p-2 space-y-2">
          <select
            value={selectedProfileId ?? ''}
            onChange={(e) => setSelectedProfileId(Number(e.target.value))}
            disabled={running}
            className="no-drag w-full rounded bg-bg border border-border px-2 py-1 text-[11px] outline-none"
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          {selectedProfile && (
            <>
              <div className="text-[10px] text-muted leading-4">
                {selectedProfile.repoName} / {selectedProfile.cwd || '.'}
                {setupState && (
                  <>
                    {' '}
                    · setup {setupState.status}
                  </>
                )}
              </div>
              <div className="flex gap-1.5">
                {selectedProfile.setupCommand && (
                  <button
                    onClick={runSetup}
                    disabled={running}
                    className="no-drag h-7 px-2 rounded border border-border bg-bg text-[11px] text-muted hover:text-text disabled:opacity-50"
                  >
                    {setupState?.status === 'running' ? 'Setting up...' : 'Run setup'}
                  </button>
                )}
                {running ? (
                  <button
                    onClick={stop}
                    className="no-drag h-7 px-2 rounded border border-red-900/70 bg-red-950/30 text-[11px] text-red-200 hover:bg-red-950/50"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={startProfile}
                    disabled={
                      !!selectedProfile.setupCommand &&
                      setupState?.status !== 'passed'
                    }
                    className="no-drag h-7 px-2 rounded border border-accent/40 bg-[#1a1414] text-[11px] text-accent hover:bg-[#221212] disabled:opacity-50"
                  >
                    Start dev
                  </button>
                )}
              </div>
              {setupState?.logs && (
                <details className="rounded border border-border/60 bg-bg">
                  <summary className="cursor-pointer px-2 py-1 text-[10px] text-muted hover:text-text">
                    Setup logs
                  </summary>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap px-2 pb-2 text-[10px] leading-4 text-text/70">
                    {setupState.logs}
                  </pre>
                </details>
              )}
            </>
          )}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-1.5">
        <select
          value={repoId ?? ''}
          onChange={(e) => setRepoId(Number(e.target.value))}
          disabled={running}
          className="no-drag min-w-0 rounded bg-panel border border-border px-2 py-1 text-[11px] outline-none"
        >
          {repos.map((repo) => (
            <option key={repo.repoId} value={repo.repoId}>
              {repo.repoName}
            </option>
          ))}
        </select>
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          disabled={running}
          placeholder="."
          className="no-drag rounded bg-panel border border-border px-2 py-1 text-[11px] font-mono outline-none focus:border-accent"
        />
      </div>
      <div className="flex gap-1.5">
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !running) void start()
          }}
          disabled={running}
          placeholder="npm run dev"
          className="no-drag min-w-0 flex-1 rounded bg-panel border border-border px-2 py-1 text-[11px] font-mono outline-none focus:border-accent"
        />
        {running ? (
          <button
            onClick={stop}
            className="no-drag h-7 px-2.5 rounded-md border border-red-900/70 bg-red-950/30 text-[11px] text-red-200 hover:bg-red-950/50"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={start}
            disabled={!repoId || !command.trim()}
            className="no-drag h-7 px-2.5 rounded-md border border-accent/40 bg-[#1a1414] text-[11px] text-accent hover:bg-[#221212] disabled:opacity-50"
          >
            Run
          </button>
        )}
      </div>
      {error && <div className="text-[10px] text-red-300">{error}</div>}
      <pre
        ref={logRef}
        className="h-48 overflow-auto rounded-md border border-border bg-[#0b0b0b] p-2 text-[10px] leading-4 text-text/75 whitespace-pre-wrap"
      >
        {logs || 'Console output will appear here.'}
      </pre>
    </section>
  )
}

function resultLabel(r: FeatureCommitResult): string {
  if (r.status === 'committed') {
    return `${r.filesCommitted} file${r.filesCommitted === 1 ? '' : 's'} committed`
  }
  if (r.status === 'published') {
    const committed =
      typeof r.filesCommitted === 'number'
        ? `${r.filesCommitted} file${r.filesCommitted === 1 ? '' : 's'} committed and `
        : ''
    return `${committed}published`
  }
  if (r.status === 'pulled') return 'pulled latest'
  if (r.status === 'clean') return 'nothing to do'
  return `failed - ${r.error}`
}

function FileStatusGlyph({
  status,
  state
}: {
  status: FeatureChangedFile['status']
  state: 'committed' | 'uncommitted'
}) {
  const letter =
    status === 'added' ? 'A' : status === 'deleted' ? 'D' : status === 'renamed' ? 'R' : 'M'
  const color =
    status === 'added'
      ? 'text-green-400'
      : status === 'deleted'
        ? 'text-red-400'
        : status === 'renamed'
          ? 'text-blue-400'
          : 'text-amber-400'
  return (
    <span
      className={cn(
        'w-4 h-4 shrink-0 flex items-center justify-center rounded border text-[10px] font-mono',
        color,
        'border-current/40',
        state === 'uncommitted' && 'border-dashed'
      )}
      title={`${status}${state === 'uncommitted' ? ' (uncommitted)' : ''}`}
    >
      {letter}
    </span>
  )
}

function FileDiffModal({
  repo,
  file,
  onClose
}: {
  repo: FeatureRepoChanges
  file: FeatureChangedFile
  onClose: () => void
}) {
  return (
    <Modal onClose={onClose}>
      <Card className="w-[1100px] h-[80vh] flex flex-col">
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted">
              {repo.repoName} · {repo.branch}
            </div>
            <div className="text-sm font-mono truncate">{file.path}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono tabular-nums">
              <span className="text-green-400">+{file.additions}</span>{' '}
              <span className="text-red-400">−{file.deletions}</span>
            </span>
            {file.state === 'uncommitted' && <Pill>uncommitted</Pill>}
            <Button onClick={onClose}>Close</Button>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-3">
          <DiffView path={file.path} patch={file.patch} />
        </div>
      </Card>
    </Modal>
  )
}

function ScopeTab({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 text-[10.5px] rounded transition-colors',
        active
          ? 'bg-panel text-text border border-border'
          : 'text-muted hover:text-text'
      )}
    >
      {children}
    </button>
  )
}
