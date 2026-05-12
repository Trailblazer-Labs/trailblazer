import { useEffect, useMemo, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Github, Plus, X } from 'lucide-react'
import { Button, Card, Input } from '../components/ui'
import { useApp } from '../stores/app'
import RepoPicker from '../components/RepoPicker'
import { Modal } from '../components/NewIssueModal'
import { FireLogo } from '../components/FireLogo'
import SettingsModal from '../components/SettingsModal'
import type { Project, Repo, RepoSearchResult } from '@shared/types'

export default function Projects() {
  const setView = useApp((s) => s.setView)
  const qc = useQueryClient()

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => window.api.projects.list()
  })

  const repoQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ['repos', p.id],
      queryFn: () => window.api.projects.listRepos(p.id)
    }))
  })

  const reposByProject = useMemo(() => {
    const m = new Map<number, Repo[]>()
    projects.forEach((p, i) => m.set(p.id, repoQueries[i]?.data ?? []))
    return m
  }, [projects, repoQueries])

  const [creating, setCreating] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showContributeBanner, setShowContributeBanner] = useState(
    () => localStorage.getItem('trailblazer.contributeBanner.hidden') !== 'true'
  )
  const [addingTrailblazer, setAddingTrailblazer] = useState(false)
  const [contributeError, setContributeError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => p.name.toLowerCase().includes(q))
  }, [projects, query])

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['projects'] })
    void qc.invalidateQueries({ queryKey: ['repos'] })
  }

  async function addTrailblazerProject() {
    setAddingTrailblazer(true)
    setContributeError(null)
    try {
      const project = await window.api.projects.addTrailblazer()
      localStorage.setItem('trailblazer.contributeBanner.hidden', 'true')
      setShowContributeBanner(false)
      refresh()
      setView({ kind: 'project', projectId: project.id })
    } catch (e) {
      setContributeError(e instanceof Error ? e.message : 'failed to add Trailblazer')
    } finally {
      setAddingTrailblazer(false)
    }
  }

  function hideContributeBanner() {
    localStorage.setItem('trailblazer.contributeBanner.hidden', 'true')
    setShowContributeBanner(false)
  }

  return (
    <div className="h-full overflow-auto">
      {/* hero header */}
      <div className="max-w-6xl mx-auto px-10 pt-10 pb-6">
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <FireLogo size={36} flicker />
              <h1 className="font-brand text-3xl tracking-tight">Trailblazer</h1>
            </div>
            <p className="text-sm text-muted max-w-lg">
              Group repositories into projects. Describe issues, let your coding agent resolve them,
              then review and merge from one place.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              title="Settings"
              aria-label="Settings"
              className="no-drag w-10 h-10 rounded-md border border-border bg-panel hover:bg-[#1d1d1d] text-muted hover:text-text flex items-center justify-center transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <Button variant="primary" className="px-4 py-2" onClick={() => setCreating(true)}>
              + New project
            </Button>
          </div>
        </div>
      </div>

      {/* search bar */}
      <div className="max-w-6xl mx-auto px-10">
        <div className="relative">
          <Input
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">⌕</span>
        </div>
      </div>

      {/* content */}
      <div className="max-w-6xl mx-auto px-10 py-8">
        {projects.length === 0 ? (
          <EmptyState onCreate={() => setCreating(true)} />
        ) : filtered.length === 0 ? (
          <div className="text-center text-sm text-muted py-16">
            No projects match “{query}”.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                repos={reposByProject.get(p.id) ?? []}
                onOpen={() => setView({ kind: 'project', projectId: p.id })}
                onDeleted={refresh}
              />
            ))}
          </div>
        )}
      </div>

      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <CreateProjectCard
            onClose={() => setCreating(false)}
            onCreated={(p) => {
              setCreating(false)
              refresh()
              setView({ kind: 'project', projectId: p.id })
            }}
          />
        </Modal>
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showContributeBanner && (
        <ContributeBanner
          busy={addingTrailblazer}
          error={contributeError}
          onAdd={addTrailblazerProject}
          onHide={hideContributeBanner}
        />
      )}
    </div>
  )
}

