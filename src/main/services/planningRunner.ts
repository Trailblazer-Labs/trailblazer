import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getDb } from './db'
import { getEngine, spawnAgent } from './engine'
import { getModel } from './modelPrefs'
import { createParser } from './agentParser'
import type {
  AgentActivity,
  Engine,
  PlanMessage,
  PlanPromptAttachment,
  PlanRunEvent
} from '@shared/types'

type PreparedAttachment = PlanPromptAttachment & {
  relativePath: string
  inlineContent: string | null
  truncatedChars: number
}

export const planBus = new EventEmitter()

const inFlight = new Map<
  number,
  {
    cancelled?: boolean
    proc?: ReturnType<typeof spawnAgent>['proc']
  }
>()

function emit(evt: PlanRunEvent) {
  planBus.emit('event', evt)
}

export function listMessages(planId: number): PlanMessage[] {
  const rows = getDb()
    .prepare(
      `SELECT id, plan_id, role, content, activities, ts
         FROM plan_messages
        WHERE plan_id = ?
        ORDER BY id ASC`
    )
    .all(planId) as {
    id: number
    plan_id: number
    role: 'user' | 'assistant' | 'system'
    content: string
    activities: string | null
    ts: string
  }[]
  return rows.map((row) => ({
    id: row.id,
    planId: row.plan_id,
    role: row.role,
    content: row.content,
    activities: row.activities ? (JSON.parse(row.activities) as AgentActivity[]) : null,
    ts: row.ts
  }))
}

function insertMessage(
  planId: number,
  role: 'user' | 'assistant' | 'system',
  content: string,
  activities?: AgentActivity[] | null
): number {
  const r = getDb()
    .prepare(
      `INSERT INTO plan_messages(plan_id, role, content, activities) VALUES(?,?,?,?)`
    )
    .run(planId, role, content, activities ? JSON.stringify(activities) : null)
  return Number(r.lastInsertRowid)
}

function updateAssistantMessage(id: number, content: string, activities: AgentActivity[]) {
  getDb()
    .prepare(`UPDATE plan_messages SET content = ?, activities = ? WHERE id = ?`)
    .run(content, JSON.stringify(activities), id)
}

export function cancelRun(planId: number) {
  const ctx = inFlight.get(planId)
  if (!ctx) return
  ctx.cancelled = true
  if (ctx.proc && !ctx.proc.killed) ctx.proc.kill('SIGTERM')
}

export async function sendPrompt(args: {
  planId: number
  prompt: string
  planTitle: string
  planContent: string
  attachments?: PlanPromptAttachment[]
  model?: string
}): Promise<{ assistantMessageId: number }> {
  if (inFlight.has(args.planId)) throw new Error('a planning turn is already in flight')
  const engine = getEngine()
  if (!engine) throw new Error('No engine configured — pick one in Settings')

  const plan = getPlanContext(args.planId)
  if (!plan) throw new Error('plan not found')

  const prompt = args.prompt.trim()
  if (!prompt) throw new Error('prompt cannot be empty')

  const attachments = sanitizeAttachments(args.attachments ?? [])
  const previousMessages = listMessages(args.planId).slice(-10)
  const attachmentSummary = attachmentMessageSummary(attachments)
  const userMessageId = insertMessage(
    args.planId,
    'user',
    attachmentSummary ? `${prompt}\n\n${attachmentSummary}` : prompt
  )
  const assistantMessageId = insertMessage(args.planId, 'assistant', '', [])
  const activities: AgentActivity[] = []
  const parser = createParser(engine)
  const cwd = prepareProjectContextWorkspace(plan.projectId)
  const preparedAttachments = writeAttachments(cwd, attachments)
  const agentPrompt = buildPrompt({
    userPrompt: prompt,
    projectId: plan.projectId,
    planId: args.planId,
    planTitle: args.planTitle,
    planContent: args.planContent,
    attachments: preparedAttachments,
    previousMessages
  })

  emit({ type: 'start', planId: args.planId, engine, userMessageId })
  inFlight.set(args.planId, {})

  const model = args.model || getModel('feature', engine)
  const { proc, done, getStdout, getStderr } = spawnAgent(
    engine,
    agentPrompt,
    'read',
    cwd,
    (stream, chunk) => {
      for (const activity of parser.feed(stream, chunk)) {
        activities.push(activity)
        emit({ type: 'activity', planId: args.planId, activity })
      }
    },
    { model }
  )
  inFlight.get(args.planId)!.proc = proc

  const code = await done
  const ctx = inFlight.get(args.planId)
  inFlight.delete(args.planId)

  if (ctx?.cancelled) {
    updateAssistantMessage(assistantMessageId, '[cancelled]', activities)
    emit({ type: 'error', planId: args.planId, message: 'cancelled' })
    return { assistantMessageId }
  }

  if (code !== 0) {
    const stderr = getStderr()
    const stdout = getStdout()
    // eslint-disable-next-line no-console
    console.error(`[planning ${args.planId}] ${engine} stderr:`, stderr)
    // eslint-disable-next-line no-console
    console.error(`[planning ${args.planId}] ${engine} stdout:`, stdout)
    const tail = (stderr || stdout).trim().split('\n').find((l) => /^(error|Error)/.test(l)) ?? ''
    const msg = `${engine} exited with code ${code}${tail ? `: ${tail}` : ''}`
    updateAssistantMessage(assistantMessageId, msg, activities)
    emit({ type: 'error', planId: args.planId, message: msg })
    return { assistantMessageId }
  }

  const finalText = extractFinalText(engine, getStdout(), activities)
  updateAssistantMessage(assistantMessageId, finalText, activities)
  emit({ type: 'done', planId: args.planId, assistantMessageId })
  return { assistantMessageId }
}

