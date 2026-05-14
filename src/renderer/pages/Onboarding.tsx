import { useEffect, useState } from 'react'
import { Button, Input, Card } from '../components/ui'
import { useApp } from '../stores/app'
import type { Engine, EngineDetection, GhAuthEvent } from '@shared/types'

type Step = 'auth' | 'done'

export default function Onboarding() {
  const [step, setStep] = useState<Step>('auth')
  const setView = useApp((s) => s.setView)

  // engine state
  const [detect, setDetect] = useState<EngineDetection | null>(null)
  const [engine, setEngine] = useState<Engine | null>(null)

  useEffect(() => {
    window.api.config.detectEngines().then((d) => {
      setDetect(d)
      if (d.claude.found) setEngine('claude')
      else if (d.codex.found) setEngine('codex')
    })
  }, [])

  async function finishSetup() {
    try {
      if (engine && detect?.[engine]?.found) {
        await window.api.config.setEngine({ engine, path: detect[engine].path })
      }
      setStep('done')
      setTimeout(() => setView({ kind: 'projects' }), 500)
    } catch {
      setStep('done')
      setTimeout(() => setView({ kind: 'projects' }), 500)
    }
  }

  return (
    <div className="h-full flex items-center justify-center px-6">
      <Card className="w-[560px] p-7">
        <div className="text-xs text-muted mb-2">Setup</div>
        <h1 className="font-brand text-2xl mb-6">Welcome to <span className="text-accent">Trailblazer</span></h1>

        <Steps step={step} />

        {step === 'auth' && <AuthStep onDone={() => void finishSetup()} />}

        {step === 'done' && (
          <div className="mt-6 text-sm text-muted">All set. Loading your projects…</div>
        )}
      </Card>
    </div>
  )
}