function ContributeBanner({
  busy,
  error,
  onAdd,
  onHide
}: {
  busy: boolean
  error: string | null
  onAdd: () => void
  onHide: () => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-5 z-30 pointer-events-none px-5">
      <div className="pointer-events-auto mx-auto flex max-w-4xl items-center gap-3 rounded-lg border border-accent/35 bg-[#15110f]/95 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg">
          <Github size={18} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm">Contribute to Trailblazer</div>
          <div className="truncate text-xs text-muted">
            Add the Trailblazer repo as a normal project with issues, features, and PRs ready to use.
            {error && <span className="ml-2 text-red-400">{error}</span>}
          </div>
        </div>
        <Button variant="primary" onClick={onAdd} disabled={busy} className="shrink-0">
          <Plus size={14} />
          {busy ? 'Adding...' : 'Add project'}
        </Button>
        <button
          type="button"
          onClick={onHide}
          aria-label="Hide contribute banner"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel hover:text-text"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  repos,
  onOpen,
  onDeleted
}: {
  project: Project
  repos: Repo[]
  onOpen: () => void
  onDeleted: () => void
}) {
  const [menu, setMenu] = useState(false)
  const owners = Array.from(new Set(repos.map((r) => r.owner)))
  return (
    <div
      onClick={onOpen}
      className="group relative cursor-pointer rounded-xl border border-border bg-panel p-5 hover:border-accent/60 hover:bg-[#1a1414] transition-colors"
    >
      <div className="flex items-start justify-between mb-3">
        <ProjectAvatar owners={owners} />

        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenu((v) => !v)
          }}
          className="text-muted hover:text-text px-1 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="project menu"
        >
          ⋯
        </button>
        {menu && (
          <div
            className="absolute right-3 top-12 z-10 bg-bg border border-border rounded-md shadow-lg text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="block w-full text-left px-3 py-1.5 text-red-400 hover:bg-panel"
              onClick={async () => {
                setMenu(false)
                await window.api.projects.delete(project.id)
                onDeleted()
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      <div className="text-base mb-1 truncate">{project.name}</div>
      <div className="text-xs text-muted mb-4">
        {repos.length} {repos.length === 1 ? 'repository' : 'repositories'}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {repos.slice(0, 4).map((r) => (
          <span
            key={r.id}
            className="text-[10px] uppercase tracking-wider bg-[#222] text-muted px-1.5 py-0.5 rounded"
          >
            {r.name}
          </span>
        ))}
        {repos.length > 4 && (
          <span className="text-[10px] text-muted">+{repos.length - 4}</span>
        )}
      </div>
    </div>
  )
}

function ProjectAvatar({ owners }: { owners: string[] }) {
  // Use the first owner's GitHub avatar; stack a tiny "+N" chip if there are multiple.
  const primary = owners[0]
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  if (!primary || failed[primary]) {
    return (
      <div className="w-9 h-9 rounded-lg bg-[#1f1614] flex items-center justify-center border border-border">
        <FireLogo size={22} />
      </div>
    )
  }
  return (
    <div className="relative">
      <img
        src={`https://github.com/${encodeURIComponent(primary)}.png?size=72`}
        alt={primary}
        onError={() => setFailed((f) => ({ ...f, [primary]: true }))}
        className="w-9 h-9 rounded-lg border border-border bg-bg object-cover"
      />
      {owners.length > 1 && (
        <span className="absolute -bottom-1 -right-1 text-[9px] bg-bg border border-border rounded-full px-1.5 py-px text-muted">
          +{owners.length - 1}
        </span>
      )}
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="text-center py-20">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-[#1f1614] border border-border mb-6">
        <FireLogo size={48} flicker />
      </div>
      <h2 className="text-lg mb-2">Light your first project</h2>
      <p className="text-sm text-muted max-w-md mx-auto mb-6">
        A project groups one or more repositories. Issues and pull requests across them show up
        side-by-side.
      </p>
      <Button variant="primary" onClick={onCreate}>
        + New project
      </Button>
    </div>
  )
}

function CreateProjectCard({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: (p: Project) => void
}) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<RepoSearchResult[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
  }, [name, picked])

  async function create() {
    if (!name.trim() || picked.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const p = await window.api.projects.create(name.trim())
      for (const r of picked) {
        await window.api.projects.addRepo(p.id, {
          owner: r.owner,
          name: r.name,
          defaultBranch: r.defaultBranch
        })
      }
      onCreated(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to create')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="w-[640px] max-h-[80vh] overflow-auto p-6 space-y-4">
      <div className="text-sm text-muted">New project</div>
      <Input
        autoFocus
        placeholder="Project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-2">Repositories</div>
        <RepoPicker selected={picked} onChange={setPicked} />
      </div>
      {error && <div className="text-red-400 text-xs">{error}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || !name.trim() || picked.length === 0}
          onClick={create}
        >
          {busy ? 'Cloning…' : 'Create project'}
        </Button>
      </div>
    </Card>
  )
}
