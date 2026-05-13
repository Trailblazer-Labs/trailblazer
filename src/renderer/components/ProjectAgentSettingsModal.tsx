import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import EnginePicker from './EnginePicker'
import { Button, Card } from './ui'
import { Modal } from './NewIssueModal'
import { defaultModelFor, mergedModels } from '@shared/models'
import type { ModelUseCase } from '@shared/models'
import type { Engine, EngineDetection, Project } from '@shared/types'

const CUSTOM_SENTINEL = '__custom__'

export default function ProjectAgentSettingsModal({
  project,
  onClose
}: {
  project: Project
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [detect, setDetect] = useState<EngineDetection | null>(null)
  const [engine, setEngine] = useState<Engine | null>(project.assistantEngine)
  const [featureModel, setFeatureModel] = useState(project.featureModel)
  const [issueExpandModel, setIssueExpandModel] = useState(project.issueExpandModel)
  const [issueResolveModel, setIssueResolveModel] = useState(project.issueResolveModel)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.config.detectEngines().then(setDetect)
    if (!project.assistantEngine) {
      window.api.config.get().then((cfg) => {
        if (cfg.engine) setEngine(cfg.engine)
      })
    }
  }, [])

  function selectEngine(next: Engine) {
    setEngine(next)
    setFeatureModel(defaultModelFor(next))
    setIssueExpandModel(defaultModelFor(next))
    setIssueResolveModel(defaultModelFor(next))
    setError(null)
  }

  async function save() {
    if (!engine) return
    if (detect && !detect[engine].found) {
      setError(`${engine} CLI not found on PATH`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await window.api.projects.updateSettings(project.id, {
        assistantEngine: engine,
        featureModel,
        issueExpandModel,
        issueResolveModel
      })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['projects'] }),
        qc.invalidateQueries({ queryKey: ['project', project.id] })
      ])
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to save project settings')
    } finally {
      setBusy(false)
    }
  }

  const changed =
    engine !== project.assistantEngine ||
    featureModel !== project.featureModel ||
    issueExpandModel !== project.issueExpandModel ||
    issueResolveModel !== project.issueResolveModel

  return (
    <Modal onClose={onClose}>
      <Card className="w-[640px] max-h-[84vh] overflow-auto p-6 space-y-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted">Project settings</div>
          <div className="mt-1 text-lg">{project.name}</div>
        </div>

        <section className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted">Assistant</div>
          <div className="text-xs text-muted">
            All feature, issue, and PR agent runs in this project use this CLI.
          </div>
          <EnginePicker detect={detect} selected={engine} onSelect={selectEngine} />
        </section>

        {engine && (
          <ProjectModelsSection
            engine={engine}
            featureModel={featureModel}
            issueExpandModel={issueExpandModel}
            issueResolveModel={issueResolveModel}
            onFeatureModel={setFeatureModel}
            onIssueExpandModel={setIssueExpandModel}
            onIssueResolveModel={setIssueResolveModel}
          />
        )}

        {error && <div className="text-red-400 text-xs">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !engine || !changed} onClick={save}>
            {busy ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </Card>
    </Modal>
  )
}

function ProjectModelsSection({
  engine,
  featureModel,
  issueExpandModel,
  issueResolveModel,
  onFeatureModel,
  onIssueExpandModel,
  onIssueResolveModel
}: {
  engine: Engine
  featureModel: string | null
  issueExpandModel: string | null
  issueResolveModel: string | null
  onFeatureModel: (value: string) => void
  onIssueExpandModel: (value: string) => void
  onIssueResolveModel: (value: string) => void
}) {
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
      if (list.length === 0) setProbeError('No models detected. Use a custom model id if needed.')
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : 'probe failed')
    } finally {
      setProbing(false)
    }
  }

  const models = useMemo(() => mergedModels(engine, discovered), [engine, discovered])

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted">Models</div>
        <button
          type="button"
          onClick={refresh}
          disabled={probing}
          className="text-[11px] text-muted hover:text-text disabled:opacity-50"
        >
          {probing ? 'Probing...' : 'Refresh from CLI'}
        </button>
      </div>
      <div className="text-xs text-muted">
        These choices are scoped to this project and filtered by the selected assistant.
        {discovered && discovered.length > 0 && (
          <> · {discovered.length} discovered via {engine} /model</>
        )}
      </div>
      {probeError && <div className="text-[10px] text-amber-400">{probeError}</div>}
      <ModelRow
        useCase="feature"
        value={featureModel ?? defaultModelFor(engine)}
        engine={engine}
        models={models}
        label="Feature chat and planning"
        hint="Used for project plans and feature implementation."
        onChange={onFeatureModel}
      />
      <ModelRow
        useCase="issueExpand"
        value={issueExpandModel ?? defaultModelFor(engine)}
        engine={engine}
        models={models}
        label="Issue creation"
        hint="Expands a short brief into a detailed issue."
        onChange={onIssueExpandModel}
      />
      <ModelRow
        useCase="issueResolve"
        value={issueResolveModel ?? defaultModelFor(engine)}
        engine={engine}
        models={models}
        label="Issue resolve and PR text"
        hint="Resolves issues and writes generated PR descriptions."
        onChange={onIssueResolveModel}
      />
    </section>
  )
}

function ModelRow({
  value,
  models,
  label,
  hint,
  onChange
}: {
  useCase: ModelUseCase
  value: string
  engine: Engine
  models: { id: string; label: string; hint?: string }[]
  label: string
  hint?: string
  onChange: (value: string) => void
}) {
  const [customDraft, setCustomDraft] = useState('')
  const isCustom = !!value && !models.some((m) => m.id === value)
  const inCustomMode = isCustom || value === ''

  useEffect(() => {
    setCustomDraft(isCustom ? value : '')
  }, [isCustom, value])

  return (
    <div className="rounded-md border border-border bg-bg/40 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm">{label}</div>
          {hint && <div className="text-[10px] text-muted">{hint}</div>}
        </div>
        <select
          value={isCustom ? CUSTOM_SENTINEL : value}
          onChange={(e) => {
            if (e.target.value === CUSTOM_SENTINEL) {
              onChange('')
              return
            }
            onChange(e.target.value)
          }}
          className="no-drag max-w-[240px] rounded bg-panel border border-border px-2 py-1 text-xs outline-none"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.hint ? ` · ${m.hint}` : ''}
            </option>
          ))}
          <option value={CUSTOM_SENTINEL}>Custom model id...</option>
        </select>
      </div>
      {inCustomMode && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onBlur={() => {
              if (customDraft.trim()) onChange(customDraft.trim())
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customDraft.trim()) onChange(customDraft.trim())
            }}
            placeholder="custom model id"
            className="no-drag flex-1 rounded bg-panel border border-border px-2 py-1 text-xs font-mono outline-none focus:border-accent"
          />
        </div>
      )}
    </div>
  )
}
