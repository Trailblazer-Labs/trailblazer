import { EventEmitter } from 'node:events'
import path from 'node:path'
import fs from 'node:fs'
import simpleGit from 'simple-git'
import { getDb } from './db'
import { getEngine, spawnAgent } from './engine'
import { createParser } from './agentParser'
import {
  getFeature,
  listFeatureRepos,
  ensureDefaultSession,
  getSession,
  getSessionBaselines,
  getSessionCli,
  setSessionCli,
  clearSessionCli,
  touchSession
} from './features'
import { pushBranch } from './git'
import * as gh from './github'
import { getModel, setModel } from './modelPrefs'
import type {
  AgentActivity,
  Engine,
  FeatureMessage,
  FeatureRepo
} from '@shared/types'

export type FeatureRunEvent =
  | { type: 'start'; featureId: number; engine: Engine; userMessageId: number }
  | {
      type: 'activity'
      featureId: number
      activity: AgentActivity
    }
  | {
      type: 'done'
      featureId: number
      assistantMessageId: number
      perRepo: Array<{
        repoId: number
        repoName: string
        branch: string
        commitsAdded: number
        filesChanged: number
        hasUncommitted: boolean
      }>
    }
  | { type: 'error'; featureId: number; message: string }

export const featureBus = new EventEmitter()

const inFlight = new Map<
  number, // featureId
  {
    cancelled?: boolean
    proc?: ReturnType<typeof spawnAgent>['proc']
  }
>()

function emit(evt: FeatureRunEvent) {
  featureBus.emit('event', evt)
}

export function listMessages(sessionId: number): FeatureMessage[] {
  const rows = getDb()
    .prepare(
      `SELECT id, feature_id, session_id, role, content, activities, ts FROM feature_messages
       WHERE session_id = ? ORDER BY id ASC`
    )
    .all(sessionId) as {
    id: number
    feature_id: number
    session_id: number | null
    role: 'user' | 'assistant' | 'system'
    content: string
    activities: string | null
    ts: string
  }[]
  return rows.map((r) => ({
    id: r.id,
    featureId: r.feature_id,
    sessionId: r.session_id,
    role: r.role,
    content: r.content,
    activities: r.activities ? (JSON.parse(r.activities) as AgentActivity[]) : null,
    ts: r.ts
  }))
}

function insertMessage(
  featureId: number,
  sessionId: number,
  role: 'user' | 'assistant' | 'system',
  content: string,
  activities?: AgentActivity[] | null
): number {
  const r = getDb()
    .prepare(
      `INSERT INTO feature_messages(feature_id, session_id, role, content, activities) VALUES(?,?,?,?,?)`
    )
    .run(featureId, sessionId, role, content, activities ? JSON.stringify(activities) : null)
  return Number(r.lastInsertRowid)
}

function updateAssistantMessage(id: number, content: string, activities: AgentActivity[]) {
  getDb()
    .prepare(`UPDATE feature_messages SET content = ?, activities = ? WHERE id = ?`)
    .run(content, JSON.stringify(activities), id)
}

export function cancelRun(featureId: number) {
  const ctx = inFlight.get(featureId)
  if (!ctx) return
  ctx.cancelled = true
  if (ctx.proc && !ctx.proc.killed) ctx.proc.kill('SIGTERM')
}

