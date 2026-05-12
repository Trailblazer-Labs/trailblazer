import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Pill } from './ui'
import { Modal } from './NewIssueModal'
import DiffView from './DiffView'

export default function PRReviewModal({
  repoOwner,
  repoName,
  number,
  onClose,
  onMerged
}: {
  repoOwner: string
  repoName: string
  number: number
  onClose: () => void
  onMerged: () => void
}) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['pr-detail', repoOwner, repoName, number],
    queryFn: () => window.api.github.getPullDetail(repoOwner, repoName, number)
  })
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [busy, setBusy] = useState<'merge' | 'close' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmMerge, setConfirmMerge] = useState(false)

  const currentFile = data?.files.find((f) => f.path === selectedPath) ?? data?.files[0]

  async function merge() {
    setBusy('merge')
    setError(null)
    try {
      const res = await window.api.github.mergePull(repoOwner, repoName, number, 'squash')
      if (!res.merged) throw new Error('GitHub refused the merge')
      await qc.invalidateQueries({ queryKey: ['pulls'] })
      onMerged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'merge failed')
    } finally {
      setBusy(null)
      setConfirmMerge(false)
    }
  }

  async function close() {
    setBusy('close')
    setError(null)
    try {
      await window.api.github.closePull(repoOwner, repoName, number)
      await qc.invalidateQueries({ queryKey: ['pulls'] })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to close')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal onClose={onClose}>
      <Card className="w-[1100px] h-[720px] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-sm truncate">
              {repoOwner}/{repoName} #{number} — {data?.title ?? '…'}
            </div>
            {data && (
              <Pill tone={data.state === 'merged' ? 'merged' : data.state === 'closed' ? 'closed' : 'open'}>
                {data.state}
              </Pill>
            )}
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>

        {isLoading || !data ? (
          <div className="flex-1 flex items-center justify-center text-muted text-sm">Loading…</div>
        ) : (
          <div className="flex-1 grid grid-cols-4 overflow-hidden">
            <div className="col-span-1 border-r border-border overflow-auto">
              <div className="text-xs px-4 py-2 text-muted border-b border-border">
                Files ({data.files.length})
              </div>
              {data.files.map((f) => {
                const active = (currentFile?.path === f.path)
                return (
                  <button
                    key={f.path}
                    onClick={() => setSelectedPath(f.path)}
                    className={
                      'w-full text-left px-3 py-2 text-xs border-b border-border/60 hover:bg-panel ' +
                      (active ? 'bg-[#1a1414]' : '')
                    }
                  >
                    <div className="truncate font-mono">{f.path}</div>
                    <div className="text-[10px] text-muted">
                      <span className="text-green-400">+{f.additions}</span>{' '}
                      <span className="text-red-400">-{f.deletions}</span>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="col-span-3 overflow-auto p-3">
              {currentFile ? (
                <DiffView path={currentFile.path} patch={currentFile.patch} />
              ) : (
                <div className="p-6 text-muted text-sm">Select a file.</div>
              )}
            </div>
          </div>
        )}

        <div className="border-t border-border px-4 py-3 flex items-center justify-between">
          <div className="text-xs text-muted">
            {error && <span className="text-red-400">{error}</span>}
            {data?.mergeable === false && <span className="text-amber-400">Conflicts detected.</span>}
          </div>
          <div className="flex gap-2">
            <Button onClick={close} disabled={!!busy || data?.state !== 'open'}>
              {busy === 'close' ? 'Closing…' : 'Close PR'}
            </Button>
            {!confirmMerge ? (
              <Button
                variant="primary"
                disabled={!data || data.state !== 'open' || data.mergeable === false || !!busy}
                onClick={() => setConfirmMerge(true)}
              >
                Merge (squash)
              </Button>
            ) : (
              <>
                <Button onClick={() => setConfirmMerge(false)} disabled={!!busy}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={merge} disabled={!!busy}>
                  {busy === 'merge' ? 'Merging…' : 'Confirm merge'}
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>
    </Modal>
  )
}
