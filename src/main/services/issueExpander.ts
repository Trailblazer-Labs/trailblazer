import fs from 'node:fs'
import simpleGit from 'simple-git'
import { EventEmitter } from 'node:events'
import { getDb } from './db'
import { getEngine, spawnAgent } from './engine'
import { createParser } from './agentParser'
import { getModel } from './modelPrefs'
import { AGENT_INSTRUCTIONS_FILE_PROMPT } from './agentInstructions'
import type { ExpandEvent } from '@shared/types'

export const expandBus = new EventEmitter()
function emit(e: ExpandEvent) {
  expandBus.emit('event', e)
}

export interface ExpandedIssue {
  title: string
  body: string
}

export async function expandIssue(args: {
  brief: string
  repoId: number
}): Promise<ExpandedIssue> {
  const repo = getDb()
    .prepare('SELECT owner, name, local_path FROM repos WHERE id = ?')
    .get(args.repoId) as { owner: string; name: string; local_path: string } | undefined
  if (!repo) throw new Error('repo not found')

  const engine = getEngine()
  if (!engine) throw new Error('No engine configured — pick one in Settings')

  const cwd = fs.existsSync(repo.local_path) ? repo.local_path : process.cwd()

  // Refresh remote refs so the agent grounds the issue in the latest code on origin.
  // Best-effort — offline / auth hiccups shouldn't block the expansion.
  try {
    await simpleGit(cwd).fetch(['--all', '--prune'])
  } catch {
    // ignore
  }

  const prompt = buildPrompt({
    brief: args.brief,
    repoOwner: repo.owner,
    repoName: repo.name
  })

  emit({ type: 'start', engine })
  const parser = createParser(engine)

  const model = getModel('issueExpand', engine)
  const { done, getStdout, getStderr } = spawnAgent(
    engine,
    prompt,
    'read',
    cwd,
    (stream, chunk) => {
      emit({ type: 'chunk', stream, chunk })
      for (const a of parser.feed(stream, chunk)) emit({ type: 'activity', activity: a })
    },
    { model }
  )
  const code = await done
  const stdout = getStdout()
  const stderr = getStderr()

  if (code !== 0) {
    // eslint-disable-next-line no-console
    console.error(`[${engine}] full stderr:\n${stderr}\n[${engine}] full stdout:\n${stdout}`)
    const combined = (stderr.trim() || stdout.trim()).split('\n')
    const firstErr =
      combined.find((l) => /^(error|Error)[:\s]/.test(l)) ??
      combined.find((l) => l.trim().length > 0) ??
      ''
    const msg = `${engine} exited with code ${code}: ${firstErr.trim()}`
    emit({ type: 'error', message: msg })
    throw new Error(msg)
  }

  const text = engine === 'claude' ? extractClaudeResultText(stdout) : extractCodexResultText(stdout)
  const parsed = extractTitleBody(text)
  if (!parsed.title) {
    const msg = 'Could not parse expanded issue from agent output'
    emit({ type: 'error', message: msg })
    throw new Error(msg)
  }
  emit({ type: 'done' })
  return parsed
}

function buildPrompt({
  brief,
  repoOwner,
  repoName
}: {
  brief: string
  repoOwner: string
  repoName: string
}): string {
  return [
    `You are authoring a high-quality GitHub issue for the repository ${repoOwner}/${repoName}.`,
    'You are running inside the cloned repository — use Read, Grep, and Glob to ground the issue in the actual codebase.',
    AGENT_INSTRUCTIONS_FILE_PROMPT,
    '',
    'Process:',
    '1. Read README/CONTRIBUTING/package.json (or equivalent) for project context.',
    '2. Locate files, functions, or modules that the brief implicates. Reference them by path.',
    '3. Only then write the issue.',
    '',
    'Return ONLY a single JSON object, no prose, no markdown fences:',
    '{"title": "<concise imperative title, under 80 chars>", "body": "<markdown body>"}',
    '',
    'The body should include, where applicable:',
    '- A short summary tying the issue to specific files/functions you found',
    '- Steps to reproduce or current behavior (for bugs)',
    '- Expected behavior or proposed approach (link or cite real paths like `src/foo.ts:42`)',
    '- Acceptance criteria',
    '- Open questions you could not resolve from the codebase',
    '',
    'Rules:',
    '- Cite real paths only — never invent files.',
    '- If the brief is too vague to ground in code, say so in "Open questions" rather than fabricating detail.',
    '- Do not modify any files.',
    '',
    'Brief description from the user:',
    brief
  ].join('\n')
}

