import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings } from 'lucide-react'
import { Button, Pill } from '../components/ui'
import { cn } from '../lib/cn'
import { useApp } from '../stores/app'
import NewIssueModal from '../components/NewIssueModal'
import RunDrawer from '../components/RunDrawer'
import PRReviewModal from '../components/PRReviewModal'
import IssueDetailModal from '../components/IssueDetailModal'
import ItemRow from '../components/ItemRow'
import LoadMoreSentinel from '../components/LoadMoreSentinel'
import ReposPopover from '../components/ReposPopover'
import ProjectAgentSettingsModal from '../components/ProjectAgentSettingsModal'
import FeaturesView from './FeaturesView'
import PlanningView from './PlanningView'
import type { Issue, Project, PullRequest, Repo } from '@shared/types'

type IssueRow = Issue & { repo: Repo }
type PRRow = PullRequest & { repo: Repo }
type ProjectTab = 'issues' | 'features' | 'planning'

export default function ProjectView({
  projectId,
  initialTab = 'features',
  initialPlanId
}: {
  projectId: number
  initialTab?: ProjectTab
  initialPlanId?: number
}) {
  const setView = useApp((s) => s.setView)
  const runStatus = useApp((s) => s.run.status)
  const activeIssueRun = useApp((s) => s.run)
  const runRepoOwner = useApp((s) => s.selectedRepos[0]?.owner) // simple v0 ref
  void runRepoOwner

  const qc = useQueryClient()

  const { data: repos = [] } = useQuery({
    queryKey: ['repos', projectId],
    queryFn: () => window.api.projects.listRepos(projectId)
  })
  const { data: allProjects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => window.api.projects.list()
  })
  const project = allProjects.find((p) => p.id === projectId)
  const { data: activePlanIds = [] } = useQuery<number[]>({
    queryKey: ['active-plans', projectId],
    queryFn: () => window.api.plans.listActive(projectId),
    refetchInterval: 1500
  })
  const { data: activeFeatureIds = [] } = useQuery<number[]>({
    queryKey: ['active-features', projectId],
    queryFn: () => window.api.features.listActive(projectId),
    refetchInterval: 1500
  })

  const repoKey = repos.map((r) => r.id).join(',')

  const issuesQ = useInfiniteQuery({
    queryKey: ['issues', projectId, repoKey],
    initialPageParam: 1 as number,
    enabled: repos.length > 0,
    queryFn: async ({ pageParam }) => {
      const results = await Promise.all(
        repos.map(async (r) => {
          const { items, hasMore } = await window.api.github.listIssues(r.owner, r.name, pageParam)
          return { repo: r, items, hasMore }
        })
      )
      return { pageParam, results }
    },
    getNextPageParam: (lastPage) =>
      lastPage.results.some((r) => r.hasMore) ? (lastPage.pageParam as number) + 1 : undefined
  })

  const pullsQ = useInfiniteQuery({
    queryKey: ['pulls', projectId, repoKey],
    initialPageParam: 1 as number,
    enabled: repos.length > 0,
    queryFn: async ({ pageParam }) => {
      const results = await Promise.all(
        repos.map(async (r) => {
          const { items, hasMore } = await window.api.github.listPulls(r.owner, r.name, pageParam)
          return { repo: r, items, hasMore }
        })
      )
      return { pageParam, results }
    },
    getNextPageParam: (lastPage) =>
      lastPage.results.some((r) => r.hasMore) ? (lastPage.pageParam as number) + 1 : undefined
  })

  const issues: IssueRow[] = useMemo(() => {
    if (!issuesQ.data) return []
    return issuesQ.data.pages.flatMap((page) =>
      page.results.flatMap((r) =>
        r.items.map(
          (i) => ({ ...i, repo: r.repo, repoId: r.repo.id, id: i.number }) as IssueRow
        )
      )
    )
  }, [issuesQ.data])

  const pulls: PRRow[] = useMemo(() => {
    if (!pullsQ.data) return []
    return pullsQ.data.pages.flatMap((page) =>
      page.results.flatMap((r) =>
        r.items.map(
          (p) => ({ ...p, repo: r.repo, repoId: r.repo.id, id: p.number }) as PRRow
        )
      )
    )
  }, [pullsQ.data])

  const issuesRefreshing = issuesQ.isFetching
  const pullsRefreshing = pullsQ.isFetching

  const [selectedIssue, setSelectedIssue] = useState<IssueRow | null>(null)
  const [viewingIssue, setViewingIssue] = useState<IssueRow | null>(null)
  const [selectedPR, setSelectedPR] = useState<PRRow | null>(null)
  const [showNewIssue, setShowNewIssue] = useState(false)
  const [showProjectSettings, setShowProjectSettings] = useState(false)
  const [showRun, setShowRun] = useState(false)
  const [tab, setTab] = useState<ProjectTab>(initialTab)
  const [repoFilter, setRepoFilter] = useState<number | null>(null) // null = All
  const [prFilters, setPrFilters] = useState({
    open: true,
    merged: true,
    closed: false,
    draft: true
  })
  const [filterOpen, setFilterOpen] = useState(false)

  const issuesByRepo = useMemo(() => {
    const m = new Map<number, number>()
    for (const i of issues) m.set(i.repo.id, (m.get(i.repo.id) ?? 0) + 1)
    return m
  }, [issues])

  const pullsByRepo = useMemo(() => {
    const m = new Map<number, number>()
    for (const p of pulls) m.set(p.repo.id, (m.get(p.repo.id) ?? 0) + 1)
    return m
  }, [pulls])

  const filteredIssues = useMemo(
    () => (repoFilter ? issues.filter((i) => i.repo.id === repoFilter) : issues),
    [issues, repoFilter]
  )
  const visiblePulls = useMemo(
    () => {
      const stateFiltered = pulls.filter(
        (p) => prFilters[p.state as keyof typeof prFilters] ?? true
      )
      return repoFilter ? stateFiltered.filter((p) => p.repo.id === repoFilter) : stateFiltered
    },
    [pulls, prFilters, repoFilter]
  )
  const prCounts = useMemo(() => {
    const c = { open: 0, merged: 0, closed: 0, draft: 0 }
    for (const p of pulls) {
      if (p.state in c) c[p.state as keyof typeof c]++
    }
    return c
  }, [pulls])
  const hiddenCount = pulls.length - visiblePulls.length

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['issues', projectId] })
    void qc.invalidateQueries({ queryKey: ['pulls', projectId] })
  }

  const issueRunVisible =
    !!activeIssueRun.runId &&
    ['pending', 'running', 'awaiting-approval'].includes(activeIssueRun.status)

  async function resolveIssue(target: IssueRow | null = selectedIssue) {
    if (!target) return
    const r = target.repo
    setSelectedIssue(target)
    useApp.getState().resetRun()
    setShowRun(true)
    await window.api.runs.start({
      repoId: r.id,
      repoOwner: r.owner,
      repoName: r.name,
      defaultBranch: r.defaultBranch,
      issueNumber: target.number,
      issueTitle: target.title,
      issueBody: target.body ?? ''
    })
  }

  const runActive = !['idle', 'pushed', 'failed', 'cancelled'].includes(runStatus)

  function selectTab(next: ProjectTab) {
    setTab(next)
    setView({ kind: 'project', projectId, tab: next })
  }

  useEffect(() => {
    setTab(initialTab)
  }, [initialTab, projectId])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="h-14 border-b border-border flex items-center justify-between px-5 shrink-0 gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setView({ kind: 'projects' })}
            className="text-xs text-muted hover:text-text shrink-0"
          >
            ← Projects
          </button>
          <span className="text-muted/40 shrink-0">/</span>
          <h1 className="font-brand text-base truncate">{project?.name ?? '…'}</h1>
        </div>
        <div className="flex items-center justify-center flex-1">
          <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-panel/40 p-1 shadow-inner shadow-black/10">
            <TabPill
              active={tab === 'features'}
              working={activeFeatureIds.length > 0}
              onClick={() => selectTab('features')}
            >
              Features
            </TabPill>
            <TabPill
              active={tab === 'planning'}
              working={activePlanIds.length > 0}
              onClick={() => selectTab('planning')}
            >
              Planning
            </TabPill>
            <TabPill active={tab === 'issues'} working={issueRunVisible} onClick={() => selectTab('issues')}>
              Issues
            </TabPill>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {issueRunVisible && activeIssueRun.repoOwner && activeIssueRun.repoName && (
            <button
              onClick={() => setShowRun(true)}
              className="no-drag"
              title="Open active issue run"
            >
              <Pill tone="running">Working</Pill>
            </button>
          )}
          <button
            onClick={() => setShowProjectSettings(true)}
            title="Project settings"
            aria-label="Project settings"
            className="no-drag w-8 h-8 rounded-md border border-border bg-panel hover:bg-[#1d1d1d] text-muted hover:text-text flex items-center justify-center transition-colors"
          >
            <Settings size={15} />
          </button>
          <ReposPopover repos={repos} />
        </div>
      </header>

      <div className="flex-1 flex flex-col overflow-hidden">
        {tab === 'features' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <FeaturesView projectId={projectId} repos={repos} />
          </div>
        )}

        {tab === 'planning' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <PlanningView projectId={projectId} repos={repos} initialPlanId={initialPlanId} />
          </div>
        )}

        {tab === 'issues' && (
      <div className="flex-1 flex flex-col overflow-hidden">
        {repos.length > 1 && (
          <RepoFilterBar
            repos={repos}
            selected={repoFilter}
            onSelect={setRepoFilter}
            issuesByRepo={issuesByRepo}
            pullsByRepo={pullsByRepo}
          />
        )}
      <main className="flex-1 grid grid-cols-2 overflow-hidden min-h-0">
        {/* Issues */}
        <section className="border-r border-border flex flex-col min-h-0 overflow-hidden">
          <header className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm">Issues</h2>
              <span className="text-xs text-muted">{filteredIssues.length}</span>
              {issuesRefreshing && (
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted">
                  <span className="tb-pulse inline-block w-1.5 h-1.5 rounded-full bg-accent" />
                  refreshing
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={refresh}
                title="Refresh"
                aria-label="Refresh"
                className={cn(
                  'no-drag w-8 h-8 rounded-md border border-border bg-panel hover:bg-[#1d1d1d] flex items-center justify-center text-muted hover:text-text transition-colors',
                  issuesRefreshing && 'tb-spin'
                )}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 3v3.5H10"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <Button variant="primary" onClick={() => setShowNewIssue(true)}>
                + Add Issue
              </Button>
            </div>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {filteredIssues.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-muted">
                {issues.length === 0
                  ? 'No issues. Add one to get started.'
                  : 'No issues match the repo filter.'}
              </div>
            ) : (
              <ul>
                {filteredIssues.map((i) => {
                  const active =
                    selectedIssue?.repo.id === i.repo.id && selectedIssue?.number === i.number
                  return (
                    <li key={`${i.repo.id}-${i.number}`}>
                      <ItemRow
                        kind="issue"
                        number={i.number}
                        title={i.title}
                        state={i.state}
                        repoName={i.repo.name}
                        active={active}
                        onClick={() => setSelectedIssue(i)}
                        onOpen={() => {
                          setSelectedIssue(i)
                          setViewingIssue(i)
                        }}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
            <LoadMoreSentinel
              hasMore={!!issuesQ.hasNextPage}
              isLoading={issuesQ.isFetchingNextPage}
              onIntersect={() => issuesQ.fetchNextPage()}
              label="Loading more issues…"
            />
          </div>
          {selectedIssue && (
            <footer className="border-t border-border p-3 flex items-center justify-between">
              <div className="text-xs text-muted truncate">
                Selected: #{selectedIssue.number} {selectedIssue.title}
              </div>
              <Button
                variant="primary"
                disabled={runActive}
                onClick={() => resolveIssue()}
                title={runActive ? 'A run is in progress' : ''}
              >
                Resolve Issue
              </Button>
            </footer>
          )}
        </section>

        {/* Pull requests */}
        <section className="flex flex-col min-h-0 overflow-hidden">
          <header className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm">Pull requests</h2>
              <span className="text-xs text-muted">{visiblePulls.length}</span>
              {pullsRefreshing && (
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted">
                  <span className="tb-pulse inline-block w-1.5 h-1.5 rounded-full bg-accent" />
                  refreshing
                </span>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => setFilterOpen((v) => !v)}
                title="Filter pull requests"
                aria-label="Filter pull requests"
                className={cn(
                  'no-drag flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border text-xs transition-colors',
                  filterOpen
                    ? 'bg-[#1a1414] text-text border-accent/40'
                    : 'bg-panel text-muted hover:text-text hover:bg-[#1d1d1d]'
                )}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M2 4h12M4 8h8M6 12h4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                Filter
                {hiddenCount > 0 && (
                  <span className="text-[10px] text-accent">{visiblePulls.length}/{pulls.length}</span>
                )}
              </button>
              {filterOpen && (
                <FilterPopover
                  filters={prFilters}
                  counts={prCounts}
                  onChange={setPrFilters}
                  onClose={() => setFilterOpen(false)}
                />
              )}
            </div>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {visiblePulls.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-muted">
                {pulls.length === 0
                  ? 'No pull requests yet.'
                  : `${hiddenCount} hidden by filter.`}
              </div>
            ) : (
              <ul>
                {visiblePulls.map((p) => (
                  <li key={`${p.repo.id}-${p.number}`}>
                    <ItemRow
                      kind="pr"
                      number={p.number}
                      title={p.title}
                      state={p.state}
                      repoName={p.repo.name}
                      meta={
                        p.linkedIssueNumber
                          ? `closes #${p.linkedIssueNumber}`
                          : `${p.headBranch} → ${p.baseBranch}`
                      }
                      onClick={() => setSelectedPR(p)}
                      onOpen={() => setSelectedPR(p)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <LoadMoreSentinel
              hasMore={!!pullsQ.hasNextPage}
              isLoading={pullsQ.isFetchingNextPage}
              onIntersect={() => pullsQ.fetchNextPage()}
              label="Loading more pull requests…"
            />
          </div>
        </section>
      </main>
      </div>
        )}
      </div>

      {showNewIssue && (
        <NewIssueModal
          projectId={projectId}
          repos={repos}
          onClose={() => setShowNewIssue(false)}
          onCreated={(created) => {
            setShowNewIssue(false)
            const repo = repos.find((r) => r.id === created.repoId)
            if (!repo) return
            const key = ['issues', projectId, repoKey] as const
            const fresh = {
              number: created.number,
              title: created.title,
              body: created.body,
              state: created.state,
              url: created.url,
              updatedAt: created.updatedAt
            }
            qc.setQueryData(key, (data: any) => {
              if (!data) return data
              const pages = data.pages.slice()
              if (pages[0]) {
                const idx = pages[0].results.findIndex((r: any) => r.repo.id === repo.id)
                if (idx !== -1) {
                  const r = pages[0].results[idx]
                  if (!r.items.some((it: any) => it.number === fresh.number)) {
                    pages[0] = {
                      ...pages[0],
                      results: pages[0].results.map((rr: any, i: number) =>
                        i === idx ? { ...rr, items: [fresh, ...rr.items] } : rr
                      )
                    }
                  }
                }
              }
              return { ...data, pages }
            })
            void qc.refetchQueries({ queryKey: ['issues', projectId, repoKey] })
          }}
        />
      )}
      {showProjectSettings && project && (
        <ProjectAgentSettingsModal
          project={project}
          onClose={() => setShowProjectSettings(false)}
        />
      )}
      {showRun && (
        <RunDrawer
          onClose={() => setShowRun(false)}
          repoOwner={selectedIssue?.repo.owner ?? activeIssueRun.repoOwner ?? ''}
          repoName={selectedIssue?.repo.name ?? activeIssueRun.repoName ?? ''}
          issueNumber={selectedIssue?.number ?? activeIssueRun.issueNumber ?? 0}
          onPushed={() => {
            refresh()
          }}
        />
      )}
      {viewingIssue && (
        <IssueDetailModal
          issue={viewingIssue}
          repo={viewingIssue.repo}
          onClose={() => setViewingIssue(null)}
          resolveDisabled={runActive}
          onResolve={() => {
            const target = viewingIssue
            setViewingIssue(null)
            void resolveIssue(target)
          }}
        />
      )}
      {selectedPR && (
        <PRReviewModal
          repoOwner={selectedPR.repo.owner}
          repoName={selectedPR.repo.name}
          number={selectedPR.number}
          onClose={() => setSelectedPR(null)}
          onMerged={() => {
            setSelectedPR(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function RepoFilterBar({
  repos,
  selected,
  onSelect,
  issuesByRepo,
  pullsByRepo
}: {
  repos: Repo[]
  selected: number | null
  onSelect: (id: number | null) => void
  issuesByRepo: Map<number, number>
  pullsByRepo: Map<number, number>
}) {
  const totalIssues = Array.from(issuesByRepo.values()).reduce((a, b) => a + b, 0)
  const totalPulls = Array.from(pullsByRepo.values()).reduce((a, b) => a + b, 0)
  return (
    <div className="border-b border-border shrink-0">
      <div className="flex items-center gap-2 px-4 py-2.5 overflow-x-auto">
        <RepoFilterPill active={selected === null} onClick={() => onSelect(null)}>
          <span>All</span>
          <span className="text-[10px] text-muted/80 tabular-nums">
            {totalIssues + totalPulls}
          </span>
        </RepoFilterPill>
        {repos.map((r) => {
          const c = (issuesByRepo.get(r.id) ?? 0) + (pullsByRepo.get(r.id) ?? 0)
          return (
            <RepoFilterPill
              key={r.id}
              active={selected === r.id}
              onClick={() => onSelect(r.id)}
            >
              <RepoAvatar owner={r.owner} />
              <span className="truncate max-w-[140px]">{r.name}</span>
              <span className="text-[10px] text-muted/80 tabular-nums">{c}</span>
            </RepoFilterPill>
          )
        })}
      </div>
    </div>
  )
}

function RepoFilterPill({
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
        'no-drag h-7 px-2.5 rounded-full border text-[11.5px] flex items-center gap-1.5 shrink-0 transition-colors',
        active
          ? 'bg-[#1a1414] text-text border-accent/40'
          : 'bg-panel text-muted hover:text-text border-border hover:bg-[#1d1d1d]'
      )}
    >
      {children}
    </button>
  )
}

function RepoAvatar({ owner }: { owner: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className="w-4 h-4 rounded-full bg-bg border border-border flex items-center justify-center text-[8px] text-muted">
        {owner.charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={`https://github.com/${encodeURIComponent(owner)}.png?size=32`}
      alt=""
      onError={() => setFailed(true)}
      className="w-4 h-4 rounded-full border border-border bg-bg object-cover"
    />
  )
}

function TabPill({
  active,
  onClick,
  working,
  children
}: {
  active: boolean
  onClick: () => void
  working?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative h-8 px-5 text-sm font-medium rounded-full transition-all min-w-[112px]',
        active
          ? 'bg-[#24201d] text-text shadow-sm shadow-black/20 ring-1 ring-white/5'
          : 'text-muted hover:text-text hover:bg-white/[0.03]'
      )}
    >
      {working && (
        <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-300 tb-pulse align-middle" />
      )}
      {children}
    </button>
  )
}

type PRFilters = { open: boolean; merged: boolean; closed: boolean; draft: boolean }
type PRCounts = { open: number; merged: number; closed: number; draft: number }

function FilterPopover({
  filters,
  counts,
  onChange,
  onClose
}: {
  filters: PRFilters
  counts: PRCounts
  onChange: (f: PRFilters) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [onClose])

  const rows: { key: keyof PRFilters; label: string; tone: string }[] = [
    { key: 'open', label: 'Open', tone: 'bg-green-400' },
    { key: 'merged', label: 'Merged', tone: 'bg-purple-400' },
    { key: 'closed', label: 'Closed', tone: 'bg-red-400' },
    { key: 'draft', label: 'Draft', tone: 'bg-muted' }
  ]

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 w-60 z-30 rounded-md border border-border bg-panel shadow-xl overflow-hidden"
    >
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted border-b border-border">
        Filter by status
      </div>
      <ul className="py-1">
        {rows.map(({ key, label, tone }) => {
          const count = counts[key]
          const disabled = count === 0
          return (
            <li key={key}>
              <label
                className={cn(
                  'flex items-center gap-2.5 px-3 py-1.5 text-xs cursor-pointer hover:bg-[#1d1d1d]',
                  disabled && 'opacity-50 cursor-not-allowed'
                )}
              >
                <input
                  type="checkbox"
                  checked={filters[key]}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...filters, [key]: e.target.checked })}
                  className="accent-accent"
                />
                <span className={cn('w-2 h-2 rounded-full', tone)} />
                <span className="flex-1">{label}</span>
                <span className="text-[10px] text-muted/70 tabular-nums">{count}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-bg/40">
        <button
          className="text-[11px] text-muted hover:text-text"
          onClick={() =>
            onChange({ open: true, merged: true, closed: true, draft: true })
          }
        >
          Select all
        </button>
        <button
          className="text-[11px] text-muted hover:text-text"
          onClick={() =>
            onChange({ open: true, merged: true, closed: false, draft: true })
          }
        >
          Reset
        </button>
      </div>
    </div>
  )
}