function getPlanContext(planId: number): { projectId: number } | null {
  const row = getDb()
    .prepare('SELECT project_id FROM plans WHERE id = ?')
    .get(planId) as { project_id: number } | undefined
  return row ? { projectId: row.project_id } : null
}

function prepareProjectContextWorkspace(projectId: number): string {
  const root = path.join(app.getPath('userData'), 'planning-context', String(projectId))
  const reposRoot = path.join(root, 'repos')
  fs.mkdirSync(reposRoot, { recursive: true })

  const repos = getProjectRepos(projectId)
  for (const repo of repos) {
    if (!fs.existsSync(repo.localPath)) continue
    const linkName = `${repo.owner}--${repo.name}`
    const linkPath = path.join(reposRoot, linkName)
    try {
      const existing = fs.lstatSync(linkPath)
      if (existing.isSymbolicLink()) {
        const target = fs.readlinkSync(linkPath)
        if (target === repo.localPath) continue
      }
      fs.rmSync(linkPath, { recursive: true, force: true })
    } catch {
      // missing link
    }
    try {
      fs.symlinkSync(repo.localPath, linkPath, 'dir')
    } catch {
      // Symlinks may be unavailable on some platforms; the prompt still includes paths.
    }
  }

  const readme = [
    '# Trailblazer planning context',
    '',
    'This generated workspace gives the planning agent read-only context for a project.',
    'Repositories are linked under `repos/<owner>--<repo>` when available.',
    '',
    ...repos.map((repo) => `- ${repo.owner}/${repo.name}: repos/${repo.owner}--${repo.name}`)
  ].join('\n')
  fs.writeFileSync(path.join(root, 'README.md'), readme)
  return root
}

function getProjectRepos(projectId: number): Array<{
  id: number
  owner: string
  name: string
  defaultBranch: string
  workingBranch: string | null
  localPath: string
}> {
  const rows = getDb()
    .prepare(
      `SELECT id, owner, name, default_branch, working_branch, local_path
         FROM repos
        WHERE project_id = ?
        ORDER BY id ASC`
    )
    .all(projectId) as {
    id: number
    owner: string
    name: string
    default_branch: string
    working_branch: string | null
    local_path: string
  }[]
  return rows.map((row) => ({
    id: row.id,
    owner: row.owner,
    name: row.name,
    defaultBranch: row.default_branch,
    workingBranch: row.working_branch,
    localPath: row.local_path
  }))
}

function buildPrompt({
  userPrompt,
  projectId,
  planId,
  planTitle,
  planContent,
  attachments,
  previousMessages
}: {
  userPrompt: string
  projectId: number
  planId: number
  planTitle: string
  planContent: string
  attachments: PreparedAttachment[]
  previousMessages: PlanMessage[]
}) {
  const repos = getProjectRepos(projectId)
  const project = getDb()
    .prepare('SELECT name FROM projects WHERE id = ?')
    .get(projectId) as { name: string } | undefined
  const otherPlans = getDb()
    .prepare(
      `SELECT id, title, updated_at
         FROM plans
        WHERE project_id = ? AND id != ?
        ORDER BY updated_at DESC
        LIMIT 12`
    )
    .all(projectId, planId) as { id: number; title: string; updated_at: string }[]

  return [
    'You are the planning assistant inside Trailblazer.',
    'Help the user plan software features before implementation starts.',
    'You may inspect the linked repositories for context, but you must not modify files.',
    '',
    `Current Trailblazer project: ${project?.name ?? `Project ${projectId}`}`,
    `Current plan: ${planTitle || 'Untitled plan'} (id ${planId})`,
    '',
    'Repository context:',
    ...repos.map(
      (repo) =>
        `- ${repo.owner}/${repo.name}: repos/${repo.owner}--${repo.name} (default: ${repo.defaultBranch}, working: ${repo.workingBranch || repo.defaultBranch}, local path: ${repo.localPath})`
    ),
    '',
    'Other plans in this project:',
    ...(otherPlans.length
      ? otherPlans.map((plan) => `- ${plan.title} (id ${plan.id}, updated ${plan.updated_at})`)
      : ['- None']),
    '',
    'Current plan markdown:',
    '```md',
    planContent || '',
    '```',
    '',
    'Attached files for this user request:',
    ...(attachments.length > 0 ? renderAttachments(attachments) : ['- None']),
    '',
    'Recent planning chat:',
    ...(previousMessages.length
      ? previousMessages.map((message) => `${message.role}: ${message.content}`)
      : ['No prior messages.']),
    '',
    'Response rules:',
    '- Return markdown only.',
    '- Be concrete and planning-oriented: workflows, milestones, risks, acceptance criteria, and open questions.',
    '- Cite real repository paths when you inspect code.',
    '- Do not claim you changed the plan or code; the user decides what to copy into the document.',
    '',
    'User request:',
    userPrompt
  ].join('\n')
}

