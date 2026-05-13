import { RefreshCw } from 'lucide-react'
import { Button, Card } from './ui'
import { FireLogo } from './FireLogo'
import type { ReleaseGateStatus } from '@shared/types'

export default function BlockedRelease({
  status,
  checking,
  onRefresh
}: {
  status: ReleaseGateStatus
  checking: boolean
  onRefresh: () => void
}) {
  return (
    <div className="h-full flex items-center justify-center bg-bg px-6">
      <Card className="w-[520px] p-7 text-center space-y-5">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl border border-border bg-[#1f1614]">
          <FireLogo size={38} />
        </div>
        <div>
          <div className="text-lg">This version is no longer runnable</div>
          <p className="mt-2 text-sm leading-6 text-muted">
            {status.message ??
              'Install the latest Trailblazer release to continue using the app.'}
          </p>
        </div>
        <div className="rounded-md border border-border bg-panel px-3 py-2 text-left text-xs text-muted">
          <div>Current version: {status.currentVersion}</div>
          {status.reason && <div>Reason: {status.reason}</div>}
          {status.checkedAt && <div>Checked: {new Date(status.checkedAt).toLocaleString()}</div>}
        </div>
        <div className="flex justify-center gap-2">
          {status.updateUrl && (
            <Button
              variant="primary"
              onClick={() => void window.api.shell.openExternal(status.updateUrl!)}
            >
              Download latest
            </Button>
          )}
          <Button onClick={onRefresh} disabled={checking}>
            <RefreshCw size={14} className={checking ? 'tb-spin' : ''} />
            {checking ? 'Checking...' : 'Check again'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
