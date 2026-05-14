import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../components/ui'
import { useApp } from '../stores/app'
import { applyActivity } from '../components/ActivityList'
import ChatActivityStream from '../components/ChatActivityStream'
import { filesFromClipboard, filesFromDrop, filesToPromptAttachments } from '../lib/chatAttachments'
import PRResultsModal from '../components/PRResultsModal'
import FeatureSwitcher, { useFeatureSwitcherCollapsed } from '../components/FeatureSwitcher'
import FeatureChangesPanel from '../components/FeatureChangesPanel'
import { cn } from '../lib/cn'
import { Paperclip, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { defaultModelFor, mergedModels } from '@shared/models'
import type {
  AgentActivity,
  Engine,
  Feature,
  FeatureMessage,
  FeatureRepo,
  FeatureSession,
  PlanPromptAttachment,
  PRCreateResult,
  Project,
  Repo
} from '@shared/types'

type RepoSummary = {
  repoId: number
  repoName: string
  branch: string
  commitsAdded: number
  filesChanged: number
  hasUncommitted: boolean
}

export default function FeatureChatView({
  projectId,
  featureId,
  sessionId,
  initialDraft
}: {
  projectId: number
  featureId: number
  sessionId?: number
  initialDraft?: string
}) {
  const setView = useApp((s) => s.setView)
  const qc = useQueryClient()
  const [draft, setDraft] = useState(initialDraft ?? '')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<PlanPromptAttachment[]>([])
  const [queuedTurn, setQueuedTurn] = useState<{
    prompt: string
    attachments: PlanPromptAttachment[]
  } | null>(null)
  const [running, setRunning] = useState(false)
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [running])
  const [liveActivities, setLiveActivities] = useState<AgentActivity[]>([])
  const liveAssistantText = useMemo(
    () =>
      liveActivities
        .filter((a) => a.kind === 'message' && a.label.trim())
        .map((a) => a.label.trim())
        .join('\n\n'),
    [liveActivities]
  )
  const visibleLiveActivities = useMemo(
    () => liveActivities.filter((a) => a.kind !== 'message' && a.kind !== 'final'),
    [liveActivities]
  )
  const [perRepoSummary, setPerRepoSummary] = useState<RepoSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [prResults, setPrResults] = useState<PRCreateResult[] | null>(null)
  const [creatingPRs, setCreatingPRs] = useState(false)

  useEffect(() => {
    if (initialDraft) setDraft(initialDraft)
  }, [featureId, initialDraft, sessionId])

  const { data: feature } = useQuery<Feature | null>({
    queryKey: ['feature', featureId],
    queryFn: () => window.api.features.get(featureId)
  })
  const { data: featureRepos = [] } = useQuery<FeatureRepo[]>({
    queryKey: ['feature-repos', featureId],
    queryFn: () => window.api.features.listRepos(featureId)
  })
  // Sessions: pick the active session — explicit > most-recent > auto-create.
  const { data: sessions = [] } = useQuery<FeatureSession[]>({
    queryKey: ['feature-sessions', featureId],
    queryFn: () => window.api.features.listSessions(featureId)
  })
  const resolvedSessionId =
    sessionId && sessions.some((s) => s.id === sessionId)
      ? sessionId
      : sessions[0]?.id


  const { data: messages = [] } = useQuery<FeatureMessage[]>({
    queryKey: ['feature-messages', resolvedSessionId],
    queryFn: () =>
      resolvedSessionId
        ? window.api.features.listMessages(resolvedSessionId)
        : Promise.resolve([]),
    enabled: !!resolvedSessionId
  })
  const { data: projectRepos = [] } = useQuery<Repo[]>({
    queryKey: ['repos', projectId],
    queryFn: () => window.api.projects.listRepos(projectId)
  })
  const { data: activeFeatureIds = [] } = useQuery<number[]>({
    queryKey: ['active-features', projectId],
    queryFn: () => window.api.features.listActive(projectId),
    refetchInterval: 1500
  })
  const { data: activePlanIds = [] } = useQuery<number[]>({
    queryKey: ['active-plans', projectId],
    queryFn: () => window.api.plans.listActive(projectId),
    refetchInterval: 1500
  })
  const agentRunning = running || activeFeatureIds.includes(featureId)
  const activeIssueRunId = useApp((s) => s.run.runId)
  const activeIssueRunStatus = useApp((s) => s.run.status)
  const issueRunVisible =
    !!activeIssueRunId && ['pending', 'running', 'awaiting-approval'].includes(activeIssueRunStatus)

  const threadRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    function onScroll() {
      if (!el) return
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    if (stickRef.current && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [messages, liveActivities])

  // Coalesce rapid file-mutating tool completions into one Changes-panel refresh.
  const changesRefreshTimer = useRef<number | null>(null)
  function scheduleChangesRefresh() {
    if (changesRefreshTimer.current) return
    changesRefreshTimer.current = window.setTimeout(() => {
      changesRefreshTimer.current = null
      void qc.invalidateQueries({ queryKey: ['feature-changes', featureId] })
    }, 400)
  }

  useEffect(() => {
    const unsub = window.api.features.onEvent((evt) => {
      if (evt.featureId !== featureId) return
      if (evt.type === 'start') {
        setLiveActivities([])
        setPerRepoSummary(null)
        setError(null)
        setRunning(true)
        const t = Date.now()
        setRunStartedAt(t)
        setLastActivityAt(t)
        void qc.invalidateQueries({ queryKey: ['feature-messages', resolvedSessionId] })
      } else if (evt.type === 'activity') {
        setLiveActivities((prev) => applyActivity(prev, evt.activity))
        setLastActivityAt(Date.now())
        // When the agent finishes a file-mutating tool call, refresh the Changes panel
        // so the user sees edits land in real time instead of only at end-of-turn.
        const a = evt.activity
        if (
          a.kind === 'tool' &&
          a.status === 'done' &&
          (a.tool === 'Edit' ||
            a.tool === 'Write' ||
            a.tool === 'MultiEdit' ||
            a.tool === 'Bash')
        ) {
          scheduleChangesRefresh()
        }
      } else if (evt.type === 'done') {
        setPerRepoSummary(evt.perRepo)
        setRunning(false)
        void qc.invalidateQueries({ queryKey: ['feature-messages', resolvedSessionId] })
        void qc.invalidateQueries({ queryKey: ['feature-sessions', featureId] })
        void qc.invalidateQueries({ queryKey: ['feature-changes', featureId] })
      } else if (evt.type === 'error') {
        // Cancellation is a user-initiated halt, not an error worth banner-flagging.
        // The message bubble itself renders a quiet "cancelled" status.
        if (evt.message !== 'cancelled') setError(evt.message)
        setRunning(false)
        void qc.invalidateQueries({ queryKey: ['feature-messages', resolvedSessionId] })
      }
    })
    return () => unsub()
  }, [featureId, resolvedSessionId, qc])

  async function addAttachments(files: FileList | File[] | null) {
    if (!files || files.length === 0) return
    const next = await filesToPromptAttachments(files)
    if (next.errors.length > 0) setError(next.errors.join('\n'))
    if (next.attachments.length > 0) {
      setAttachments((current) => [...current, ...next.attachments])
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function send(text = draft, files = attachments) {
    const prompt = text.trim() || (files.length > 0 ? 'Review the attached files.' : '')
    if (!prompt) return
    if (agentRunning) {
      setQueuedTurn({ prompt, attachments: files })
      setDraft('')
      setAttachments([])
      return
    }
    setDraft('')
    setAttachments([])
    setError(null)
    try {
      await window.api.features.sendPrompt({
        featureId,
        sessionId: resolvedSessionId,
        prompt,
        attachments: files,
        model: model ?? undefined
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
      setRunning(false)
    }
  }

  useEffect(() => {
    if (agentRunning || !queuedTurn) return
    const next = queuedTurn
    setQueuedTurn(null)
    void send(next.prompt, next.attachments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRunning, queuedTurn])

  async function cancel() {
    await window.api.features.cancelTurn(featureId)
  }

  async function createPRs() {
    setCreatingPRs(true)
    try {
      const results = await window.api.features.createPRs(featureId)
      setPrResults(results)
      void qc.invalidateQueries({ queryKey: ['feature-repos', featureId] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to create PRs')
    } finally {
      setCreatingPRs(false)
    }
  }

  const [switcherCollapsed, setSwitcherCollapsed] = useFeatureSwitcherCollapsed()
  void perRepoSummary

  const { data: project } = useQuery<Project | null>({
    queryKey: ['project', projectId],
    queryFn: () => window.api.projects.get(projectId)
  })
  const { data: config } = useQuery({
    queryKey: ['app-config'],
    queryFn: () => window.api.config.get()
  })
  const engine: Engine | null = project?.assistantEngine ?? config?.engine ?? null
  const [model, setModelState] = useState<string | null>(null)
  useEffect(() => {
    if (!engine) return
    setModelState(project?.featureModel || defaultModelFor(engine))
  }, [engine, project?.featureModel])

  return (
    <div className="h-full flex overflow-hidden">
      <FeatureSwitcher
        projectId={projectId}
        currentFeatureId={featureId}
        currentSessionId={resolvedSessionId}
        repos={projectRepos}
        collapsed={switcherCollapsed}
        onToggle={() => setSwitcherCollapsed(!switcherCollapsed)}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b border-border flex items-center justify-between px-5 shrink-0 gap-4">
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <button
              onClick={() => setView({ kind: 'project', projectId, tab: 'features' })}
              className="text-xs text-muted hover:text-text shrink-0"
            >
              ← {feature?.name ? 'Project' : 'Back'}
            </button>
            <span className="text-muted/40 shrink-0">/</span>
            <h1 className="font-brand text-base truncate">{feature?.name ?? '…'}</h1>
            {feature?.slug && (
              <span className="text-[10px] text-muted font-mono shrink-0">
                feature/{feature.slug}
              </span>
            )}
            {sessions.find((s) => s.id === resolvedSessionId) && (
              <>
                <span className="text-muted/40 shrink-0">·</span>
                <span className="text-xs text-muted truncate">
                  {sessions.find((s) => s.id === resolvedSessionId)?.name}
                </span>
              </>
            )}
          </div>
          <div className="hidden md:flex flex-1 items-center justify-center">
            <FeatureProjectTabs
              planningWorking={activePlanIds.length > 0}
              issuesWorking={issueRunVisible}
              featuresWorking={activeFeatureIds.length > 0}
              onFeatures={() => setView({ kind: 'project', projectId, tab: 'features' })}
              onPlanning={() => setView({ kind: 'project', projectId, tab: 'planning' })}
              onIssues={() => setView({ kind: 'project', projectId, tab: 'issues' })}
            />
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <Button
              onClick={async () => {
                const s = await window.api.features.createSession(featureId)
                void qc.invalidateQueries({ queryKey: ['feature-sessions', featureId] })
                setView({ kind: 'feature', projectId, featureId, sessionId: s.id })
              }}
            >
              + New session
            </Button>
            <Button variant="primary" disabled={creatingPRs} onClick={createPRs}>
              {creatingPRs ? 'Opening PRs…' : 'Create PRs'}
            </Button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-hidden flex">
       <div className="flex-1 min-w-0 flex flex-col">
        <div ref={threadRef} className="flex-1 overflow-auto px-8 py-6 space-y-5">
          {messages.length === 0 && !agentRunning && (
            <div className="max-w-2xl mx-auto text-center text-sm text-muted py-12">
              Start by describing what you want this feature to do. The agent will work across the
              feature branches in {featureRepos.map((r) => r.repoName).join(', ')}.
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {agentRunning && liveAssistantText && (
            <div className="max-w-3xl mx-auto">
              <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Agent</div>
              <div className="rounded-lg border border-border bg-bg/40 px-4 py-3">
                <article className="tb-prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveAssistantText}</ReactMarkdown>
                </article>
              </div>
            </div>
          )}
          {agentRunning && (
            <div className="max-w-3xl mx-auto">
              <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted">
                <span>Working…</span>
                {runStartedAt && (
                  <span className="font-mono tracking-normal normal-case text-muted/70">
                    {formatElapsed(now - runStartedAt)}
                  </span>
                )}
                {lastActivityAt && now - lastActivityAt > 30_000 && (
                  <span className="flex items-center gap-1 text-amber-400 normal-case">
                    <span className="tb-pulse inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
                    no events for {formatElapsed(now - lastActivityAt)} · agent likely reasoning
                  </span>
                )}
              </div>
              <ChatActivityStream
                items={visibleLiveActivities}
                busy
                emptyLabel={
                  runStartedAt && now - runStartedAt > 5000
                    ? 'Agent is thinking — no events yet…'
                    : 'Spinning up agent…'
                }
              />
            </div>
          )}
          {error && <div className="max-w-3xl mx-auto text-red-400 text-xs">{error}</div>}
        </div>

        <div className="border-t border-border p-3">
          <div className="max-w-3xl mx-auto">
            <div
              className="rounded-lg border border-border bg-panel focus-within:border-accent transition-colors"
              onDrop={(e) => {
                e.preventDefault()
                void addAttachments(filesFromDrop(e))
              }}
              onDragOver={(e) => e.preventDefault()}
            >
              {(attachments.length > 0 || queuedTurn) && (
                <div className="flex flex-wrap gap-1.5 border-b border-border/60 px-3 py-2">
                  {attachments.map((file, index) => (
                    <span
                      key={`${file.name}-${index}`}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-[10px] text-muted"
                    >
                      <Paperclip size={11} className="shrink-0" />
                      <span className="truncate max-w-[220px]">{file.name}</span>
                      <button
                        onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                        title="Remove attachment"
                        aria-label="Remove attachment"
                        className="no-drag text-muted hover:text-text"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  {queuedTurn && (
                    <span className="rounded-md border border-accent/40 bg-[#1a1414] px-2 py-1 text-[10px] text-accent">
                      1 queued message
                    </span>
                  )}
                </div>
              )}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={(e) => {
                  const files = filesFromClipboard(e)
                  if (files.length > 0) void addAttachments(files)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder={
                  agentRunning
                    ? 'Queue the next instruction while the agent works...  ⌘↵ to queue'
                    : 'Tell the agent what to build…  ⌘↵ to send'
                }
                rows={3}
                className="no-drag w-full bg-transparent text-sm outline-none resize-none p-3 placeholder:text-muted font-mono leading-relaxed"
              />
              <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border/60">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {engine && (
                    <ChatModelPicker
                      engine={engine}
                      value={model}
                      disabled={agentRunning}
                      onChange={(v) => setModelState(v)}
                    />
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => void addAttachments(e.target.files)}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach files"
                    aria-label="Attach files"
                    className="no-drag h-7 w-7 rounded-md border border-border bg-bg text-muted hover:text-text flex items-center justify-center"
                  >
                    <Paperclip size={13} />
                  </button>
                  <div className="text-[11px] text-muted truncate">
                    {agentRunning ? 'Agent working — next message will queue.' : 'Sessions preserve prior turns.'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {agentRunning ? (
                    <>
                      <Button disabled={!draft.trim() && attachments.length === 0} onClick={() => send()}>
                        Queue
                      </Button>
                      <Button variant="danger" onClick={cancel}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button variant="primary" disabled={!draft.trim() && attachments.length === 0} onClick={() => send()}>
                      Send ⌘↵
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
       </div>
       <aside className="w-[360px] border-l border-border shrink-0 hidden lg:flex flex-col">
         <FeatureChangesPanel featureId={featureId} sessionId={resolvedSessionId} />
       </aside>
      </div>
      </div>

      {prResults && <PRResultsModal results={prResults} onClose={() => setPrResults(null)} />}
    </div>
  )
}

function ChatModelPicker({
  engine,
  value,
  disabled,
  onChange
}: {
  engine: Engine
  value: string | null
  disabled: boolean
  onChange: (v: string) => void
}) {
  const [discovered, setDiscovered] = useState<Array<{ id: string; label?: string }> | null>(null)
  useEffect(() => {
    window.api.config.cachedDiscoveredModels(engine).then(setDiscovered)
  }, [engine])
  const models = mergedModels(engine, discovered)
  const isCustom = !!value && !models.some((m) => m.id === value)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(isCustom ? value! : '')

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              onChange(draft.trim())
              setEditing(false)
            } else if (e.key === 'Escape') {
              setEditing(false)
            }
          }}
          placeholder="model id"
          className="no-drag rounded bg-bg border border-border px-2 py-1 text-[11px] font-mono outline-none focus:border-accent w-40"
        />
      </div>
    )
  }

  return (
    <select
      value={isCustom ? '__custom__' : value ?? ''}
      disabled={disabled || !value}
      onChange={(e) => {
        if (e.target.value === '__custom__') {
          setDraft(isCustom ? value! : '')
          setEditing(true)
          return
        }
        onChange(e.target.value)
      }}
      className="no-drag rounded bg-bg border border-border px-2 py-1 text-[11px] text-muted hover:text-text outline-none disabled:opacity-50"
      title={`Model (${engine})`}
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
      {isCustom && (
        <option value="__custom__">{value} (custom)</option>
      )}
      {!isCustom && <option value="__custom__">Custom…</option>}
    </select>
  )
}

function FeatureProjectTabs({
  featuresWorking,
  planningWorking,
  issuesWorking,
  onFeatures,
  onPlanning,
  onIssues
}: {
  featuresWorking: boolean
  planningWorking: boolean
  issuesWorking: boolean
  onFeatures: () => void
  onPlanning: () => void
  onIssues: () => void
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-panel/40 p-1 shadow-inner shadow-black/10">
      <FeatureProjectTab active working={featuresWorking} onClick={onFeatures}>
        Features
      </FeatureProjectTab>
      <FeatureProjectTab working={planningWorking} onClick={onPlanning}>
        Planning
      </FeatureProjectTab>
      <FeatureProjectTab working={issuesWorking} onClick={onIssues}>
        Issues
      </FeatureProjectTab>
    </div>
  )
}

function FeatureProjectTab({
  active,
  working,
  onClick,
  children
}: {
  active?: boolean
  working?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative h-8 px-5 text-sm font-medium rounded-full transition-all min-w-[112px]',
        active
          ? 'bg-[#24201d] text-text shadow-sm shadow-black/20 ring-1 ring-white/5'
          : 'text-muted hover:text-text hover:bg-white/[0.03]'
      )}
    >
      {working && (
        <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-300 tb-pulse align-middle" />
      )}
      {children}
    </button>
  )
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}m ${r.toString().padStart(2, '0')}s`
}

function MessageBubble({ message }: { message: FeatureMessage }) {
  if (message.role === 'user') {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1">You</div>
        <div className="rounded-lg border border-border bg-panel/60 px-4 py-3 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }
  // Filter out 'message' activities — the assistant text is already rendered as the bubble below.
  // Also drop 'final' Done rows since the content bubble itself represents completion.
  const visibleActivities =
    message.activities?.filter((a) => a.kind !== 'message' && a.kind !== 'final') ?? []
  const isCancelled = message.content === '[cancelled]'
  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Agent</div>
      {visibleActivities.length > 0 && (
        <div className="mb-2">
          <ChatActivityStream
            items={visibleActivities}
            busy={false}
            emptyLabel="No activity recorded"
          />
        </div>
      )}
      {isCancelled ? (
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-border bg-bg/50 text-[11px] text-muted">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          Turn cancelled
        </div>
      ) : message.content ? (
        <div className="rounded-lg border border-border bg-bg/40 px-4 py-3">
          <article className="tb-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </article>
        </div>
      ) : null}
    </div>
  )
}
