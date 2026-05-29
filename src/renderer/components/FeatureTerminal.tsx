import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Clipboard } from 'lucide-react'
import type { FeatureSession, FeatureTerminalEvent } from '@shared/types'
import { buildResumeCommand } from '../lib/resumeCommand'
import type { Feature } from '@shared/types'

export default function FeatureTerminal({
  featureId,
  feature,
  session
}: {
  featureId: number
  feature?: Feature | null
  session?: FeatureSession | null
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const resizeTimer = useRef<number | null>(null)
  const [running, setRunning] = useState(false)
  const [cwd, setCwd] = useState('')
  const [engine, setEngine] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      convertEol: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 10_000,
      macOptionIsMeta: true,
      theme: {
        background: '#0b0b0b',
        foreground: '#d6d6d6',
        cursor: '#f27a45',
        cursorAccent: '#0b0b0b',
        selectionBackground: '#3a302b',
        black: '#0b0b0b',
        red: '#ff6b6b',
        green: '#48d597',
        yellow: '#f6c85f',
        blue: '#7aa7ff',
        magenta: '#d18bff',
        cyan: '#5fd7d7',
        white: '#d6d6d6',
        brightBlack: '#666666',
        brightRed: '#ff8a8a',
        brightGreen: '#65e6ac',
        brightYellow: '#ffd777',
        brightBlue: '#93b8ff',
        brightMagenta: '#dda0ff',
        brightCyan: '#7ce3e3',
        brightWhite: '#ffffff'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    termRef.current = term
    fitRef.current = fit

    if (hostRef.current) {
      term.open(hostRef.current)
      fit.fit()
      term.focus()
    }

    const inputDisposable = term.onData((data) => {
      void window.api.features.writeTerminal({ featureId, data }).catch((e) => {
        setError(e instanceof Error ? e.message : 'terminal is not running')
      })
    })

    const observer = new ResizeObserver(() => {
      if (resizeTimer.current) window.clearTimeout(resizeTimer.current)
      resizeTimer.current = window.setTimeout(() => {
        fitRef.current?.fit()
        const active = termRef.current
        if (!active) return
        void window.api.features.resizeTerminal({
          featureId,
          cols: active.cols,
          rows: active.rows
        })
      }, 80)
    })
    if (hostRef.current) observer.observe(hostRef.current)

    const unsub = window.api.features.onTerminalEvent((evt: FeatureTerminalEvent) => {
      if (evt.featureId !== featureId) return
      const active = termRef.current
      if (!active) return
      if (evt.type === 'start') {
        setRunning(true)
        setCwd(evt.cwd)
        setEngine(evt.engine)
        setError(null)
        active.clear()
        active.writeln(`$ ${evt.command}`)
        active.writeln(`# cwd: ${evt.cwd}`)
      } else if (evt.type === 'output') {
        active.write(evt.data)
      } else if (evt.type === 'exit') {
        setRunning(false)
        active.writeln('')
        active.writeln(`# terminal exited with code ${evt.code ?? 'null'}`)
      } else if (evt.type === 'error') {
        setRunning(false)
        setError(evt.message)
        active.writeln('')
        active.writeln(`# error: ${evt.message}`)
      }
    })

    void start()

    return () => {
      unsub()
      observer.disconnect()
      inputDisposable.dispose()
      if (resizeTimer.current) window.clearTimeout(resizeTimer.current)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId])

  async function start() {
    setError(null)
    const term = termRef.current
    try {
      await window.api.features.startTerminal({
        featureId,
        cols: term?.cols ?? 120,
        rows: term?.rows ?? 34,
        cliSessionId: session?.cliSessionId ?? undefined
      })
      window.setTimeout(() => termRef.current?.focus(), 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to start terminal')
    }
  }

  async function copyResumeCommand() {
    if (!feature) return
    await navigator.clipboard.writeText(
      buildResumeCommand({ feature, session, engine: engine as import('@shared/types').Engine | null })
    )
  }

  async function stop() {
    await window.api.features.stopTerminal(featureId)
    setRunning(false)
  }

  async function interrupt() {
    await window.api.features.writeTerminal({ featureId, data: '\u0003' })
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-[#0b0b0b]">
      <header className="shrink-0 border-b border-border px-4 py-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted">
            {engine ? `${engine} terminal` : 'Assistant terminal'}
          </div>
          <div className="text-[11px] text-muted truncate">
            {cwd || 'Starting in feature workspace...'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {running && <span className="tb-pulse h-2 w-2 rounded-full bg-amber-300" />}
          {feature && (
            <button
              onClick={() => void copyResumeCommand()}
              title={session?.cliSessionId ? 'Copy resume command' : 'Copy terminal command'}
              className="group relative no-drag h-7 w-7 rounded border border-border bg-panel text-muted hover:text-text flex items-center justify-center"
            >
              <Clipboard size={13} />
              <span className="pointer-events-none absolute right-0 top-8 z-20 hidden w-max max-w-[200px] rounded-md border border-border bg-[#191919] px-2 py-1 text-[10px] text-text shadow-xl group-hover:block">
                {session?.cliSessionId ? 'Copy resume command' : 'Copy terminal command'}
              </span>
            </button>
          )}
          <button
            onClick={() => void interrupt()}
            disabled={!running}
            className="no-drag h-7 px-2 rounded border border-border bg-panel text-[11px] text-muted hover:text-text disabled:opacity-50"
          >
            Ctrl-C
          </button>
          {running ? (
            <button
              onClick={() => void stop()}
              className="no-drag h-7 px-2 rounded border border-red-900/70 bg-red-950/30 text-[11px] text-red-200 hover:bg-red-950/50"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={() => void start()}
              className="no-drag h-7 px-2 rounded border border-accent/40 bg-[#1a1414] text-[11px] text-accent hover:bg-[#221212]"
            >
              Start
            </button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden p-3" onClick={() => termRef.current?.focus()}>
        <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />
      </div>
      {error && <div className="shrink-0 border-t border-border px-4 py-1 text-[11px] text-red-300">{error}</div>}
    </div>
  )
}