function extractClaudeResultText(stdout: string): string {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error('claude produced no output')
  // stream-json mode: one JSON event per line; the final event has type=result, result=<text>.
  for (const line of trimmed.split('\n').reverse()) {
    const s = line.trim()
    if (!s.startsWith('{')) continue
    try {
      const ev = JSON.parse(s)
      if (ev?.type === 'result' && typeof ev.result === 'string') return ev.result
      // fall back: any "result" field at top level
      if (typeof ev?.result === 'string') return ev.result
    } catch {
      // ignore
    }
  }
  // Old plain-text mode fallback.
  return trimmed
}

function extractCodexResultText(stdout: string): string {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error('codex produced no output')
  // codex exec --json emits JSONL events. The final agent message is what we want; in
  // recent versions it arrives wrapped in `item.completed.item` with item_type/type
  // === 'agent_message'. We walk all events and keep the LATEST message text — older
  // intermediate narration is overwritten by the final structured response.
  let lastAgentMessage = ''
  let lastFinal = ''
  for (const line of trimmed.split('\n')) {
    const s = line.trim()
    if (!s.startsWith('{')) continue
    try {
      const ev = JSON.parse(s)
      const msg = ev?.msg ?? ev
      const t = msg?.type

      if (t === 'agent_message' && typeof msg.message === 'string') {
        lastAgentMessage = msg.message
      } else if (t === 'agent_message_delta' && typeof msg.delta === 'string') {
        lastAgentMessage += msg.delta
      } else if (t === 'task_complete' && typeof msg.last_agent_message === 'string') {
        lastFinal = msg.last_agent_message
      } else if (
        (t === 'item.completed' || t === 'item.finished') &&
        msg.item &&
        (msg.item.item_type === 'agent_message' ||
          msg.item.item_type === 'assistant_message' ||
          msg.item.item_type === 'message' ||
          msg.item.type === 'agent_message' ||
          msg.item.type === 'assistant_message' ||
          msg.item.type === 'message')
      ) {
        const text: string =
          (msg.item.text as string) ??
          (msg.item.message as string) ??
          (typeof msg.item.content === 'string'
            ? (msg.item.content as string)
            : Array.isArray(msg.item.content)
              ? (msg.item.content as Array<{ text?: string }>)
                  .map((c) => c?.text ?? '')
                  .join('')
              : '')
        if (text && text.trim()) lastAgentMessage = text
      }
    } catch {
      // ignore non-JSON line
    }
  }
  return lastFinal || lastAgentMessage || trimmed
}

function extractTitleBody(text: string): ExpandedIssue {
  const cleaned = stripCodeFence(text.trim())
  // Try to extract the first JSON object in the string.
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start !== -1 && end > start) {
    const slice = cleaned.slice(start, end + 1)
    try {
      const obj = JSON.parse(slice)
      if (typeof obj?.title === 'string' && typeof obj?.body === 'string') {
        return { title: obj.title.trim(), body: obj.body.trim() }
      }
    } catch {
      // fall through
    }
  }
  // Fallback: first line is title, rest is body.
  const lines = cleaned.split('\n')
  const title = (lines.shift() ?? '').replace(/^#+\s*/, '').trim()
  return { title, body: lines.join('\n').trim() }
}

function stripCodeFence(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
}
