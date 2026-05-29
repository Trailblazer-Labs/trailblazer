import { EventEmitter } from 'node:events'
import * as pty from 'node-pty'
import { getFeature } from './features'
import { getEngine, getEnginePath } from './engine'
import { getProject } from './projectPrefs'
import type { FeatureTerminalEvent } from '@shared/types'

export const featureTerminalBus = new EventEmitter()
type FeatureTerminalStartEvent = Extract<FeatureTerminalEvent, { type: 'start' }>

const terminals = new Map<
  number,
  {
    terminalId: string
    term: pty.IPty
    startEvent: FeatureTerminalStartEvent
    output: string
  }
>()

function emit(evt: FeatureTerminalEvent) {
  featureTerminalBus.emit('event', evt)
}

export function startFeatureTerminal(args: {
  featureId: number
  cols?: number
  rows?: number
  cliSessionId?: string
}): { terminalId: string } {
  const feature = getFeature(args.featureId)
  if (!feature) throw new Error('feature not found')
  const existing = terminals.get(args.featureId)
  if (existing) {
    emit(existing.startEvent)
    if (existing.output) {
      emit({
        type: 'output',
        featureId: args.featureId,
        terminalId: existing.terminalId,
        data: existing.output
      })
    }
    return { terminalId: existing.terminalId }
  }

  const project = getProject(feature.projectId)
  const engine = project?.assistantEngine ?? getEngine()
  if (!engine) throw new Error('No assistant configured for this project')
  const command = getEnginePath(engine)
  const spawnArgs = args.cliSessionId ? ['--resume', args.cliSessionId] : []
  const terminalId = `${args.featureId}-${Date.now()}`

  let term: pty.IPty
  try {
    term = pty.spawn(command, spawnArgs, {
      name: 'xterm-256color',
      cols: args.cols ?? 120,
      rows: args.rows ?? 32,
      cwd: feature.workspacePath,
      env: terminalEnv(feature.workspacePath)
    })
  } catch (e) {
    emit({
      type: 'error',
      featureId: args.featureId,
      terminalId,
      message: e instanceof Error ? e.message : String(e)
    })
    throw e
  }

  const startEvent: FeatureTerminalStartEvent = {
    type: 'start',
    featureId: args.featureId,
    terminalId,
    engine,
    cwd: feature.workspacePath,
    command
  }

  terminals.set(args.featureId, { terminalId, term, startEvent, output: '' })
  emit(startEvent)

  term.onData((data) => {
    const ctx = terminals.get(args.featureId)
    if (ctx) ctx.output += data
    emit({ type: 'output', featureId: args.featureId, terminalId, data })
  })
  term.onExit(({ exitCode }) => {
    terminals.delete(args.featureId)
    emit({ type: 'exit', featureId: args.featureId, terminalId, code: exitCode })
  })

  return { terminalId }
}

export function writeFeatureTerminal(args: { featureId: number; data: string }): { ok: true } {
  const ctx = terminals.get(args.featureId)
  if (!ctx) throw new Error('terminal is not running')
  ctx.term.write(args.data)
  return { ok: true }
}

export function resizeFeatureTerminal(args: {
  featureId: number
  cols: number
  rows: number
}): { ok: true } {
  const ctx = terminals.get(args.featureId)
  if (!ctx) return { ok: true }
  ctx.term.resize(args.cols, args.rows)
  return { ok: true }
}

export function stopFeatureTerminal(featureId: number): { ok: true } {
  const ctx = terminals.get(featureId)
  if (!ctx) return { ok: true }
  ctx.term.kill()
  terminals.delete(featureId)
  return { ok: true }
}

function terminalEnv(workspacePath: string): { [key: string]: string } {
  const env = { ...process.env } as { [key: string]: string }
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
  const cur = env.PATH || ''
  env.PATH = Array.from(new Set([...extra, ...cur.split(':')])).filter(Boolean).join(':')
  env.TERM = env.TERM || 'xterm-256color'
  env.NO_COLOR = ''
  env.TRAILBLAZER_FEATURE_WORKSPACE = workspacePath
  return env
}
