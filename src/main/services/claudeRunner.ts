import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { spawn } from 'node:child_process'
import { getDb } from './db'
import {
  createWorktree,
  diffAgainstBase,
  commitAll,
  hasChanges,
  pushBranch,
  refreshRemoteUrl,
  removeWorktree,
  ensureRepoCloned
} from './git'
import * as gh from './github'
import { spawnAgent } from './engine'
import { createParser } from './agentParser'
import { getProjectIdForRepo, resolveProjectAgent } from './projectPrefs'
import { extractAgentApiError } from './agentErrors'
import { AGENT_INSTRUCTIONS_FILE_PROMPT } from './agentInstructions'
import type { ActiveIssueRun, Run, RunEvent, DiffFile } from '@shared/types'

export const runnerBus = new EventEmitter()

const inFlight = new Map<
  string,
  {
    run: Run
    repoOwner: string
    repoName: string
    issueNumber: number
    issueTitle: string
    baseBranch: string
    repoPath: string
    diff?: DiffFile[]
    cancelled?: boolean
    proc?: ReturnType<typeof spawn>
  }
>()

function emit(evt: RunEvent) {
  runnerBus.emit('event', evt)
  if (evt.type === 'log') {
    getDb()
      .prepare('INSERT INTO run_logs(run_id, stream, chunk) VALUES(?,?,?)')
      .run(evt.runId, evt.stream, evt.chunk)
  }
}

function setStatus(runId: string, status: Run['status']) {
  const ended = status === 'pushed' || status === 'failed' || status === 'cancelled'
  getDb()
    .prepare(
      ended
        ? "UPDATE runs SET status = ?, ended_at = datetime('now') WHERE id = ?"
        : 'UPDATE runs SET status = ? WHERE id = ?'
    )
    .run(status, runId)
  const ctx = inFlight.get(runId)
  if (ctx) ctx.run.status = status
  emit({ type: 'status', runId, status })
}

export function isRunInFlight(): boolean {
  return inFlight.size > 0
}

export function getActiveRun(): ActiveIssueRun | null {
  const ctx = [...inFlight.values()][0]
  if (!ctx) return null
  return {
    run: ctx.run,
    repoOwner: ctx.repoOwner,
    repoName: ctx.repoName,
    issueNumber: ctx.issueNumber,
    issueTitle: ctx.issueTitle
  }
}

export async function startRun(opts: {
  repoId: number
  repoOwner: string
  repoName: string
  defaultBranch: string
  issueNumber: number
  issueTitle: string
  issueBody: string
}): Promise<Run> {
  if (isRunInFlight()) throw new Error('Another run is in progress; v0 allows one at a time')

  const id = randomUUID().slice(0, 8)
  const branch = `trailblazer/issue-${opts.issueNumber}-${id}`
  const repoPath = await ensureRepoCloned(opts.repoOwner, opts.repoName)
  // Use the repo's configured working branch when present, falling back to its default branch.
  const baseBranch =
    (getDb()
      .prepare('SELECT COALESCE(working_branch, default_branch) AS b FROM repos WHERE id = ?')
      .get(opts.repoId) as { b: string } | undefined)?.b ?? opts.defaultBranch
  const worktreePath = await createWorktree(repoPath, branch, baseBranch)

  const run: Run = {
    id,
    issueId: opts.issueNumber,
    repoId: opts.repoId,
    worktreePath,
    branch,
    status: 'pending',
    prNumber: null,
    startedAt: new Date().toISOString(),
    endedAt: null
  }

  getDb()
    .prepare(
      'INSERT INTO runs(id, issue_repo_id, issue_number, worktree_path, branch, status) VALUES(?,?,?,?,?,?)'
    )
    .run(id, opts.repoId, opts.issueNumber, worktreePath, branch, 'pending')

  inFlight.set(id, {
    run,
    repoOwner: opts.repoOwner,
    repoName: opts.repoName,
    issueNumber: opts.issueNumber,
    issueTitle: opts.issueTitle,
    baseBranch,
    repoPath
  })

  // Fire and forget; events stream out via runnerBus.
  void execute(id, opts.issueTitle, opts.issueBody).catch((e: unknown) => {
    emit({ type: 'error', runId: id, message: e instanceof Error ? e.message : String(e) })
    setStatus(id, 'failed')
    inFlight.delete(id)
  })

  return run
}