function AuthStep({ onDone }: { onDone: () => void }) {
  const [ghAvail, setGhAvail] = useState<{ found: boolean; version?: string } | null>(null)
  const [mode, setMode] = useState<'gh' | 'pat'>('gh')

  // gh flow state
  const [phase, setPhase] = useState<'idle' | 'starting' | 'code' | 'verifying' | 'done' | 'error'>(
    'idle'
  )
  const [code, setCode] = useState<string | null>(null)
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [login, setLogin] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  // pat fallback state
  const [pat, setPat] = useState('')
  const [patBusy, setPatBusy] = useState(false)
  const [patError, setPatError] = useState<string | null>(null)

  useEffect(() => {
    window.api.gh.detect().then((d) => {
      setGhAvail(d)
      if (!d.found) setMode('pat')
    })
    const unsub = window.api.gh.onEvent((evt: GhAuthEvent) => {
      if (evt.type === 'code') {
        setCode(evt.code)
        setVerifyUrl(evt.url)
        setPhase('code')
      } else if (evt.type === 'progress') {
        setPhase('verifying')
        setProgress(evt.message)
      } else if (evt.type === 'done') {
        setLogin(evt.login)
        setPhase('done')
        setTimeout(onDone, 600)
      } else if (evt.type === 'error') {
        setErrMsg(evt.message)
        setPhase('error')
      }
    })
    return () => unsub()
  }, [onDone])

  async function startGhLogin() {
    setPhase('starting')
    setCode(null)
    setProgress(null)
    setErrMsg(null)
    await window.api.gh.loginStart()
  }

  async function cancelGhLogin() {
    await window.api.gh.loginCancel()
    setPhase('idle')
    setCode(null)
  }

  async function savePat() {
    setPatBusy(true)
    setPatError(null)
    try {
      const { login: who } = await window.api.config.setGithubPat(pat.trim())
      setLogin(who)
      setPhase('done')
      setTimeout(onDone, 500)
    } catch (e) {
      setPatError(e instanceof Error ? e.message : 'invalid token')
    } finally {
      setPatBusy(false)
    }
  }

  return (
    <div className="mt-6 space-y-3">
      {mode === 'gh' && (
        <>
          <div className="text-sm">Sign in with GitHub</div>
          <div className="text-xs text-muted">
            Trailblazer uses the GitHub CLI to sign you in via your browser. This handles SSO and
            org grants — no PAT request needed.
          </div>

          {ghAvail && !ghAvail.found && (
            <div className="rounded-md border border-border bg-bg p-3 text-xs space-y-2">
              <div className="text-amber-400">GitHub CLI not found on PATH.</div>
              <div className="text-muted">
                Install via Homebrew: <code className="text-text">brew install gh</code>
              </div>
              <button
                className="text-accent underline"
                onClick={() => setMode('pat')}
              >
                Use a token instead →
              </button>
            </div>
          )}

          {ghAvail?.found && (
            <>
              {phase === 'idle' && (
                <div className="flex items-center justify-between pt-1">
                  <button
                    className="text-xs text-muted hover:text-text underline"
                    onClick={() => setMode('pat')}
                  >
                    Use a token instead
                  </button>
                  <Button variant="primary" onClick={startGhLogin}>
                    Sign in with GitHub
                  </Button>
                </div>
              )}

              {phase === 'starting' && (
                <div className="text-xs text-muted">Starting gh auth login…</div>
              )}

              {phase === 'code' && code && (
                <div className="rounded-md border border-border bg-bg p-4 space-y-3">
                  <div className="text-xs text-muted">Your one-time code</div>
                  <div className="flex items-center gap-3">
                    <div className="font-mono text-2xl tracking-widest text-accent">{code}</div>
                    <button
                      className="text-xs text-muted hover:text-text"
                      onClick={() => navigator.clipboard.writeText(code)}
                    >
                      Copy
                    </button>
                  </div>
                  <div className="text-xs text-muted">
                    Browser should have opened. If not, visit{' '}
                    <a href={verifyUrl ?? 'https://github.com/login/device'} className="text-accent underline">
                      {verifyUrl ?? 'github.com/login/device'}
                    </a>{' '}
                    and paste the code.
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={cancelGhLogin}>Cancel</Button>
                  </div>
                </div>
              )}

              {phase === 'verifying' && (
                <div className="text-xs text-muted">{progress || 'Verifying…'}</div>
              )}

              {phase === 'done' && login && (
                <div className="text-sm">Signed in as @{login}</div>
              )}

              {phase === 'error' && (
                <div className="space-y-2">
                  <div className="text-red-400 text-xs">{errMsg}</div>
                  <Button onClick={startGhLogin}>Try again</Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {mode === 'pat' && (
        <>
          <div className="text-sm">Use a Personal Access Token</div>
          <div className="text-xs text-muted">
            Paste a token with <code>repo</code> scope. Stored locally in Trailblazer's app data.
          </div>
          <Input
            type="password"
            placeholder="ghp_…"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            autoFocus
          />
          {patError && <div className="text-red-400 text-xs">{patError}</div>}
          <div className="flex items-center justify-between pt-1">
            {ghAvail?.found && (
              <button
                className="text-xs text-muted hover:text-text underline"
                onClick={() => setMode('gh')}
              >
                ← Back to gh sign-in
              </button>
            )}
            <Button variant="primary" disabled={!pat || patBusy} onClick={savePat}>
              {patBusy ? 'Validating…' : 'Continue'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function Steps({ step }: { step: Step }) {
  const items: { id: Step; label: string }[] = [
    { id: 'auth', label: 'GitHub' },
    { id: 'done', label: 'Done' }
  ]
  const idx = items.findIndex((i) => i.id === step)
  return (
    <div className="flex items-center gap-2 text-xs">
      {items.map((it, i) => (
        <div key={it.id} className="flex items-center gap-2">
          <div
            className={
              'w-5 h-5 rounded-full flex items-center justify-center border ' +
              (i <= idx ? 'border-accent text-accent' : 'border-border text-muted')
            }
          >
            {i + 1}
          </div>
          <span className={i <= idx ? 'text-text' : 'text-muted'}>{it.label}</span>
          {i < items.length - 1 && <div className="w-6 h-px bg-border mx-1" />}
        </div>
      ))}
    </div>
  )
}
