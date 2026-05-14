import { useEffect, useState } from 'react'
import { useApp } from './stores/app'
import Onboarding from './pages/Onboarding'
import Projects from './pages/Projects'
import ProjectView from './pages/ProjectView'
import FeatureChatView from './pages/FeatureChatView'
import Splash from './components/Splash'
import { FireLogo } from './components/FireLogo'
import BlockedRelease from './components/BlockedRelease'
import { Button, Card } from './components/ui'
import { Modal } from './components/NewIssueModal'
import type { ReleaseGateStatus, UpdateStatus } from '@shared/types'

const IS_MAC = navigator.platform.toLowerCase().includes('mac')

export default function App() {
  const { view, setView, applyRunEvent, hydrateActiveRun } = useApp()
  const [splashDone, setSplashDone] = useState(false)
  const [releaseGate, setReleaseGate] = useState<ReleaseGateStatus | null>(null)
  const [checkingGate, setCheckingGate] = useState(true)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [showUpdateModal, setShowUpdateModal] = useState(false)

  useEffect(() => {
    window.api.releaseGate.refresh().then((gate) => {
      setReleaseGate(gate)
      setCheckingGate(false)
      if (gate.blocked) return
      return window.api.config.get().then((cfg) => {
        if (!cfg.githubPatConfigured || !cfg.engineConfigured) {
          setView({ kind: 'onboarding' })
        } else {
          setView({ kind: 'projects' })
        }
      })
    }).catch(() => {
      setCheckingGate(false)
    })
    const unsub = window.api.runs.onEvent(applyRunEvent)
    const poll = window.setInterval(() => {
      window.api.runs.getActive().then(hydrateActiveRun).catch(() => {})
    }, 1500)
    window.api.runs.getActive().then(hydrateActiveRun).catch(() => {})
    window.api.updater.getStatus().then((status) => {
      setUpdateStatus(status)
      if (status.state === 'available' || status.state === 'downloaded') setShowUpdateModal(true)
    }).catch(() => {})
    const unsubscribeUpdater = window.api.updater.onEvent((status) => {
      setUpdateStatus(status)
      if (status.state === 'available' || status.state === 'downloaded') setShowUpdateModal(true)
    })
    return () => {
      unsub()
      unsubscribeUpdater()
      window.clearInterval(poll)
    }
  }, [setView, applyRunEvent, hydrateActiveRun])

  async function refreshReleaseGate() {
    setCheckingGate(true)
    const gate = await window.api.releaseGate.refresh()
    setReleaseGate(gate)
    setCheckingGate(false)
    if (!gate.blocked) {
      const cfg = await window.api.config.get()
      if (!cfg.githubPatConfigured || !cfg.engineConfigured) {
        setView({ kind: 'onboarding' })
      } else {
        setView({ kind: 'projects' })
      }
    }
  }

  return (
    <div className="h-full flex flex-col">
      {!splashDone && <Splash onDone={() => setSplashDone(true)} />}
      {/* Thin draggable strip at top so the window stays movable; reserves space for macOS traffic lights. */}
      {IS_MAC && <div className="titlebar-drag h-7 shrink-0" />}
      <div className="flex-1 overflow-hidden">
        {releaseGate?.blocked ? (
          <BlockedRelease
            status={releaseGate}
            checking={checkingGate}
            onRefresh={() => void refreshReleaseGate()}
          />
        ) : (
          <>
            {view.kind === 'loading' && (
              <div className="h-full flex items-center justify-center text-muted">
                <FireLogo size={28} flicker />
              </div>
            )}
            {view.kind === 'onboarding' && <Onboarding />}
            {view.kind === 'projects' && <Projects />}
            {view.kind === 'project' && <ProjectView projectId={view.projectId} initialTab={view.tab} />}
            {view.kind === 'feature' && (
              <FeatureChatView
                projectId={view.projectId}
                featureId={view.featureId}
                sessionId={view.sessionId}
                initialDraft={view.initialDraft}
              />
            )}
          </>
        )}
      </div>
      {showUpdateModal && updateStatus && (
        <StartupUpdateModal
          status={updateStatus}
          onStatus={setUpdateStatus}
          onClose={() => setShowUpdateModal(false)}
        />
      )}
    </div>
  )
}

function StartupUpdateModal({
  status,
  onStatus,
  onClose
}: {
  status: UpdateStatus
  onStatus: (status: UpdateStatus) => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const version = status.availableVersion ?? status.downloadedVersion

  async function run(action: () => Promise<UpdateStatus>) {
    setBusy(true)
    try {
      onStatus(await action())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <Card className="w-[440px] p-5">
        <div className="text-xs uppercase tracking-wider text-muted mb-1">Update available</div>
        <h2 className="text-lg mb-2">
          Trailblazer {version ?? ''} is ready
        </h2>
        <p className="text-sm leading-6 text-muted">
          You are running {status.currentVersion}. Download the latest version now, or keep working
          and update later from Settings.
        </p>
        {status.state === 'downloading' && status.percent !== null && (
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-bg">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.max(0, Math.min(100, status.percent))}%` }}
            />
          </div>
        )}
        {status.state === 'error' && status.message && (
          <div className="mt-3 text-xs text-red-300">{status.message}</div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy && status.state === 'downloading'}>
            Later
          </Button>
          {status.state === 'downloaded' ? (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => run(() => window.api.updater.quitAndInstall())}
            >
              Restart to update
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy || status.state === 'downloading'}
              onClick={() => run(() => window.api.updater.download())}
            >
              {status.state === 'downloading' ? 'Downloading...' : 'Download update'}
            </Button>
          )}
        </div>
      </Card>
    </Modal>
  )
}