async function execute(runId: string, issueTitle: string, issueBody: string) {
  const ctx = inFlight.get(runId)
  if (!ctx) return
  setStatus(runId, 'running')

  let engine
  let model
  try {
    ;({ engine, model } = resolveProjectAgent(getProjectIdForRepo(ctx.run.repoId), 'issueResolve'))
  } catch (e) {
    emit({ type: 'error', runId, message: e instanceof Error ? e.message : 'No assistant configured' })
    setStatus(runId, 'failed')
    inFlight.delete(runId)
    return
  }
  const prompt = buildPrompt(issueTitle, issueBody)
  const parser = createParser(engine)

  const { proc, done, getStdout } = spawnAgent(
    engine,
    prompt,
    'write',
    ctx.run.worktreePath,
    (stream, chunk) => {
      emit({ type: 'log', runId, stream, chunk })
      for (const a of parser.feed(stream, chunk)) emit({ type: 'activity', runId, activity: a })
    },
    { model }
  )
  ctx.proc = proc

  const code = await done
  const stdout = getStdout()
  if (ctx.cancelled) {
    setStatus(runId, 'cancelled')
    await cleanupWorktree(runId)
    inFlight.delete(runId)
    return
  }
  if (code !== 0) {
    emit({ type: 'error', runId, message: `${engine} exited with code ${code}` })
    setStatus(runId, 'failed')
    await cleanupWorktree(runId)
    inFlight.delete(runId)
    return
  }

  const apiError = extractAgentApiError(stdout)
  if (apiError) {
    emit({ type: 'error', runId, message: apiError })
    setStatus(runId, 'failed')
    await cleanupWorktree(runId)
    inFlight.delete(runId)
    return
  }

  const dirty = await hasChanges(ctx.run.worktreePath)
  if (!dirty) {
    emit({ type: 'error', runId, message: 'No changes produced; nothing to PR' })
    setStatus(runId, 'failed')
    await cleanupWorktree(runId)
    inFlight.delete(runId)
    return
  }

  await commitAll(ctx.run.worktreePath, `${issueTitle}\n\nCloses #${ctx.issueNumber}`)
  const diff = await diffAgainstBase(ctx.run.worktreePath, ctx.baseBranch)
  ctx.diff = diff
  emit({ type: 'diff-ready', runId, files: diff })
  setStatus(runId, 'awaiting-approval')
}

export async function approvePush(runId: string): Promise<{ prNumber: number; url: string }> {
  const ctx = inFlight.get(runId)
  if (!ctx) throw new Error('run not found or already completed')
  if (ctx.run.status !== 'awaiting-approval') throw new Error('run is not awaiting approval')

  await refreshRemoteUrl(ctx.run.worktreePath, ctx.repoOwner, ctx.repoName)
  await pushBranch(ctx.run.worktreePath, ctx.run.branch)
  const pr = await gh.createPull(ctx.repoOwner, ctx.repoName, {
    title: ctx.issueTitle,
    body: `Closes #${ctx.issueNumber}\n\nGenerated by Trailblazer.`,
    head: ctx.run.branch,
    base: ctx.baseBranch
  })
  getDb().prepare('UPDATE runs SET pr_number = ? WHERE id = ?').run(pr.number, runId)
  ctx.run.prNumber = pr.number
  emit({ type: 'pr-created', runId, prNumber: pr.number, url: pr.url })
  setStatus(runId, 'pushed')
  await cleanupWorktree(runId)
  inFlight.delete(runId)
  return { prNumber: pr.number, url: pr.url }
}

export async function cancelRun(runId: string) {
  const ctx = inFlight.get(runId)
  if (!ctx) return
  ctx.cancelled = true
  if (ctx.proc && !ctx.proc.killed) {
    ctx.proc.kill('SIGTERM')
  } else {
    setStatus(runId, 'cancelled')
    await cleanupWorktree(runId)
    inFlight.delete(runId)
  }
}

async function cleanupWorktree(runId: string) {
  const ctx = inFlight.get(runId)
  if (!ctx) return
  try {
    await removeWorktree(ctx.repoPath, ctx.run.worktreePath)
  } catch {
    // best-effort
  }
}

function buildPrompt(title: string, body: string): string {
  return [
    'You are working inside a git worktree to resolve a single GitHub issue.',
    AGENT_INSTRUCTIONS_FILE_PROMPT,
    'Make the minimal set of code changes to fully resolve the issue.',
    'Do not run git commit or git push — Trailblazer handles version control.',
    'When done, stop.',
    '',
    `Issue title: ${title}`,
    '',
    'Issue description:',
    body || '(no description provided)'
  ].join('\n')
}
