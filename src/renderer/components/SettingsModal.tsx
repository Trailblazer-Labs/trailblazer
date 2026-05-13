import { useEffect, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Github, Plus } from 'lucide-react'
import { Button, Card } from './ui'
import { Modal } from './NewIssueModal'
import { useApp } from '../stores/app'
import type { AppConfig, UpdateStatus } from '@shared/types'

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
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [addingTrailblazer, setAddingTrailblazer] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    const [cfg, updater] = await Promise.all([
      window.api.config.get(),
      window.api.updater.getStatus()
    ])
    setConfig(cfg)
    setUpdateStatus(updater)
  }

  useEffect(() => {
    reload()
    const unsubscribe = window.api.updater.onEvent(setUpdateStatus)
    return unsubscribe
  }, [])

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

        {updateStatus && (
          <UpdaterSection status={updateStatus} onStatus={setUpdateStatus} />
        )}

        {error && <div className="text-red-400 text-xs">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>
            Close
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