export async function sendPrompt(args: {
  featureId: number
  sessionId?: number
  prompt: string
  model?: string
}): Promise<{ assistantMessageId: number; sessionId: number }> {
  const feature = getFeature(args.featureId)
  if (!feature) throw new Error('feature not found')
  if (inFlight.has(args.featureId)) throw new Error('a turn is already in flight for this feature')

  const engine = getEngine()
  if (!engine) throw new Error('no engine configured')

  const repos = listFeatureRepos(args.featureId)
  if (repos.length === 0) throw new Error('feature has no repositories')

  // Resolve a session — caller can pin one, else fall back to the default.
  const session = args.sessionId
    ? getSession(args.sessionId) ?? ensureDefaultSession(args.featureId)
    : ensureDefaultSession(args.featureId)

  // Snapshot pre-run HEAD per repo so we can report what this turn changed.
  const heads = new Map<number, string>()
  for (const r of repos) {
    try {
      const git = simpleGit(r.worktreePath)
      heads.set(r.repoId, await git.revparse(['HEAD']))
    } catch {
      heads.set(r.repoId, '')
    }
  }

  // Persist the user's message immediately.
  const userMessageId = insertMessage(args.featureId, session.id, 'user', args.prompt)
  // Resume only if this session was previously used with the same engine.
  const cliSessionId = session.engine === engine ? getSessionCli(session.id, engine) : null
  const isFirstTurn = !cliSessionId
  const prompt = isFirstTurn
    ? buildFirstTurnPrompt(feature.workspacePath, repos, args.prompt)
    : args.prompt

  emit({ type: 'start', featureId: args.featureId, engine, userMessageId })

  inFlight.set(args.featureId, {})
  const parser = createParser(engine)
  const collected: AgentActivity[] = []
  let observedSessionId: string | null = null

  // Pre-create assistant message row so renderer can attach activities to it.
  const assistantMessageId = insertMessage(args.featureId, session.id, 'assistant', '', [])

  const model = args.model || getModel('feature', engine)
  if (args.model) setModel('feature', engine, args.model)
  const { proc, done, getStdout, getStderr } = spawnAgent(
    engine,
    prompt,
    'write',
    feature.workspacePath,
    (stream, chunk) => {
      if (!observedSessionId) {
        const m = chunk.match(/"session_id"\s*:\s*"([^"]+)"/)
        if (m) {
          observedSessionId = m[1]
          setSessionCli(session.id, engine, m[1])
        }
      }
      for (const a of parser.feed(stream, chunk)) {
        collected.push(a)
        emit({ type: 'activity', featureId: args.featureId, activity: a })
      }
    },
    { resume: cliSessionId ?? undefined, model }
  )
  inFlight.get(args.featureId)!.proc = proc

  const code = await done
  const ctx = inFlight.get(args.featureId)
  inFlight.delete(args.featureId)
  touchSession(session.id)

  if (ctx?.cancelled) {
    updateAssistantMessage(assistantMessageId, '[cancelled]', collected)
    emit({ type: 'error', featureId: args.featureId, message: 'cancelled' })
    return { assistantMessageId, sessionId: session.id }
  }

  if (code !== 0) {
    const stderr = getStderr()
    const stdout = getStdout()
    // eslint-disable-next-line no-console
    console.error(`[feature ${args.featureId}] ${engine} stderr:`, stderr)
    // eslint-disable-next-line no-console
    console.error(`[feature ${args.featureId}] ${engine} stdout:`, stdout)
    const tail = (stderr || stdout).trim().split('\n').find((l) => /^(error|Error)/.test(l)) ?? ''
    const msg = `${engine} exited with code ${code}${tail ? `: ${tail}` : ''}`
    updateAssistantMessage(assistantMessageId, msg, collected)
    // If session-resume failed, clear the CLI session so the next turn starts fresh.
    if (cliSessionId && /session|resume/i.test(stderr)) clearSessionCli(session.id)
    emit({ type: 'error', featureId: args.featureId, message: msg })
    return { assistantMessageId, sessionId: session.id }
  }

  // Extract the FULL assistant text from raw stdout (the parser truncates the activity
  // detail for display, so we can't rely on collected activities for storage).
  const stdout = getStdout()
  const finalText = extractFinalText(engine, stdout, collected)
  updateAssistantMessage(assistantMessageId, finalText, collected)

  // Walk each repo and summarize what this turn changed.
  const perRepo = await Promise.all(
    repos.map(async (r) => {
      let commitsAdded = 0
      let filesChanged = 0
      let hasUncommitted = false
      try {
        const git = simpleGit(r.worktreePath)
        const preHead = heads.get(r.repoId)
        if (preHead) {
          const log = await git.log({ from: preHead, to: 'HEAD' }).catch(() => null)
          commitsAdded = log?.total ?? 0
          if (commitsAdded > 0) {
            const diffSummary = await git.diffSummary([`${preHead}..HEAD`]).catch(() => null)
            filesChanged = diffSummary?.files.length ?? 0
          }
        }
        const status = await git.status()
        hasUncommitted = !status.isClean()
      } catch {
        // ignore
      }
      return {
        repoId: r.repoId,
        repoName: r.repoName,
        branch: r.branch,
        commitsAdded,
        filesChanged,
        hasUncommitted
      }
    })
  )

  emit({ type: 'done', featureId: args.featureId, assistantMessageId, perRepo })
  return { assistantMessageId, sessionId: session.id }
}

/**
 * Pull the full final assistant text straight from the engine's raw stdout. Parser activities
 * are display-trimmed; the raw JSONL stream still has the complete result we want to persist.
 * Falls back to whatever the activity stream surfaced if parsing fails.
 */
