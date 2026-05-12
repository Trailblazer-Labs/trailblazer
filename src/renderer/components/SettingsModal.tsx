import { useEffect, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Github, Plus } from 'lucide-react'
import { Button, Card } from './ui'
import { Modal } from './NewIssueModal'
import EnginePicker from './EnginePicker'
import { useApp } from '../stores/app'
import { mergedModels } from '@shared/models'
import type { ModelUseCase } from '@shared/models'
import type { AppConfig, Engine, EngineDetection, UpdateStatus } from '@shared/types'

export default function SettingsModal({ onClose }: { onClose: () => void }) {
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
  const [detect, setDetect] = useState<EngineDetection | null>(null)
  const [engine, setEngine] = useState<Engine | null>(null)
  const [original, setOriginal] = useState<Engine | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [addingTrailblazer, setAddingTrailblazer] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    const [d, cfg, updater] = await Promise.all([
      window.api.config.detectEngines(),
      window.api.config.get(),
      window.api.updater.getStatus()
    ])
    setDetect(d)
    setConfig(cfg)
    setUpdateStatus(updater)
    setEngine(cfg.engine)
    setOriginal(cfg.engine)
  }

  useEffect(() => {
    reload()
    const unsubscribe = window.api.updater.onEvent(setUpdateStatus)
    return unsubscribe
  }, [])

  async function save() {
    if (!engine || !detect) return
    setBusy(true)
    setError(null)
    try {
      await window.api.config.setEngine({ engine, path: detect[engine].path })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!confirm('Sign out of GitHub? You will need to sign in again to use Trailblazer.')) return
    await window.api.gh.signOut()
    onClose()
    // Trigger a reload by reloading the renderer
    location.reload()
  }

  async function addTrailblazerProject() {
    setAddingTrailblazer(true)
    setError(null)
    try {
      const project = await window.api.projects.addTrailblazer()
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['projects'] }),
        qc.invalidateQueries({ queryKey: ['repos'] })
      ])
      onClose()
      setView({ kind: 'project', projectId: project.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to add Trailblazer')
    } finally {
      setAddingTrailblazer(false)
    }
  }

  const changed = engine !== original
  const hasTrailblazerProject = repoQueries.some((q) =>
    (q.data ?? []).some((r) => r.owner === 'Trailblazer-Labs' && r.name === 'trailblazer')
  )

  return (
    <Modal onClose={onClose}>
      <Card className="w-[560px] p-6 space-y-5">
        <div className="text-sm text-muted">Settings</div>

        {!hasTrailblazerProject && (
          <ContributeSettingsBanner
            busy={addingTrailblazer}
            onAdd={addTrailblazerProject}
          />
        )}

        {/* GitHub auth section */}
        <section className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted">GitHub</div>
          {config?.authMode === 'gh' && config.ghLogin && (
            <div className="flex items-center justify-between rounded-md border border-border bg-bg p-3">
              <div className="text-sm">
                Signed in as <span className="text-accent">@{config.ghLogin}</span>
                <div className="text-xs text-muted">via GitHub CLI</div>
              </div>
              <Button variant="danger" onClick={signOut}>
                Sign out
              </Button>
            </div>
          )}
          {config?.authMode === 'pat' && (
            <div className="flex items-center justify-between rounded-md border border-border bg-bg p-3">
              <div className="text-sm">
                Using Personal Access Token
                <div className="text-xs text-muted">Stored encrypted in keychain</div>
              </div>
              <Button onClick={signOut}>Clear</Button>
            </div>
          )}
          {!config?.authMode && (
            <div className="text-xs text-muted">Not signed in.</div>
          )}
        </section>

        {/* Engine section */}
        <section className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted">Coding engine</div>
          <div className="text-xs text-muted">
            Trailblazer spawns this CLI in a worktree to resolve issues.
          </div>
          <EnginePicker detect={detect} selected={engine} onSelect={setEngine} />
        </section>

        {engine && <ModelsSection engine={engine} />}

        {updateStatus && (
          <UpdaterSection status={updateStatus} onStatus={setUpdateStatus} />
        )}

        {error && <div className="text-red-400 text-xs">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button variant="primary" disabled={busy || !engine || !changed} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Card>
    </Modal>
  )
}

function ContributeSettingsBanner({
  busy,
  onAdd
}: {
  busy: boolean
  onAdd: () => void
}) {
  return (
    <section className="rounded-md border border-accent/35 bg-[#17110f] p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg">
          <Github size={18} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm">Contribute to Trailblazer</div>
          <div className="text-xs text-muted">
            Add this repo as a project to work on issues, features, and PRs from inside Trailblazer.
          </div>
        </div>
        <Button variant="primary" onClick={onAdd} disabled={busy} className="shrink-0">
          <Plus size={14} />
          {busy ? 'Adding...' : 'Add project'}
        </Button>
      </div>
    </section>
  )
}

const CUSTOM_SENTINEL = '__custom__'

