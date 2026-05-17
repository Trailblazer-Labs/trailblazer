import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Input } from './ui'
import { Modal } from './NewIssueModal'
import { cn } from '../lib/cn'
import type { Feature, Repo } from '@shared/types'

type Mode = 'create' | 'import'

export default function NewFeatureModal({
  projectId,
  repos,
  feature,
  existingRepoIds = [],
  onClose,
  onCreated
}: {
  projectId: number
  repos: Repo[]
  feature?: Feature
  existingRepoIds?: number[]
  onClose: () => void
  onCreated: (f: Feature) => void
}) {
  const [mode, setMode] = useState<Mode>('create')
  const [name, setName] = useState(feature?.name ?? '')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Import-mode: per-repo selection (existing branch or new branch).
  const [importSelections, setImportSelections] = useState<
    Record<number, { kind: 'existing' | 'new'; value: string; baseBranch?: string }>
  >({})
  const [createBaseBranches, setCreateBaseBranches] = useState<Record<number, string>>({})

  const addingToFeature = !!feature
  const availableRepos = useMemo(
    () => repos.filter((repo) => !existingRepoIds.includes(repo.id)),
    [existingRepoIds, repos]
  )
  const slug = useMemo(() => feature?.slug ?? slugify(name), [feature?.slug, name])

  function toggleRepo(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  async function submit() {
    if (!addingToFeature && !name.trim()) {
      setError('Name is required')
      return
    }
    if (selectedIds.length === 0) {
      setError('Pick at least one repo')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (mode === 'create') {
        const baseBranches = selectedIds.reduce<Record<number, string>>((acc, repoId) => {
          const branch = createBaseBranches[repoId]?.trim()
          if (branch) acc[repoId] = branch
          return acc
        }, {})
        if (addingToFeature && feature) {
          const { feature: updated } = await window.api.features.addRepos({
            featureId: feature.id,
            repos: selectedIds.map((repoId) => ({
              repoId,
              newBranch: `feature/${feature.slug}`,
              baseBranch: baseBranches[repoId]
            }))
          })
          onCreated(updated)
        } else {
          const { feature } = await window.api.features.create({
            projectId,
            name: name.trim(),
            repoIds: selectedIds,
            baseBranches
          })
          onCreated(feature)
        }
      } else {
        const repos = selectedIds.map((repoId) => {
          const sel = importSelections[repoId]
          if (!sel) throw new Error('Missing selection for one of the repos')
          return sel.kind === 'existing'
            ? { repoId, existingBranch: sel.value, baseBranch: sel.baseBranch }
            : { repoId, newBranch: sel.value, baseBranch: sel.baseBranch }
        })
        if (addingToFeature && feature) {
          const { feature: updated } = await window.api.features.addRepos({
            featureId: feature.id,
            repos
          })
          onCreated(updated)
        } else {
          const { feature } = await window.api.features.import({
            projectId,
            name: name.trim(),
            repos
          })
          onCreated(feature)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <Card className="w-[720px] max-h-[85vh] flex flex-col p-6">
        <div className="text-sm text-muted mb-1">
          {addingToFeature ? 'Add repositories' : 'New feature'}
        </div>
        <h2 className="font-brand text-xl mb-4">
          {addingToFeature ? `Add repos to ${feature?.name}` : 'Spin up branches across your repos'}
        </h2>

        <div className="inline-flex p-1 rounded-md bg-bg border border-border mb-5 w-fit">
          <ModeTab active={mode === 'create'} onClick={() => setMode('create')}>
            Create
          </ModeTab>
          <ModeTab active={mode === 'import'} onClick={() => setMode('import')}>
            Import
          </ModeTab>
        </div>

        <div className="space-y-3 mb-4">
          {!addingToFeature && (
            <Input
              placeholder="Feature name (e.g. dark-mode)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          )}
          {mode === 'create' && name.trim() && (
            <div className="text-[11px] text-muted">
              Will create branch <code className="text-accent">feature/{slug}</code> in each selected
              repo, off the selected base branch.
            </div>
          )}
        </div>

        <div className="text-xs uppercase tracking-wider text-muted mb-2">Repositories</div>
        <div className="flex-1 overflow-auto rounded-md border border-border bg-bg">
          {availableRepos.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted">No repositories in this project.</div>
          )}
          {availableRepos.map((r) => {
            const active = selectedIds.includes(r.id)
            return (
              <div key={r.id} className="border-b border-border/60 last:border-b-0">
                <label
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 cursor-pointer',
                    active && 'bg-[#1a1414]'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleRepo(r.id)}
                    className="accent-accent"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">
                      <span className="text-muted">{r.owner}/</span>
                      {r.name}
                    </div>
                    <div className="text-[10px] text-muted">
                      base: {r.workingBranch ?? r.defaultBranch}
                    </div>
                  </div>
                </label>
                {active && mode === 'import' && (
                  <ImportRepoControls
                    repoId={r.id}
                    defaultBase={r.workingBranch ?? r.defaultBranch}
                    selection={importSelections[r.id]}
                    onChange={(sel) =>
                      setImportSelections((prev) => ({ ...prev, [r.id]: sel }))
                    }
                  />
                )}
                {active && mode === 'create' && (
                  <CreateRepoControls
                    repoId={r.id}
                    defaultBase={r.workingBranch ?? r.defaultBranch}
                    value={createBaseBranches[r.id]}
                    onChange={(branch) =>
                      setCreateBaseBranches((prev) => ({ ...prev, [r.id]: branch }))
                    }
                  />
                )}
              </div>
            )
          })}
        </div>

        {error && <div className="text-red-400 text-xs mt-3">{error}</div>}

        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy
              ? 'Working…'
              : addingToFeature
                ? 'Add repos'
                : mode === 'create'
                  ? 'Create feature'
                  : 'Import feature'}
          </Button>
        </div>
      </Card>
    </Modal>
  )
}

function ModeTab({
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
        'px-3 py-1.5 text-xs rounded transition-colors',
        active ? 'bg-panel text-text border border-border' : 'text-muted hover:text-text'
      )}
    >
      {children}
    </button>
  )
}

function CreateRepoControls({
  repoId,
  defaultBase,
  value,
  onChange
}: {
  repoId: number
  defaultBase: string
  value?: string
  onChange: (branch: string) => void
}) {
  return (
    <div className="px-3 pb-3 pl-10">
      <BaseBranchSelect
        repoId={repoId}
        value={value ?? defaultBase}
        defaultBase={defaultBase}
        onChange={onChange}
      />
    </div>
  )
}

function ImportRepoControls({
  repoId,
  defaultBase,
  selection,
  onChange
}: {
  repoId: number
  defaultBase: string
  selection?: { kind: 'existing' | 'new'; value: string; baseBranch?: string }
  onChange: (s: { kind: 'existing' | 'new'; value: string; baseBranch?: string }) => void
}) {
  const [branches, setBranches] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const kind = selection?.kind ?? 'existing'
  const baseBranch = selection?.baseBranch ?? defaultBase

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api.features
      .listRepoBranches(repoId)
      .then((b) => {
        if (!cancelled) setBranches(b)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [repoId])

  return (
    <div className="px-3 pb-3 pl-10 space-y-2">
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name={`mode-${repoId}`}
            checked={kind === 'existing'}
            onChange={() =>
              onChange({ kind: 'existing', value: selection?.value ?? '', baseBranch })
            }
            className="accent-accent"
          />
          Existing branch
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name={`mode-${repoId}`}
            checked={kind === 'new'}
            onChange={() =>
              onChange({ kind: 'new', value: selection?.value ?? '', baseBranch })
            }
            className="accent-accent"
          />
          New branch
        </label>
      </div>
      {kind === 'existing' ? (
        <select
          className="w-full rounded-md bg-panel border border-border px-2.5 py-1.5 text-xs outline-none"
          value={selection?.value ?? ''}
          onChange={(e) =>
            onChange({ kind: 'existing', value: e.target.value, baseBranch })
          }
        >
          <option value="" disabled>
            {loading ? 'Loading branches…' : 'Pick a branch'}
          </option>
          {branches?.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      ) : (
        <Input
          placeholder="new-branch-name"
          value={selection?.value ?? ''}
          onChange={(e) =>
            onChange({ kind: 'new', value: e.target.value, baseBranch })
          }
        />
      )}
      <BaseBranchSelect
        repoId={repoId}
        value={baseBranch}
        defaultBase={defaultBase}
        onChange={(baseBranch) =>
          onChange({
            kind,
            value: selection?.value ?? '',
            baseBranch
          })
        }
      />
    </div>
  )
}

function BaseBranchSelect({
  repoId,
  value,
  defaultBase,
  onChange
}: {
  repoId: number
  value: string
  defaultBase: string
  onChange: (branch: string) => void
}) {
  const [branches, setBranches] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api.features
      .listRepoBranches(repoId)
      .then((b) => {
        if (!cancelled) setBranches(b)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [repoId])

  const options = branches?.includes(value) ? branches : [value, ...(branches ?? [])]

  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">
        Base branch
      </div>
      <select
        className="w-full rounded-md bg-panel border border-border px-2.5 py-1.5 text-xs outline-none focus:border-accent"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {loading && !branches && <option value={value}>Loading branches...</option>}
        {!loading && options.length === 0 && <option value={defaultBase}>{defaultBase}</option>}
        {options.map((branch) => (
          <option key={branch} value={branch}>
            {branch}
            {branch === defaultBase ? ' (current)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_ ]+/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}