function extractFinalText(engine: Engine, stdout: string, activities: AgentActivity[]): string {
  const fallback =
    [...activities].reverse().find((a) => a.kind === 'message')?.label ??
    [...activities].reverse().find((a) => a.kind === 'final' && a.detail)?.detail ??
    ''
  const trimmed = stdout.trim()
  if (!trimmed) return fallback

  if (engine === 'claude') {
    // Look for the final {"type":"result","result":"..."} JSONL line.
    for (const line of trimmed.split('\n').reverse()) {
      const s = line.trim()
      if (!s.startsWith('{')) continue
      try {
        const ev = JSON.parse(s)
        if (ev?.type === 'result' && typeof ev.result === 'string') return ev.result
      } catch {
        // ignore non-JSON line
      }
    }
    return fallback
  }

  // Codex --json: walk events, accumulate the latest agent_message / item.completed of type
  // 'message', or grab task_complete.last_agent_message.
  let latest = ''
  for (const line of trimmed.split('\n')) {
    const s = line.trim()
    if (!s.startsWith('{')) continue
    try {
      const ev = JSON.parse(s)
      const msg = ev?.msg ?? ev
      const t = msg?.type
      if (t === 'agent_message' && typeof msg.message === 'string') {
        latest = msg.message
      } else if (t === 'agent_message_delta' && typeof msg.delta === 'string') {
        latest += msg.delta
      } else if (
        (t === 'item.completed' || t === 'item.finished') &&
        msg.item &&
        (msg.item.item_type === 'message' || msg.item.type === 'message')
      ) {
        const text: string =
          msg.item.text ??
          msg.item.content ??
          (Array.isArray(msg.item.content)
            ? msg.item.content
                .map((c: { text?: string }) => c?.text ?? '')
                .join('')
            : '') ??
          ''
        if (text.trim()) latest = text
      } else if (t === 'task_complete' && typeof msg.last_agent_message === 'string') {
        latest = msg.last_agent_message
      }
    } catch {
      // ignore
    }
  }
  return latest || fallback
}

function buildFirstTurnPrompt(
  workspacePath: string,
  repos: FeatureRepo[],
  userPrompt: string
): string {
  const repoLines = repos
    .map(
      (r) => `  - ${r.repoName}/   (branch: ${r.branch}, base: ${r.baseBranch})`
    )
    .join('\n')
  return [
    'You are working inside a multi-repo workspace for a single coordinated feature.',
    `Workspace root: ${workspacePath}`,
    'Each subdirectory is an independent git repository (worktree) on a feature branch:',
    repoLines,
    '',
    'Guidelines:',
    '- Make whatever changes are needed across one or more repos.',
    '- Use git inside the relevant repo subdirectory if you need to commit.',
    '- Do NOT run `git push` — the user will press "Create PRs" when they are ready.',
    "- Don't switch branches inside a worktree.",
    '- Reference files by their full path within the workspace, e.g. `clore/src/foo.ts`.',
    '',
    'User request:',
    userPrompt
  ].join('\n')
}

export interface FeatureCommitResult {
  repoId: number
  repoName: string
  status: 'committed' | 'clean' | 'failed'
  sha?: string
  filesCommitted?: number
  error?: string
}

/**
 * Commit any uncommitted work in every repo's worktree with a shared message. Returns a
 * per-repo summary the UI can show.
 */