function UpdaterSection({
  status,
  onStatus
}: {
  status: UpdateStatus
  onStatus: (status: UpdateStatus) => void
}) {
  const [busy, setBusy] = useState(false)
  const isChecking = status.state === 'checking'
  const isDownloading = status.state === 'downloading'
  const isDisabled = status.state === 'disabled'

  async function run(action: () => Promise<UpdateStatus>) {
    setBusy(true)
    try {
      onStatus(await action())
    } finally {
      setBusy(false)
    }
  }

  const label =
    status.state === 'available' && status.availableVersion
      ? `Version ${status.availableVersion} is available.`
      : status.state === 'downloaded' && status.downloadedVersion
        ? `Version ${status.downloadedVersion} is ready to install.`
        : status.state === 'not-available'
          ? 'Trailblazer is up to date.'
          : status.state === 'checking'
            ? 'Checking for updates...'
            : status.state === 'downloading'
              ? `Downloading update${status.percent !== null ? ` ${status.percent}%` : ''}.`
              : status.state === 'disabled'
                ? status.message ?? 'Updater unavailable.'
                : 'Automatic update checks are enabled.'

  return (
    <section className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted">Updates</div>
      <div className="rounded-md border border-border bg-bg p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm">Trailblazer {status.currentVersion}</div>
            <div className="text-xs text-muted">{label}</div>
            {status.state === 'error' && status.message && (
              <div className="mt-1 text-[10px] text-red-400">{status.message}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {status.state === 'available' && (
              <Button
                onClick={() => run(() => window.api.updater.download())}
                disabled={busy}
              >
                Download
              </Button>
            )}
            {status.state === 'downloaded' && (
              <Button
                variant="primary"
                onClick={() => run(() => window.api.updater.quitAndInstall())}
                disabled={busy}
              >
                Restart
              </Button>
            )}
            <Button
              onClick={() => run(() => window.api.updater.check())}
              disabled={busy || isChecking || isDownloading || isDisabled}
            >
              {isChecking ? 'Checking...' : 'Check'}
            </Button>
          </div>
        </div>
        {isDownloading && status.percent !== null && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.max(0, Math.min(100, status.percent))}%` }}
            />
          </div>
        )}
      </div>
    </section>
  )
}

function ModelsSection({ engine }: { engine: Engine }) {
  const [discovered, setDiscovered] = useState<Array<{ id: string; label?: string }> | null>(null)
  const [probing, setProbing] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)

  useEffect(() => {
    window.api.config.cachedDiscoveredModels(engine).then(setDiscovered)
  }, [engine])

  async function refresh() {
    setProbing(true)
    setProbeError(null)
    try {
      const list = await window.api.config.discoverModels(engine)
      setDiscovered(list)
      if (list.length === 0) setProbeError('No models detected. Probe output may not have parsed; use Custom model id.')
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : 'probe failed')
    } finally {
      setProbing(false)
    }
  }

  const models = mergedModels(engine, discovered)
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted">Models</div>
        <button
          onClick={refresh}
          disabled={probing}
          className="text-[11px] text-muted hover:text-text disabled:opacity-50"
        >
          {probing ? 'Probing…' : 'Refresh from CLI'}
        </button>
      </div>
      <div className="text-xs text-muted">
        Pick which model powers each automated job. Feature chat lets you choose per-message.
        {discovered && discovered.length > 0 && (
          <> · {discovered.length} discovered via {engine} /model</>
        )}
      </div>
      {probeError && <div className="text-[10px] text-amber-400">{probeError}</div>}
      <ModelRow
        useCase="issueExpand"
        engine={engine}
        models={models}
        label="Issue creation"
        hint="Expanding a brief into a detailed issue."
      />
      <ModelRow
        useCase="issueResolve"
        engine={engine}
        models={models}
        label="PR generation"
        hint="Resolving an issue into code + PR."
      />
    </section>
  )
}

function ModelRow({
  useCase,
  engine,
  models,
  label,
  hint
}: {
  useCase: ModelUseCase
  engine: Engine
  models: { id: string; label: string; hint?: string }[]
  label: string
  hint?: string
}) {
  const [value, setValue] = useState<string | null>(null)
  const [customDraft, setCustomDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const isCustom = !!value && !models.some((m) => m.id === value)

  useEffect(() => {
    window.api.config.getModel(useCase, engine).then((v) => {
      setValue(v)
      if (v && !models.some((m) => m.id === v)) setCustomDraft(v)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCase, engine])

  async function persist(v: string) {
    setSaving(true)
    try {
      await window.api.config.setModel(useCase, engine, v)
    } finally {
      setSaving(false)
    }
  }

  async function onDropdownChange(v: string) {
    if (v === CUSTOM_SENTINEL) {
      // Entering custom mode — keep dropdown as "custom" but don't persist yet until they type a value.
      setValue('')
      return
    }
    setValue(v)
    setCustomDraft('')
    await persist(v)
  }

  async function commitCustom() {
    const v = customDraft.trim()
    if (!v) return
    setValue(v)
    await persist(v)
  }

  return (
    <div className="rounded-md border border-border bg-bg/40 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm">{label}</div>
          {hint && <div className="text-[10px] text-muted">{hint}</div>}
        </div>
        <select
          value={isCustom ? CUSTOM_SENTINEL : value ?? ''}
          disabled={saving || value === null}
          onChange={(e) => onDropdownChange(e.target.value)}
          className="no-drag rounded bg-panel border border-border px-2 py-1 text-xs outline-none"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.hint ? ` · ${m.hint}` : ''}
            </option>
          ))}
          <option value={CUSTOM_SENTINEL}>Custom model id…</option>
        </select>
      </div>
      {(isCustom || (value === '' && customDraft !== '')) && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            placeholder="e.g. gpt-5-mini, claude-sonnet-4-5-20250929"
            className="no-drag flex-1 rounded bg-panel border border-border px-2 py-1 text-xs font-mono outline-none focus:border-accent"
          />
          <button
            onClick={commitCustom}
            disabled={!customDraft.trim() || saving}
            className="text-[11px] text-accent hover:text-text disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}
    </div>
  )
}
