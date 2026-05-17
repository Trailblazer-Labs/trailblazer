import { EventEmitter } from 'node:events'
import path from 'node:path'
import fs from 'node:fs'
import simpleGit from 'simple-git'
import { getDb } from './db'
import { spawnAgent } from './engine'
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
import { pullBranch, pushBranch, refreshRemoteUrl } from './git'
import * as gh from './github'
import { getAuthMode, ghGetToken } from './ghAuth'
import { kvGetSecret } from './db'
import { resolveProjectAgent, setProjectModel } from './projectPrefs'
import { extractAgentApiError, formatAgentExitError } from './agentErrors'
import { AGENT_INSTRUCTIONS_FILE_PROMPT } from './agentInstructions'
import type {
  AgentActivity,
  Engine,
  FeatureMessage,
  FeatureRepo,
  PlanPromptAttachment
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

export function isFeatureInFlight(featureId: number): boolean {
  return inFlight.has(featureId)
}

export function listActiveFeatureIds(projectId?: number): number[] {
  const ids = [...inFlight.keys()]
  if (typeof projectId !== 'number') return ids
  return ids.filter((featureId) => getFeature(featureId)?.projectId === projectId)
}

export async function sendPrompt(args: {
  featureId: number
  sessionId?: number
  prompt: string
  attachments?: PlanPromptAttachment[]
  model?: string
}): Promise<{ assistantMessageId: number; sessionId: number }> {
  const feature = getFeature(args.featureId)
  if (!feature) throw new Error('feature not found')
  if (inFlight.has(args.featureId)) throw new Error('a turn is already in flight for this feature')

  const { engine, model: resolvedModel } = resolveProjectAgent(
    feature.projectId,
    'feature',
    args.model
  )

  const repos = listFeatureRepos(args.featureId)
  if (repos.length === 0) throw new Error('feature has no repositories')

  // Resolve a session — caller can pin one, else fall back to the default.
  const session = args.sessionId
    ? getSession(args.sessionId) ?? ensureDefaultSession(args.featureId)
    : ensureDefaultSession(args.featureId)

  // Persist the user's message immediately.
  const userMessageId = insertMessage(args.featureId, session.id, 'user', args.prompt)
  // Resume only if this session was previously used with the same engine.
  const cliSessionId = session.engine === engine ? getSessionCli(session.id, engine) : null
  const isFirstTurn = !cliSessionId

  // On the very first turn of a session, refresh remote refs so the agent grounds its
  // first response in current `origin/<base>`. Subsequent turns reuse the existing
  // refs to keep the chat snappy. Fetch-only — never auto-merges.
  if (isFirstTurn) {
    await Promise.all(
      repos.map(async (r) => {
        try {
          await simpleGit(r.worktreePath).fetch(['--all', '--prune'])
        } catch {
          // best-effort
        }
      })
    )
  }

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
  const attachments = writeFeatureAttachments(feature.workspacePath, args.attachments ?? [])
  const userPrompt = withAttachmentInstructions(args.prompt, attachments)
  const prompt = isFirstTurn
    ? buildFirstTurnPrompt(feature.workspacePath, repos, userPrompt)
    : userPrompt

  emit({ type: 'start', featureId: args.featureId, engine, userMessageId })

  inFlight.set(args.featureId, {})
  const parser = createParser(engine)
  const collected: AgentActivity[] = []
  let observedSessionId: string | null = null

  // Pre-create assistant message row so renderer can attach activities to it.
  const assistantMessageId = insertMessage(args.featureId, session.id, 'assistant', '', [])

  const model = resolvedModel
  if (args.model) setProjectModel(feature.projectId, 'feature', args.model)
  const { proc, done, getStdout, getStderr } = spawnAgent(
    engine,
    prompt,
    'write',
    feature.workspacePath,
    (stream, chunk) => {
      if (!observedSessionId) {
        // Claude emits "session_id" in its init event; Codex emits "thread_id" in thread.started.
        // Either is the right token to pass back via --resume on the next turn.
        const m =
          chunk.match(/"session_id"\s*:\s*"([^"]+)"/) ??
          chunk.match(/"thread_id"\s*:\s*"([^"]+)"/)
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
    const msg = formatAgentExitError({ engine, code, stdout, stderr })
    updateAssistantMessage(assistantMessageId, msg, collected)
    // If session-resume failed, clear the CLI session so the next turn starts fresh.
    if (cliSessionId && /session|resume/i.test(stderr)) clearSessionCli(session.id)
    emit({ type: 'error', featureId: args.featureId, message: msg })
    return { assistantMessageId, sessionId: session.id }
  }

  // Extract the FULL assistant text from raw stdout (the parser truncates the activity
  // detail for display, so we can't rely on collected activities for storage).
  const stdout = getStdout()
  const apiError = extractAgentApiError(stdout)
  if (apiError) {
    updateAssistantMessage(assistantMessageId, apiError, collected)
    emit({ type: 'error', featureId: args.featureId, message: apiError })
    return { assistantMessageId, sessionId: session.id }
  }
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
    AGENT_INSTRUCTIONS_FILE_PROMPT,
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

type FeatureAttachment = PlanPromptAttachment & {
  relativePath: string
  inlineContent: string
  truncatedChars: number
}

function writeFeatureAttachments(
  workspacePath: string,
  attachments: PlanPromptAttachment[]
): FeatureAttachment[] {
  if (attachments.length === 0) return []
  const dir = path.join(workspacePath, '.trailblazer-attachments')
  fs.mkdirSync(dir, { recursive: true })
  return attachments.map((file, index) => {
    const safeName = safeFileName(file.name) || `attachment-${index + 1}`
    const relativePath = path.posix.join('.trailblazer-attachments', `${Date.now()}-${index + 1}-${safeName}`)
    fs.writeFileSync(path.join(workspacePath, relativePath), attachmentBytes(file))
    const inlineLimit = file.encoding === 'dataUrl' ? 0 : 120_000
    const inlineContent = inlineLimit > 0 ? file.content.slice(0, inlineLimit) : ''
    return {
      ...file,
      relativePath,
      inlineContent,
      truncatedChars: Math.max(0, file.content.length - inlineContent.length)
    }
  })
}

function withAttachmentInstructions(prompt: string, attachments: FeatureAttachment[]): string {
  if (attachments.length === 0) return prompt
  return [
    prompt,
    '',
    'Attachments provided by the user:',
    ...attachments.flatMap((file, index) => [
      `### Attachment ${index + 1}: ${file.name}`,
      `- Available at: ${file.relativePath}`,
      `- MIME type: ${file.type || 'unknown'}`,
      `- Size: ${file.size} bytes`,
      file.inlineContent
        ? `Inline preview:\n\`\`\`text\n${file.inlineContent}${file.truncatedChars > 0 ? `\n[preview truncated: ${file.truncatedChars} chars omitted; read ${file.relativePath} for the full file]` : ''}\n\`\`\``
        : '- Binary/image attachment: inspect the file path directly if needed.'
    ])
  ].join('\n')
}

function attachmentBytes(file: PlanPromptAttachment): Buffer | string {
  if (file.encoding !== 'dataUrl') return file.content
  const match = file.content.match(/^data:[^;]+;base64,(.+)$/)
  if (!match) return file.content
  return Buffer.from(match[1], 'base64')
}

function safeFileName(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

export interface FeatureCommitResult {
  repoId: number
  repoName: string
  status: 'committed' | 'clean' | 'published' | 'pulled' | 'failed'
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
  message: string,
  repoId?: number
): Promise<FeatureCommitResult[]> {
  const feature = getFeature(featureId)
  if (!feature) throw new Error('feature not found')
  const msg = message.trim() || `chore: ${feature.name} WIP`
  const repos = targetFeatureRepos(featureId, repoId)
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

export async function commitAndPublishFeatureChanges(
  featureId: number,
  message: string,
  repoId?: number
): Promise<FeatureCommitResult[]> {
  const feature = getFeature(featureId)
  if (!feature) throw new Error('feature not found')
  const msg = message.trim() || `chore: ${feature.name} WIP`
  const repos = targetFeatureRepos(featureId, repoId)
  const out: FeatureCommitResult[] = []
  for (const r of repos) {
    try {
      const git = simpleGit(r.worktreePath)
      await refreshRemoteUrl(r.worktreePath, r.repoOwner, r.repoName)
      const status = await git.status()
      let filesCommitted: number | undefined
      let sha: string | undefined
      if (!status.isClean()) {
        filesCommitted = status.files.length
        await git.add(['-A'])
        const commit = await git.commit(msg)
        sha = commit.commit
      }
      await pushBranch(r.worktreePath, r.branch)
      out.push({
        repoId: r.repoId,
        repoName: r.repoName,
        status: 'published',
        sha,
        filesCommitted
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

export async function publishFeatureBranches(featureId: number): Promise<FeatureCommitResult[]> {
  const feature = getFeature(featureId)
  if (!feature) throw new Error('feature not found')
  const repos = listFeatureRepos(featureId)
  const out: FeatureCommitResult[] = []
  for (const r of repos) {
    try {
      const git = simpleGit(r.worktreePath)
      await refreshRemoteUrl(r.worktreePath, r.repoOwner, r.repoName)
      await git.fetch('origin', r.baseBranch).catch(() => {})
      const rev = await git.raw(['rev-list', '--count', `origin/${r.baseBranch}..HEAD`])
      const aheadCount = parseInt(rev.trim(), 10) || 0
      if (aheadCount === 0) {
        out.push({ repoId: r.repoId, repoName: r.repoName, status: 'clean' })
        continue
      }
      await pushBranch(r.worktreePath, r.branch)
      out.push({ repoId: r.repoId, repoName: r.repoName, status: 'published' })
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

function targetFeatureRepos(featureId: number, repoId?: number): FeatureRepo[] {
  const repos = listFeatureRepos(featureId)
  if (typeof repoId !== 'number') return repos
  const repo = repos.find((r) => r.repoId === repoId)
  if (!repo) throw new Error('repo not found in feature')
  return [repo]
}

export async function pullFeatureBranches(featureId: number): Promise<FeatureCommitResult[]> {
  const feature = getFeature(featureId)
  if (!feature) throw new Error('feature not found')
  const repos = listFeatureRepos(featureId)
  const out: FeatureCommitResult[] = []
  for (const r of repos) {
    try {
      await refreshRemoteUrl(r.worktreePath, r.repoOwner, r.repoName)
      const status = await pullBranch(r.worktreePath, r.branch)
      out.push({ repoId: r.repoId, repoName: r.repoName, status })
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

  // If we're using gh-managed auth, re-read the token from `gh auth token` so any recent
  // `gh auth refresh` (e.g. adding workflow scope) is picked up before we push.
  if (getAuthMode() === 'gh') {
    try {
      const tok = await ghGetToken()
      if (tok) gh.setPat(tok)
    } catch {
      // best effort — fall through with stored token
    }
  }

  // Diagnose: query the token's actual server-side scopes so we can surface a clear
  // message if it's missing what the agent's changes need (e.g. `workflow`).
  const currentToken = kvGetSecret('github.pat')
  const tokenScopes = currentToken ? await fetchTokenScopes(currentToken) : []
  // eslint-disable-next-line no-console
  console.log('[create-prs] token scopes:', tokenScopes.join(', ') || '(none)')

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
      // Replace the stored remote URL with one carrying the current token. Clones embed
      // the token in .git/config at clone time, so without this the push uses whatever
      // token was valid then — even if the user has since refreshed/rotated.
      await refreshRemoteUrl(r.worktreePath, r.repoOwner, r.repoName)

      // Auto-commit any uncommitted changes so they make it into the PR.
      const status = await git.status()
      if (!status.isClean()) {
        await git.add(['-A'])
        await git.commit(`WIP: ${feature.name}`)
      }

      // Make sure origin/<baseBranch> is up to date locally — without this the
      // ahead-check below sees a stale or missing ref and reports "no commits".
      let fetchError: string | null = null
      try {
        await git.fetch('origin', r.baseBranch)
      } catch (e) {
        fetchError = e instanceof Error ? e.message : String(e)
      }

      // Count commits on the feature branch vs the base. simple-git's `log({from,to})`
      // returns a typed object but doesn't surface git errors well; use raw rev-list
      // for a precise count and clearer failure modes.
      let aheadCount = 0
      let countError: string | null = null
      try {
        const rev = await git.raw(['rev-list', '--count', `origin/${r.baseBranch}..HEAD`])
        aheadCount = parseInt(rev.trim(), 10) || 0
      } catch (e) {
        countError = e instanceof Error ? e.message : String(e)
      }

      if (aheadCount === 0) {
        // Gather extra diagnostics for the dev console — helps explain why git thought
        // the branch was empty.
        const head = await git.revparse(['HEAD']).catch(() => '?')
        const baseSha = await git.revparse([`origin/${r.baseBranch}`]).catch(() => '?')
        const branchOut = await git.branch(['--show-current']).catch(() => ({ current: '?' }))
        // eslint-disable-next-line no-console
        console.error(
          `[create-prs] ${r.repoName}: skipped — HEAD=${head} origin/${r.baseBranch}=${baseSha} branch=${
            (branchOut as { current: string }).current
          } fetchError=${fetchError ?? 'none'} countError=${countError ?? 'none'}`
        )
        const reason = countError
          ? `couldn't compare against origin/${r.baseBranch}: ${countError}`
          : fetchError
            ? `no commits ahead of origin/${r.baseBranch} (fetch: ${fetchError})`
            : `no commits ahead of origin/${r.baseBranch} (HEAD=${head.slice(0, 7)}, base=${baseSha.slice(0, 7)})`
        results.push({
          repoId: r.repoId,
          repoName: r.repoName,
          branch: r.branch,
          status: 'skipped',
          reason
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

      // Ask the configured engine to write a real title + description for the changes
      // on this branch. Falls back to a generic message if generation fails.
      const generated = await generatePRMessage({
        projectId: feature.projectId,
        worktreePath: r.worktreePath,
        baseBranch: r.baseBranch,
        featureName: feature.name,
        repoName: r.repoName
      }).catch(() => null)
      const title = generated?.title || humanizeFeatureName(feature.name)
      const body =
        generated?.body || `Feature: **${feature.name}**\n\nGenerated by Trailblazer.`
      // eslint-disable-next-line no-console
      console.log(
        `[create-prs] ${r.repoName}: PR message ${generated ? 'generated by agent' : 'using fallback'}`
      )
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
      const msg = e instanceof Error ? e.message : String(e)
      // eslint-disable-next-line no-console
      console.error(`[create-prs] ${r.repoName}: error —`, e)
      let reason = msg
      if (/workflow.*scope|refusing to allow/i.test(msg)) {
        const has = tokenScopes.length > 0
          ? `Token scopes: ${tokenScopes.join(', ')}.`
          : `Could not read token scopes from GitHub.`
        if (tokenScopes.includes('workflow')) {
          reason =
            `GitHub rejected the push.\n${has}\n\n` +
            `Your token already has workflow scope — this is an org-level restriction on the ` +
            `GitHub CLI OAuth app for this repo's org. Two fixes:\n\n` +
            `1) Switch to a Personal Access Token (PATs bypass OAuth-app restrictions):\n` +
            `   • Create at https://github.com/settings/tokens/new with 'repo' + 'workflow' scopes\n` +
            `   • Click "Configure SSO" → authorize the org\n` +
            `   • In Trailblazer Settings, clear the gh login and paste the PAT\n\n` +
            `2) Ask an org admin to approve the "GitHub CLI" OAuth app under\n` +
            `   Org settings → Third-party Access → OAuth app policy`
        } else {
          reason =
            `GitHub rejected the push: workflow scope required.\n${has}\n\n` +
            `Run: gh auth refresh -s workflow  (then click Create PRs again).`
        }
      }
      results.push({
        repoId: r.repoId,
        repoName: r.repoName,
        branch: r.branch,
        status: 'skipped',
        reason
      })
    }
  }
  return results
}

async function fetchTokenScopes(token: string): Promise<string[]> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${token}`, 'User-Agent': 'trailblazer' }
    })
    const header =
      res.headers.get('x-oauth-scopes') ??
      res.headers.get('X-OAuth-Scopes') ??
      ''
    return header
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
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
  prState?: 'open' | 'closed' | 'merged' | null
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
      let prState: FeatureRepoChanges['prState'] = null

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

      if (r.prNumber) {
        try {
          const detail = await gh.getPullDetail(r.repoOwner, r.repoName, r.prNumber)
          prState = detail.state
        } catch {
          prState = null
        }
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
        prState,
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
    // Only treat open or merged PRs as "existing" — a closed-but-not-merged PR for the
    // same branch shouldn't block opening a new one (GitHub allows it just fine).
    const match = list.items.find((p) => p.headBranch === branch && p.state !== 'closed')
    if (match) return { number: match.number, url: match.url }
    return null
  } catch {
    return null
  }
}

function humanizeFeatureName(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Spawn the configured engine in read-only mode in the worktree and ask it to summarize
 * the branch's changes as a PR title + markdown body. Returns null on any failure so the
 * caller can fall back to a generic message.
 */
async function generatePRMessage(args: {
  projectId: number
  worktreePath: string
  baseBranch: string
  featureName: string
  repoName: string
}): Promise<{ title: string; body: string } | null> {
  const { engine, model } = resolveProjectAgent(args.projectId, 'issueResolve')

  const git = simpleGit(args.worktreePath)
  // Gather commit subjects ahead of base.
  let commitLines = ''
  try {
    const log = await git.log({ from: `origin/${args.baseBranch}`, to: 'HEAD' })
    commitLines = log.all
      .slice(0, 30)
      .map((c) => `- ${c.message.split('\n')[0]}`)
      .join('\n')
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[pr-message] git log failed:', e)
  }
  // Gather file list with adds/dels.
  let filesBlock = ''
  try {
    const summary = await git.diffSummary([`origin/${args.baseBranch}...HEAD`])
    filesBlock = summary.files
      .slice(0, 60)
      .map((f) => {
        const ins = (f as { insertions?: number }).insertions ?? 0
        const dels = (f as { deletions?: number }).deletions ?? 0
        return `- ${f.file}  (+${ins} -${dels})`
      })
      .join('\n')
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[pr-message] git diffSummary failed:', e)
  }
  if (!commitLines && !filesBlock) {
    // eslint-disable-next-line no-console
    console.warn('[pr-message] skipped: no commits or files to summarize')
    return null
  }
  // eslint-disable-next-line no-console
  console.log(
    `[pr-message] generating for ${args.repoName} (${commitLines.split('\n').filter(Boolean).length} commits, ${filesBlock.split('\n').filter(Boolean).length} files) via ${engine}`
  )

  const prompt = [
    `You are writing a GitHub pull request title and description for a feature branch.`,
    ``,
    `Repository: ${args.repoName}`,
    `Feature: ${args.featureName}`,
    `Base branch: ${args.baseBranch}`,
    ``,
    AGENT_INSTRUCTIONS_FILE_PROMPT,
    ``,
    `Commits on this branch:`,
    commitLines || '(none)',
    ``,
    `Files changed:`,
    filesBlock || '(none)',
    ``,
    `Return ONLY a single-line JSON object, no prose, no code fences:`,
    `{"title": "<concise imperative title, under 80 chars>", "body": "<markdown body>"}`,
    ``,
    `The body should include:`,
    `- A short summary of what this PR does`,
    `- A bulleted list of key changes (cite real paths from the file list)`,
    `- A "Notes" section for callouts only if relevant (breaking changes, follow-ups, open questions)`,
    ``,
    `Rules:`,
    `- No invented files or scopes outside what's listed.`,
    `- Skip generic boilerplate like "this PR introduces…" — be direct.`,
    `- Do not include the engine name or "Generated by …" footers.`
  ].join('\n')

  const { done, getStdout, getStderr } = spawnAgent(
    engine,
    prompt,
    'read',
    args.worktreePath,
    undefined,
    { model }
  )
  const code = await done
  const stdout = getStdout()
  const stderr = getStderr()
  if (code !== 0) {
    // eslint-disable-next-line no-console
    console.warn(`[pr-message] ${engine} exited with code ${code}`)
    // eslint-disable-next-line no-console
    console.warn('[pr-message] stderr tail:', stderr.trim().split('\n').slice(-5).join('\n'))
    return null
  }
  const text = engine === 'claude' ? extractClaudeFinal(stdout) : extractCodexFinal(stdout)
  // eslint-disable-next-line no-console
  console.log(
    `[pr-message] raw response (${text.length} chars):`,
    text.length > 400 ? text.slice(0, 400) + '…' : text
  )
  if (!text) {
    // Dump a sample of the raw stdout so we can see which events codex actually emitted.
    const lines = stdout.trim().split('\n')
    // eslint-disable-next-line no-console
    console.warn(
      `[pr-message] empty extracted text — stdout had ${lines.length} lines. Last 8:\n` +
        lines.slice(-8).join('\n')
    )
  }
  const parsed = parseTitleBody(text)
  if (!parsed) {
    // eslint-disable-next-line no-console
    console.warn('[pr-message] could not parse {title, body} JSON from response')
  } else {
    // eslint-disable-next-line no-console
    console.log(`[pr-message] generated title: "${parsed.title}"`)
  }
  return parsed
}

function extractClaudeFinal(stdout: string): string {
  for (const line of stdout.trim().split('\n').reverse()) {
    const s = line.trim()
    if (!s.startsWith('{')) continue
    try {
      const ev = JSON.parse(s)
      if (ev?.type === 'result' && typeof ev.result === 'string') return ev.result
    } catch {
      // try next
    }
  }
  return stdout
}

function extractCodexFinal(stdout: string): string {
  let latest = ''
  for (const line of stdout.trim().split('\n')) {
    const s = line.trim()
    if (!s.startsWith('{')) continue
    try {
      const ev = JSON.parse(s)
      const msg = ev?.msg ?? ev
      const t = msg?.type
      if (t === 'agent_message' && typeof msg.message === 'string') latest = msg.message
      else if (t === 'agent_message_delta' && typeof msg.delta === 'string') latest += msg.delta
      else if (
        (t === 'item.completed' || t === 'item.finished') &&
        msg.item &&
        (msg.item.item_type === 'message' ||
          msg.item.item_type === 'agent_message' ||
          msg.item.item_type === 'assistant_message' ||
          msg.item.type === 'message' ||
          msg.item.type === 'agent_message' ||
          msg.item.type === 'assistant_message')
      ) {
        const text =
          (msg.item.text as string) ??
          (msg.item.message as string) ??
          (typeof msg.item.content === 'string'
            ? (msg.item.content as string)
            : Array.isArray(msg.item.content)
              ? (msg.item.content as Array<{ text?: string }>).map((c) => c?.text ?? '').join('')
              : '')
        if (text && text.trim()) latest = text
      } else if (t === 'task_complete' && typeof msg.last_agent_message === 'string') {
        latest = msg.last_agent_message
      }
    } catch {
      // ignore
    }
  }
  return latest
}

function parseTitleBody(text: string): { title: string; body: string } | null {
  if (!text) return null
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1))
      if (typeof obj?.title === 'string' && typeof obj?.body === 'string') {
        return { title: obj.title.trim(), body: obj.body.trim() }
      }
    } catch {
      // fall through
    }
  }
  return null
}