function sanitizeAttachments(attachments: PlanPromptAttachment[]): PlanPromptAttachment[] {
  const maxChars = 10_000_000
  return attachments.map((file) => ({
    name: file.name.slice(0, 200),
    type: file.type.slice(0, 120),
    size: file.size,
    content: file.content.length > maxChars ? file.content.slice(0, maxChars) : file.content
  }))
}

function writeAttachments(root: string, attachments: PlanPromptAttachment[]): PreparedAttachment[] {
  if (attachments.length === 0) return []
  const dir = path.join(root, 'attachments')
  fs.mkdirSync(dir, { recursive: true })
  return attachments.map((file, index) => {
    const safeName = safeFileName(file.name) || `attachment-${index + 1}.txt`
    const relativePath = path.posix.join('attachments', `${index + 1}-${safeName}`)
    fs.writeFileSync(path.join(root, relativePath), file.content)
    const inlineLimit = 120_000
    const inlineContent =
      file.content.length <= inlineLimit ? file.content : file.content.slice(0, inlineLimit)
    return {
      ...file,
      relativePath,
      inlineContent,
      truncatedChars: Math.max(0, file.content.length - inlineContent.length)
    }
  })
}

function safeFileName(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function attachmentMessageSummary(attachments: PlanPromptAttachment[]): string {
  if (attachments.length === 0) return ''
  return `Attached files: ${attachments.map((file) => file.name).join(', ')}`
}

function renderAttachments(attachments: PreparedAttachment[]): string[] {
  return attachments.flatMap((file, index) => {
    const lines = [
      `### Attachment ${index + 1}: ${file.name}`,
      `- Available at: ${file.relativePath}`,
      `- MIME type: ${file.type || 'unknown'}`,
      `- Size: ${file.size} bytes`,
      ''
    ]
    if (file.inlineContent !== null) {
      lines.push(
        'Inline preview:',
        '```text',
        file.inlineContent,
        file.truncatedChars > 0
          ? `\n[preview truncated: ${file.truncatedChars} chars omitted; read ${file.relativePath} for the full file]`
          : '',
        '```',
        ''
      )
    }
    return lines
  })
}

function extractFinalText(engine: Engine, stdout: string, activities: AgentActivity[]): string {
  const fallback =
    [...activities].reverse().find((activity) => activity.kind === 'message')?.label ??
    [...activities].reverse().find((activity) => activity.kind === 'final' && activity.detail)
      ?.detail ??
    ''
  const trimmed = stdout.trim()
  if (!trimmed) return fallback

  if (engine === 'claude') {
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

  let latest = ''
  for (const line of trimmed.split('\n')) {
    const s = line.trim()
    if (!s.startsWith('{')) continue
    try {
      const ev = JSON.parse(s)
      const msg = ev?.msg ?? ev
      const type = msg?.type
      if (type === 'agent_message' && typeof msg.message === 'string') {
        latest = msg.message
      } else if (type === 'agent_message_delta' && typeof msg.delta === 'string') {
        latest += msg.delta
      } else if (type === 'task_complete' && typeof msg.last_agent_message === 'string') {
        latest = msg.last_agent_message
      } else if (
        (type === 'item.completed' || type === 'item.finished') &&
        msg.item &&
        (msg.item.item_type === 'message' ||
          msg.item.item_type === 'agent_message' ||
          msg.item.item_type === 'assistant_message' ||
          msg.item.type === 'message' ||
          msg.item.type === 'agent_message' ||
          msg.item.type === 'assistant_message')
      ) {
        const text =
          msg.item.text ??
          msg.item.message ??
          (typeof msg.item.content === 'string'
            ? msg.item.content
            : Array.isArray(msg.item.content)
              ? msg.item.content.map((c: { text?: string }) => c?.text ?? '').join('')
              : '')
        if (typeof text === 'string' && text.trim()) latest = text
      }
    } catch {
      // ignore non-JSON line
    }
  }
  return latest || fallback
}
