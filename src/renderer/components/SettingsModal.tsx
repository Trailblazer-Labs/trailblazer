import { useEffect, useState } from 'react'
import { Button, Card } from './ui'
import { Modal } from './NewIssueModal'
import EnginePicker from './EnginePicker'
import { mergedModels } from '@shared/models'
import type { ModelUseCase } from '@shared/models'
import type { AppConfig, Engine, EngineDetection, Project, Repo } from '@shared/types'

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [detect, setDetect] = useState<EngineDetection | null>(null)
  const [engine, setEngine] = useState<Engine | null>(null)
  const [original, setOriginal] = useState<Engine | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    const [d, cfg] = await Promise.all([
      window.api.config.detectEngines(),
      window.api.config.get()
    ])
    setDetect(d)
    setConfig(cfg)
    setEngine(cfg.engine)
    setOriginal(cfg.engine)
  }

  useEffect(() => {
    reload()
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

  const changed = engine !== original

  return (
    <Modal onClose={onClose}>
      <Card className="w-[560px] p-6 space-y-5">
        <div className="text-sm text-muted">Settings</div>

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

const CUSTOM_SENTINEL = '__custom__'

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
