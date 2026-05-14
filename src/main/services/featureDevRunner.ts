import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { listFeatureRepos } from './features'
import {
  computeDependencyHash,
  getProfile,
  getSetupState,
  resolveProfileWorktree,
  upsertSetupState,
  normalizeCwd
} from './devProfiles'
import type { FeatureDevCommandEvent } from '@shared/types'

export const featureDevBus = new EventEmitter()

const running = new Map<
  number,
  {
    commandId: string
    proc: ReturnType<typeof spawn>
  }
>()

function emit(evt: FeatureDevCommandEvent) {
  featureDevBus.emit('event', evt)
}

export async function startDevCommand(args: {
  featureId: number
  repoId: number
  command: string
  cwd?: string
}): Promise<{ commandId: string }> {
  const command = args.command.trim()
  if (!command) throw new Error('command is required')
  if (running.has(args.featureId)) {
    throw new Error('A dev command is already running for this feature.')
  }
  const repo = listFeatureRepos(args.featureId).find((r) => r.repoId === args.repoId)
  if (!repo) throw new Error('repo is not attached to this feature')
  const cwdPart = normalizeCwd(args.cwd ?? '.')
  const cwd = path.resolve(repo.worktreePath, cwdPart)
  const started = startProcess({
    featureId: args.featureId,
    repoId: repo.repoId,
    repoName: repo.repoName,
    command,
    cwd,
    workspaceRoot: path.dirname(repo.worktreePath),
    keepRunning: true
  })
  return { commandId: started.commandId }
}

export async function startProfileDevCommand(args: {
  featureId: number
  profileId: number
}): Promise<{ commandId: string }> {
  const profile = getProfile(args.profileId)
  if (!profile) throw new Error('dev profile not found')
  const state = getSetupState(args.featureId, args.profileId)
  if (profile.setupCommand && state.status !== 'passed') {
    throw new Error('Run setup before starting this dev command.')
  }
  const { repo, cwd, workspaceRoot } = resolveProfileWorktree(args.featureId, profile)
  const started = startProcess({
    featureId: args.featureId,
    repoId: repo.repoId,
    repoName: repo.repoName,
    command: profile.devCommand,
    cwd,
    workspaceRoot,
    env: profile.env,
    keepRunning: true
  })
  return { commandId: started.commandId }
}

export async function runProfileSetup(args: {
  featureId: number
  profileId: number
}): Promise<{ ok: true }> {
  const profile = getProfile(args.profileId)
  if (!profile) throw new Error('dev profile not found')
  if (!profile.setupCommand) {
    upsertSetupState({
      featureId: args.featureId,
      profileId: args.profileId,
      dependencyHash: computeDependencyHash(args.featureId, profile),
      status: 'passed',
      exitCode: 0,
      logs: ''
    })
    return { ok: true }
  }
  if (running.has(args.featureId)) {
    throw new Error('A dev command is already running for this feature.')
  }
  const hash = computeDependencyHash(args.featureId, profile)
  const { repo, cwd, workspaceRoot } = resolveProfileWorktree(args.featureId, profile)
  upsertSetupState({
    featureId: args.featureId,
    profileId: args.profileId,
    dependencyHash: hash,
    status: 'running',
    exitCode: null,
    logs: ''
  })
  const result = await startProcess({
    featureId: args.featureId,
    repoId: repo.repoId,
    repoName: repo.repoName,
    command: profile.setupCommand,
    cwd,
    workspaceRoot,
    env: profile.env,
    keepRunning: false
  })
  await result.done
  const logs = result.getLogs()
  upsertSetupState({
    featureId: args.featureId,
    profileId: args.profileId,
    dependencyHash: hash,
    status: result.exitCode === 0 ? 'passed' : 'failed',
    exitCode: result.exitCode,
    logs
  })
  return { ok: true }
}

export function stopDevCommand(featureId: number): { ok: true } {
  const ctx = running.get(featureId)
  if (!ctx) return { ok: true }
  if (!ctx.proc.killed) ctx.proc.kill('SIGTERM')
  return { ok: true }
}

function startProcess(args: {
  featureId: number
  repoId: number
  repoName: string
  command: string
  cwd: string
  workspaceRoot: string
  env?: Record<string, string>
  keepRunning: boolean
}): {
  commandId: string
  done: Promise<void>
  getLogs: () => string
  exitCode: number | null
} {
  const commandId = `${args.featureId}-${Date.now()}`
  let logs = ''
  let exitCode: number | null = null
  const proc = spawn(args.command, {
    cwd: args.cwd,
    shell: true,
    env: {
      ...process.env,
      ...(args.env ?? {}),
      TRAILBLAZER_FEATURE_WORKSPACE: args.workspaceRoot,
      TRAILBLAZER_TARGET_REPO: args.cwd
    }
  })
  running.set(args.featureId, { commandId, proc })
  emit({
    type: 'start',
    featureId: args.featureId,
    commandId,
    repoId: args.repoId,
    repoName: args.repoName,
    command: args.command,
    cwd: args.cwd
  })
  proc.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    logs += text
    emit({ type: 'output', featureId: args.featureId, commandId, stream: 'stdout', chunk: text })
  })
  proc.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    logs += text
    emit({ type: 'output', featureId: args.featureId, commandId, stream: 'stderr', chunk: text })
  })
  const done = new Promise<void>((resolve) => {
    proc.on('error', (error) => {
      logs += `\n# error: ${error.message}\n`
      emit({ type: 'error', featureId: args.featureId, commandId, message: error.message })
    })
    proc.on('close', (code) => {
      exitCode = code ?? 1
      running.delete(args.featureId)
      emit({ type: 'exit', featureId: args.featureId, commandId, code })
      resolve()
    })
  })
  const result = {
    commandId,
    done,
    getLogs: () => logs,
    get exitCode() {
      return exitCode
    }
  }
  if (args.keepRunning) void done
  return result
}
