import { useEffect, useState } from 'react'
import { Button, Card, Pill } from './ui'
import { Modal } from './NewIssueModal'
import ActivityList from './ActivityList'
import DiffView from './DiffView'
import { useApp } from '../stores/app'
import type { Engine } from '@shared/types'

export default function RunDrawer({
  onClose,
  repoOwner,
  repoName,
  issueNumber,
  onPushed
}: {
  onClose: () => void
  repoOwner: string
  repoName: string
  issueNumber: number
  onPushed: () => void
}) {
  const run = useApp((s) => s.run)
  const [engine, setEngine] = useState<Engine | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  useEffect(() => {
    window.api.config.get().then((cfg) => setEngine(cfg.engine))
  }, [])

  async function approve() {
    if (!run.runId) return
    await window.api.runs.approvePush(run.runId)
    onPushed()
  }

  async function cancel() {
    if (run.runId) await window.api.runs.cancel(run.runId)
  }

  const statusTone =
    run.status === 'pushed'
      ? 'merged'
      : run.status === 'failed' || run.status === 'cancelled'
        ? 'closed'
        : run.status === 'awaiting-approval'
          ? 'open'
          : 'running'

  const engineLabel = engine === 'codex' ? 'Codex' : engine === 'claude' ? 'Claude' : 'Agent'
  const busy = run.status === 'running' || run.status === 'pending'

  return (
    <Modal onClose={onClose}>
      <Card className="w-[960px] h-[680px] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="text-sm">
              Resolving {repoOwner}/{repoName} #{issueNumber}
            </div>
            <Pill tone={statusTone}>{run.status}</Pill>
            <span className="text-[10px] uppercase tracking-wider text-muted">{engineLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="text-[11px] text-muted hover:text-text"
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? 'Hide raw' : 'Show raw'}
            </button>
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-5 overflow-hidden">
          <div className="col-span-3 border-r border-border flex flex-col">
            <div className="text-xs px-4 py-2 text-muted border-b border-border">
              {engineLabel} activity
            </div>
            <div className="flex-1 overflow-hidden p-3">
              <ActivityList
                items={run.activities}
                engineLabel={engineLabel}
                busy={busy}
                emptyLabel={`${engineLabel} is starting…`}
              />
              {showRaw && (
                <details className="mt-3" open>
                  <summary className="text-[11px] text-muted cursor-pointer">Raw output</summary>
                  <pre className="mt-2 max-h-48 overflow-auto p-2 rounded-md border border-border bg-bg text-[11px] leading-4 font-mono whitespace-pre-wrap text-text/70">
                    {run.logs || '…'}
                  </pre>
                </details>
              )}
            </div>
          </div>
          <div className="col-span-2 flex flex-col">
            <div className="text-xs px-4 py-2 text-muted border-b border-border">Diff</div>
            <div className="flex-1 overflow-auto p-3 text-xs font-mono">
              {!run.diff && <div className="text-muted">Waiting for {engineLabel} to finish…</div>}
              {run.diff?.length === 0 && <div className="text-muted">No file changes.</div>}
              {run.diff?.map((f) => (
                <div key={f.path} className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="truncate text-text/90">{f.path}</div>
                    <div className="text-[10px] text-muted">
                      <span className="text-green-400">+{f.additions}</span>{' '}
                      <span className="text-red-400">-{f.deletions}</span>
                    </div>
                  </div>
                  <DiffView path={f.path} patch={f.patch} maxHeight={260} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-border px-4 py-3 flex items-center justify-between">
          <div className="text-xs text-muted">
            {run.error && <span className="text-red-400">{run.error}</span>}
            {run.prUrl && (
              <a className="text-accent underline" href={run.prUrl} target="_blank" rel="noreferrer">
                PR #{run.prNumber} opened
              </a>
            )}
          </div>
          <div className="flex gap-2">
            {run.status === 'running' && (
              <Button variant="danger" onClick={cancel}>
                Cancel
              </Button>
            )}
            {run.status === 'awaiting-approval' && (
              <Button variant="primary" onClick={approve}>
                Push & Open PR
              </Button>
            )}
          </div>
        </div>
      </Card>
    </Modal>
  )
}
