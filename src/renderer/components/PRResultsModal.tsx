import { Button, Card, Pill } from './ui'
import { Modal } from './NewIssueModal'
import type { PRCreateResult } from '@shared/types'

export default function PRResultsModal({
  results,
  onClose
}: {
  results: PRCreateResult[]
  onClose: () => void
}) {
  const opened = results.filter((r) => r.status === 'opened' || r.status === 'existing')

  function openAll() {
    for (const r of opened) {
      if (r.prUrl) void window.api.shell.openExternal(r.prUrl)
    }
  }

  return (
    <Modal onClose={onClose}>
      <Card className="w-[640px] p-6 space-y-4">
        <div>
          <div className="text-sm text-muted">Pull requests</div>
          <h2 className="font-brand text-xl">Results</h2>
        </div>

        <ul className="divide-y divide-border/60 rounded-md border border-border bg-bg">
          {results.map((r) => (
            <li key={r.repoId} className="px-3 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{r.repoName}</div>
                <div className="text-[10px] text-muted truncate">{r.branch}</div>
              </div>
              {r.status === 'opened' && r.prUrl && (
                <a
                  href={r.prUrl}
                  onClick={(e) => {
                    e.preventDefault()
                    void window.api.shell.openExternal(r.prUrl!)
                  }}
                  className="text-xs text-accent underline truncate max-w-[200px]"
                >
                  #{r.prNumber} ↗
                </a>
              )}
              {r.status === 'existing' && r.prUrl && (
                <a
                  href={r.prUrl}
                  onClick={(e) => {
                    e.preventDefault()
                    void window.api.shell.openExternal(r.prUrl!)
                  }}
                  className="text-xs text-accent underline truncate max-w-[200px]"
                >
                  #{r.prNumber} ↗
                </a>
              )}
              {r.status === 'skipped' && (
                <span className="text-[10px] text-muted truncate max-w-[200px]">
                  {r.reason ?? 'skipped'}
                </span>
              )}
              <Pill tone={statusTone(r.status)}>{r.status}</Pill>
            </li>
          ))}
        </ul>

        <div className="flex justify-between items-center pt-1">
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="primary"
            onClick={openAll}
            disabled={opened.length === 0}
          >
            Open all in browser ({opened.length})
          </Button>
        </div>
      </Card>
    </Modal>
  )
}

function statusTone(s: PRCreateResult['status']): 'open' | 'merged' | 'closed' | 'default' {
  if (s === 'opened') return 'open'
  if (s === 'existing') return 'merged'
  return 'closed'
}
