import { useEffect, useState } from 'react'
import { useApp } from './stores/app'
import Onboarding from './pages/Onboarding'
import Projects from './pages/Projects'
import ProjectView from './pages/ProjectView'
import FeatureChatView from './pages/FeatureChatView'
import Splash from './components/Splash'
import { FireLogo } from './components/FireLogo'

const IS_MAC = navigator.platform.toLowerCase().includes('mac')

export default function App() {
  const { view, setView, applyRunEvent } = useApp()
  const [splashDone, setSplashDone] = useState(false)

  useEffect(() => {
    window.api.config.get().then((cfg) => {
      if (!cfg.githubPatConfigured || !cfg.engineConfigured) {
        setView({ kind: 'onboarding' })
      } else {
        setView({ kind: 'projects' })
      }
    })
    const unsub = window.api.runs.onEvent(applyRunEvent)
    return () => unsub()
  }, [setView, applyRunEvent])

  return (
    <div className="h-full flex flex-col">
      {!splashDone && <Splash onDone={() => setSplashDone(true)} />}
      {/* Thin draggable strip at top so the window stays movable; reserves space for macOS traffic lights. */}
      {IS_MAC && <div className="titlebar-drag h-7 shrink-0" />}
      <div className="flex-1 overflow-hidden">
        {view.kind === 'loading' && (
          <div className="h-full flex items-center justify-center text-muted">
            <FireLogo size={28} flicker />
          </div>
        )}
        {view.kind === 'onboarding' && <Onboarding />}
        {view.kind === 'projects' && <Projects />}
        {view.kind === 'project' && <ProjectView projectId={view.projectId} />}
        {view.kind === 'feature' && (
          <FeatureChatView
            projectId={view.projectId}
            featureId={view.featureId}
            sessionId={view.sessionId}
          />
        )}
      </div>
    </div>
  )
}
