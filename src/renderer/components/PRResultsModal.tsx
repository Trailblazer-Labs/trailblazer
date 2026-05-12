import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Pill } from './ui'
import { Modal } from './NewIssueModal'
import type { GhAuthEvent, PRCreateResult } from '@shared/types'

const WORKFLOW_SCOPE_RE = /refusing to allow.*workflow|workflow.*scope/i

export default function PRResultsModal({
  results,
  onClose
}: {
  results: PRCreateResult[]
  onClose: () => void
}) {
  const opened = results.filter((r) => r.status === 'opened' || r.status === 'existing')
  const needsWorkflowScope = useMemo(
    () =>
      results.some(
        (r) => r.status === 'skipped' && r.reason && WORKFLOW_SCOPE_RE.test(r.reason)
      ),
    [results]
  )

  function openAll() {
    for (const r of opened) {
      if (r.prUrl) void window.api.shell.openExternal(r.prUrl)
    }
  }

  return (
    <Modal onClose={onClose}>
      <Card className="w-[680px] p-6 space-y-4">
        <div>
          <div className="text-sm text-muted">Pull requests</div>
          <h2 className="font-brand text-xl">Results</h2>
        </div>

        {needsWorkflowScope && <WorkflowScopeBanner />}

        <ul className="divide-y divide-border/60 rounded-md border border-border bg-bg">
          {results.map((r) => (
            <li key={r.repoId} className="px-3 py-2.5 flex flex-col gap-1.5">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{r.repoName}</div>
                  <div className="text-[10px] text-muted truncate font-mono">{r.branch}</div>
                </div>
                {(r.status === 'opened' || r.status === 'existing') && r.prUrl && (
                  <a
                    href={r.prUrl}
                    onClick={(e) => {
                      e.preventDefault()
                      void window.api.shell.openExternal(r.prUrl!)
                    }}
                    className="text-xs text-accent underline"
                  >
                    #{r.prNumber} ↗
                  </a>
                )}
                <Pill tone={statusTone(r.status)}>{r.status}</Pill>
              </div>
              {r.status === 'skipped' && r.reason && (
                <div className="text-[11px] text-muted/90 whitespace-pre-wrap break-words">
                  {r.reason}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="flex justify-between items-center pt-1">
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={openAll} disabled={opened.length === 0}>
            Open all in browser ({opened.length})
          </Button>
        </div>
      </Card>
    </Modal>
  )
}

function WorkflowScopeBanner() {
  type Phase = 'idle' | 'starting' | 'code' | 'verifying' | 'done' | 'error'
  const [phase, setPhase] = useState<Phase>('idle')
  const [code, setCode] = useState<string | null>(null)
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  useEffect(() => {
    const unsub = window.api.gh.onEvent((evt: GhAuthEvent) => {
      if (evt.type === 'code') {
        setCode(evt.code)
        setVerifyUrl(evt.url)
        setPhase('code')
      } else if (evt.type === 'progress') {
        setPhase('verifying')
      } else if (evt.type === 'done') {
        setPhase('done')
      } else if (evt.type === 'error') {
        setErrMsg(evt.message)
        setPhase('error')
      }
    })
    return () => unsub()
  }, [])

  async function start() {
    setPhase('starting')
    setErrMsg(null)
    setCode(null)
    await window.api.gh.refreshScopes(['workflow'])
  }

  return (
    <div className="rounded-md border border-amber-700/40 bg-amber-900/10 p-3 text-xs space-y-2">
      <div className="flex items-start gap-2">
        <span className="text-amber-400">⚠</span>
        <div className="flex-1">
          <div className="text-amber-300">GitHub rejected the push: missing <code>workflow</code> scope.</div>
          <div className="text-muted mt-0.5">
            Your token can't update <code>.github/workflows/*</code> files. Grant the extra scope to fix this.
          </div>
        </div>
      </div>
      {phase === 'idle' && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={start}>
            Grant workflow scope
          </Button>
        </div>
      )}
      {phase === 'starting' && <div className="text-muted">Starting gh auth refresh…</div>}
      {phase === 'code' && code && (
        <div className="rounded-md border border-border bg-bg p-2.5 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted">Your one-time code</div>
          <div className="flex items-center gap-3">
            <div className="font-mono text-xl tracking-widest text-accent">{code}</div>
            <button
              className="text-[11px] text-muted hover:text-text"
              onClick={() => navigator.clipboard.writeText(code)}
            >
              Copy
            </button>
          </div>
          <div className="text-[11px] text-muted">
            Browser should have opened. If not, visit{' '}
            <a
              href={verifyUrl ?? 'https://github.com/login/device'}
              onClick={(e) => {
                e.preventDefault()
                void window.api.shell.openExternal(verifyUrl ?? 'https://github.com/login/device')
              }}
              className="text-accent underline"
            >
              {verifyUrl ?? 'github.com/login/device'}
            </a>{' '}
            and paste the code.
          </div>
        </div>
      )}
      {phase === 'verifying' && <div className="text-muted">Verifying…</div>}
      {phase === 'done' && (
        <div className="text-green-400">
          Scope granted. Close this dialog and click <strong>Create PRs</strong> again.
        </div>
      )}
      {phase === 'error' && (
        <div className="space-y-1">
          <div className="text-red-400">{errMsg}</div>
          <Button onClick={start}>Try again</Button>
        </div>
      )}
    </div>
  )
}

function statusTone(s: PRCreateResult['status']): 'open' | 'merged' | 'closed' | 'default' {
  if (s === 'opened') return 'open'
  if (s === 'existing') return 'merged'
  return 'closed'
}