export async function commitFeatureChanges(
  featureId: number,
  message: string
): Promise<FeatureCommitResult[]> {
  const feature = getFeature(featureId)
  if (!feature) throw new Error('feature not found')
  const msg = message.trim() || `chore: ${feature.name} WIP`
  const repos = listFeatureRepos(featureId)
  const out: FeatureCommitResult[] = []
  for (const r of repos) {
    try {
      const git = simpleGit(r.worktreePath)
      const status = await git.status()
      if (status.isClean()) {
        out.push({ repoId: r.repoId, repoName: r.repoName, status: 'clean' })
        continue
      }
      const fileCount = status.files.length
      await git.add(['-A'])
      const commit = await git.commit(msg)
      out.push({
        repoId: r.repoId,
        repoName: r.repoName,
        status: 'committed',
        sha: commit.commit,
        filesCommitted: fileCount
      })
    } catch (e) {
      out.push({
        repoId: r.repoId,
        repoName: r.repoName,
        status: 'failed',
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }
  return out
}

export async function createPRs(featureId: number): Promise<
  Array<{
    repoId: number
    repoName: string
    branch: string
    status: 'opened' | 'existing' | 'skipped'
    prNumber?: number
    prUrl?: string
    reason?: string
  }>
> {
  const feature = getFeature(featureId)
  if (!feature) throw new Error('feature not found')
  const repos = listFeatureRepos(featureId)
  const results: Array<{
    repoId: number
    repoName: string
    branch: string
    status: 'opened' | 'existing' | 'skipped'
    prNumber?: number
    prUrl?: string
    reason?: string
  }> = []

  for (const r of repos) {
    try {
      const git = simpleGit(r.worktreePath)
      // Auto-commit any uncommitted changes so they make it into the PR.
      const status = await git.status()
      if (!status.isClean()) {
        await git.add(['-A'])
        await git.commit(`WIP: ${feature.name}`)
      }
      const log = await git
        .log({ from: `origin/${r.baseBranch}`, to: 'HEAD' })
        .catch(() => null)
      if (!log || log.total === 0) {
        results.push({
          repoId: r.repoId,
          repoName: r.repoName,
          branch: r.branch,
          status: 'skipped',
          reason: 'no commits ahead of base'
        })
        continue
      }
      await pushBranch(r.worktreePath, r.branch)

      // Look for an existing PR for this branch.
      const owner = await getOwnerFromRepoId(r.repoId)
      const existing = await octokitListPR(owner, r.repoName, r.branch)
      if (existing) {
        getDb()
          .prepare(
            'UPDATE feature_repos SET pr_number = ?, pr_url = ? WHERE feature_id = ? AND repo_id = ?'
          )
          .run(existing.number, existing.url, featureId, r.repoId)
        results.push({
          repoId: r.repoId,
          repoName: r.repoName,
          branch: r.branch,
          status: 'existing',
          prNumber: existing.number,
          prUrl: existing.url
        })
        continue
      }

      const title = humanizeFeatureName(feature.name)
      const body = `Feature: **${feature.name}**\n\nGenerated by Trailblazer.`
      const pr = await gh.createPull(owner, r.repoName, {
        title,
        body,
        head: r.branch,
        base: r.baseBranch
      })
      getDb()
        .prepare(
          'UPDATE feature_repos SET pr_number = ?, pr_url = ? WHERE feature_id = ? AND repo_id = ?'
        )
        .run(pr.number, pr.url, featureId, r.repoId)
      results.push({
        repoId: r.repoId,
        repoName: r.repoName,
        branch: r.branch,
        status: 'opened',
        prNumber: pr.number,
        prUrl: pr.url
      })
    } catch (e) {
      results.push({
        repoId: r.repoId,
        repoName: r.repoName,
        branch: r.branch,
        status: 'skipped',
        reason: e instanceof Error ? e.message : 'unknown error'
      })
    }
  }
  return results
}

export interface FeatureRepoChanges {
  repoId: number
  repoName: string
  branch: string
  baseBranch: string
  commitsAhead: number
  hasUncommitted: boolean
  prNumber: number | null
  prUrl: string | null
  files: Array<{
    path: string
    status: 'added' | 'modified' | 'deleted' | 'renamed'
    additions: number
    deletions: number
    patch: string | null
    state: 'committed' | 'uncommitted'
  }>
}

export type ChangeScope = 'overall' | 'session'

export async function getFeatureChanges(
  featureId: number,
  opts?: { scope?: ChangeScope; sessionId?: number }
): Promise<FeatureRepoChanges[]> {
  const repos = listFeatureRepos(featureId)
  const scope = opts?.scope ?? 'overall'
  const baselines =
    scope === 'session' && opts?.sessionId ? getSessionBaselines(opts.sessionId) : new Map<number, string>()

  return Promise.all(
    repos.map(async (r) => {
      const git = simpleGit(r.worktreePath)
      const files: FeatureRepoChanges['files'] = []
      let commitsAhead = 0
      let hasUncommitted = false

      try {
        await git.fetch('origin', r.baseBranch).catch(() => {})
      } catch {
        // offline ok
      }

      // Choose the diff base: for session scope, use the snapshot taken when the session
      // was created; otherwise compare against the branch's tracking base on origin.
      const sessionBase = baselines.get(r.repoId)
      const base = scope === 'session' && sessionBase ? sessionBase : `origin/${r.baseBranch}`
      const range = `${base}...HEAD`

      try {
        const summary = await git.diffSummary([range]).catch(() => null)
        if (summary) {
          for (const f of summary.files) {
            const isBinary = 'binary' in f && (f as { binary: boolean }).binary
            const patch = await git.diff([range, '--', f.file]).catch(() => null)
            files.push({
              path: f.file,
              status: 'modified',
              additions: isBinary ? 0 : (f as { insertions: number }).insertions ?? 0,
              deletions: isBinary ? 0 : (f as { deletions: number }).deletions ?? 0,
              patch: patch || null,
              state: 'committed'
            })
          }
        }
        const log = await git.log({ from: base, to: 'HEAD' }).catch(() => null)
        commitsAhead = log?.total ?? 0

        const status = await git.status()
        hasUncommitted = !status.isClean()
        if (hasUncommitted) {
          for (const f of status.files) {
            const idx = f.index ?? ' '
            const wd = f.working_dir ?? ' '
            const isUntracked = idx === '?' || wd === '?'
            // Staged-add (codex often `git add`s after apply_patch) appears as 'A '.
            const isAdded = isUntracked || idx === 'A' || wd === 'A'
            const isDeleted = !isAdded && (idx === 'D' || wd === 'D')
            const isRenamed = !isAdded && (idx === 'R' || wd === 'R')
            const fileStatus: 'added' | 'modified' | 'deleted' | 'renamed' = isAdded
              ? 'added'
              : isDeleted
                ? 'deleted'
                : isRenamed
                  ? 'renamed'
                  : 'modified'

            let additions = 0
            let deletions = 0
            let patch: string | null = null

            if (isAdded) {
              // Read the working-copy contents and count lines as additions; synthesize a
              // unified diff against /dev/null for the diff viewer.
              try {
                const full = path.join(r.worktreePath, f.path)
                const content = await fs.promises.readFile(full, 'utf8')
                const trailing = content.endsWith('\n') ? 1 : 0
                additions =
                  content.length === 0 ? 0 : Math.max(0, content.split('\n').length - trailing)
                patch = await git
                  .raw(['diff', '--no-index', '--', '/dev/null', f.path])
                  .catch((e: { stdout?: string }) => e?.stdout ?? null)
              } catch {
                // unreadable / binary — leave counts at 0
              }
            } else if (isDeleted) {
              // Pull the file from HEAD to count lines as deletions.
              try {
                const before = await git.show([`HEAD:${f.path}`])
                const trailing = before.endsWith('\n') ? 1 : 0
                deletions =
                  before.length === 0 ? 0 : Math.max(0, before.split('\n').length - trailing)
              } catch {
                // ignore
              }
              patch = await git.diff(['HEAD', '--', f.path]).catch(() => null)
            } else {
              // Tracked modification — combine staged + unstaged via numstat.
              const numstat = await git
                .raw(['diff', '--numstat', 'HEAD', '--', f.path])
                .catch(() => '')
              const parts = numstat.trim().split(/\s+/)
              if (parts.length >= 2) {
                const a = parseInt(parts[0], 10)
                const d = parseInt(parts[1], 10)
                additions = Number.isFinite(a) ? a : 0
                deletions = Number.isFinite(d) ? d : 0
              }
              patch = await git.diff(['HEAD', '--', f.path]).catch(() => null)
            }

            files.push({
              path: f.path,
              status: fileStatus,
              additions,
              deletions,
              patch: patch || null,
              state: 'uncommitted'
            })
          }
        }
      } catch {
        // best-effort
      }

      return {
        repoId: r.repoId,
        repoName: r.repoName,
        branch: r.branch,
        baseBranch: r.baseBranch,
        commitsAhead,
        hasUncommitted,
        prNumber: r.prNumber,
        prUrl: r.prUrl,
        files
      }
    })
  )
}

async function getOwnerFromRepoId(repoId: number): Promise<string> {
  const r = getDb()
    .prepare('SELECT owner FROM repos WHERE id = ?')
    .get(repoId) as { owner: string } | undefined
  if (!r) throw new Error('repo not found')
  return r.owner
}

async function octokitListPR(
  owner: string,
  repo: string,
  branch: string
): Promise<{ number: number; url: string } | null> {
  try {
    const list = await gh.listPulls(owner, repo, 1)
    const match = list.items.find((p) => p.headBranch === branch)
    if (match) return { number: match.number, url: match.url }
    return null
  } catch {
    return null
  }
}

function humanizeFeatureName(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
