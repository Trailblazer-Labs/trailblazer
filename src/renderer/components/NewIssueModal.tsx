import { useEffect, useState } from 'react'
import { Button, Card, Input, Textarea } from './ui'
import ActivityList, { applyActivity } from './ActivityList'
import type { Repo, Engine, AgentActivity } from '@shared/types'

type Step = 'brief' | 'preview'

export default function NewIssueModal({
  projectId,
  repos,
  onClose,
  onCreated
}: {
  projectId: number
  repos: Repo[]
  onClose: () => void
  onCreated: (created: {
    repoId: number
    number: number
    title: string
    body: string | null
    state: 'open' | 'closed'
    url: string
    updatedAt: string
  }) => void
}) {
  const [repoId, setRepoId] = useState<number | null>(repos[0]?.id ?? null)
  const [brief, setBrief] = useState('')
  const [step, setStep] = useState<Step>('brief')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [expanding, setExpanding] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<Engine | null>(null)
  const [activities, setActivities] = useState<AgentActivity[]>([])
  const [rawLogs, setRawLogs] = useState('')
  const [showRaw, setShowRaw] = useState(false)

  const repo = repos.find((r) => r.id === repoId) ?? null

  useEffect(() => {
    let cancelled = false
    Promise.all([window.api.projects.get(projectId), window.api.config.get()]).then(
      ([project, cfg]) => {
        if (!cancelled) setEngine(project?.assistantEngine ?? cfg.engine)
      }
    )
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    const unsub = window.api.github.onExpandEvent((evt) => {
      if (evt.type === 'start') {
        setActivities([])
        setRawLogs('')
      } else if (evt.type === 'activity') {
        setActivities((prev) => applyActivity(prev, evt.activity))
      } else if (evt.type === 'chunk') {
        setRawLogs((prev) => {
          const next = prev + evt.chunk
          return next.length > 40000 ? next.slice(-40000) : next
        })
      }
    })
    return () => unsub()
  }, [])

  const engineLabel = engine === 'codex' ? 'Codex' : engine === 'claude' ? 'Claude' : 'agent'

  async function expand() {
    if (!brief.trim() || !repo) return
    setExpanding(true)
    setError(null)
    try {
      const out = await window.api.github.expandIssue({
        brief: brief.trim(),
        repoId: repo.id
      })
      setTitle(out.title)
      setBody(out.body)
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'expansion failed')
    } finally {
      setExpanding(false)
    }
  }

  async function create() {
    if (!repo || !title.trim()) return
    setCreating(true)
    setError(null)
    try {
      const created = await window.api.github.createIssue(
        repo.owner,
        repo.name,
        title.trim(),
        body
      )
      onCreated({ repoId: repo.id, ...created })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to create issue')
    } finally {
      setCreating(false)
    }
  }

  function skipExpansion() {
    // user wants to fill it in manually
    setTitle(brief.split('\n')[0].slice(0, 80))
    setBody(brief)
    setStep('preview')
  }

  return (
    <Modal onClose={onClose}>
      <Card className="w-[640px] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted">
            {step === 'brief' ? 'New issue · describe briefly' : 'New issue · review & edit'}
          </div>
          {step === 'preview' && (
            <button
              className="text-xs text-muted hover:text-text"
              onClick={() => setStep('brief')}
              disabled={creating}
            >
              ← Back
            </button>
          )}
        </div>

        <select
          className="no-drag w-full rounded-md bg-panel border border-border px-3 py-2 text-sm outline-none"
          value={repoId ?? ''}
          onChange={(e) => setRepoId(Number(e.target.value))}
          disabled={step === 'preview'}
        >
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.owner}/{r.name}
            </option>
          ))}
        </select>

        {step === 'brief' && (
          <>
            <Textarea
              rows={6}
              placeholder={`One or two sentences describing the issue. ${engineLabel} will expand into a full report.`}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              disabled={expanding}
              autoFocus
            />
            {expanding && (
              <ExpandActivity
                activities={activities}
                rawLogs={rawLogs}
                engineLabel={engineLabel}
                showRaw={showRaw}
                onToggleRaw={() => setShowRaw((v) => !v)}
              />
            )}
            {error && <div className="text-red-400 text-xs">{error}</div>}
            <div className="flex items-center justify-between pt-2">
              <button
                className="text-xs text-muted hover:text-text underline"
                onClick={skipExpansion}
                disabled={!brief.trim() || expanding}
              >
                Skip expansion
              </button>
              <div className="flex gap-2">
                <Button onClick={onClose} disabled={expanding}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={!brief.trim() || !repo || expanding}
                  onClick={expand}
                >
                  {expanding ? `${engineLabel} is working…` : `Expand with ${engineLabel}`}
                </Button>
              </div>
            </div>
          </>
        )}

        {step === 'preview' && (
          <>
            <Input
              placeholder="Issue title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              rows={14}
              placeholder="Issue body (markdown)"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            {expanding && (
              <ExpandActivity
                activities={activities}
                rawLogs={rawLogs}
                engineLabel={engineLabel}
                showRaw={showRaw}
                onToggleRaw={() => setShowRaw((v) => !v)}
              />
            )}
            {error && <div className="text-red-400 text-xs">{error}</div>}
            <div className="flex items-center justify-between pt-2">
              <Button onClick={expand} disabled={expanding || creating}>
                {expanding ? `${engineLabel} is working…` : 'Regenerate'}
              </Button>
              <div className="flex gap-2">
                <Button onClick={onClose} disabled={creating}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={creating || !title.trim()} onClick={create}>
                  {creating ? 'Creating…' : 'Create issue'}
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </Modal>
  )
}

function ExpandActivity({
  activities,
  rawLogs,
  engineLabel,
  showRaw,
  onToggleRaw
}: {
  activities: AgentActivity[]
  rawLogs: string
  engineLabel: string
  showRaw: boolean
  onToggleRaw: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted">
          {engineLabel} activity
        </div>
        <button className="text-[11px] text-muted hover:text-text" onClick={onToggleRaw}>
          {showRaw ? 'Hide raw' : 'Show raw'}
        </button>
      </div>
      <ActivityList
        items={activities}
        engineLabel={engineLabel}
        busy
        emptyLabel={`${engineLabel} is starting…`}
      />
      {showRaw && (
        <pre className="max-h-44 overflow-auto p-2 rounded-md border border-border bg-bg text-[11px] leading-4 font-mono whitespace-pre-wrap text-text/70">
          {rawLogs || '…'}
        </pre>
      )}
    </div>
  )
}

export function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  )
}
