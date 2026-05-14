import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Code2,
  Eye,
  FileText,
  GitBranch,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  X
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button, Card, Input } from '../components/ui'
import { Modal } from '../components/NewIssueModal'
import ActivityList, { applyActivity } from '../components/ActivityList'
import { cn } from '../lib/cn'
import { filesFromClipboard, filesFromDrop, filesToPromptAttachments } from '../lib/chatAttachments'
import { useApp } from '../stores/app'
import type {
  AgentActivity,
  Engine,
  Plan,
  PlanMessage,
  PlanPromptAttachment,
  Repo
} from '@shared/types'

const promptChips = [
  'Find the gaps in this plan',
  'Suggest implementation milestones',
  'List risks and mitigations',
  'Draft acceptance criteria'
]

const CHAT_MIN_WIDTH = 280
const CHAT_MAX_WIDTH = 720
const CHAT_DEFAULT_WIDTH = 360

export default function PlanningView({ projectId, repos }: { projectId: number; repos: Repo[] }) {
  const qc = useQueryClient()
  const setView = useApp((s) => s.setView)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const assistantInputRef = useRef<HTMLTextAreaElement>(null)
  const [chatWidth, setChatWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return CHAT_DEFAULT_WIDTH
    const stored = Number(window.localStorage.getItem('planning.chatWidth'))
    if (Number.isFinite(stored) && stored >= CHAT_MIN_WIDTH && stored <= CHAT_MAX_WIDTH) {
      return stored
    }
    return CHAT_DEFAULT_WIDTH
  })
  const [agentShelved, setAgentShelved] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('planning.agentShelved') === 'true'
  })
  const [activePlanId, setActivePlanId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [documentMode, setDocumentMode] = useState<'edit' | 'preview'>('edit')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [assistantInput, setAssistantInput] = useState('')
  const [assistantRunning, setAssistantRunning] = useState(false)
  const [assistantEngine, setAssistantEngine] = useState<Engine | null>(null)
  const [assistantError, setAssistantError] = useState<string | null>(null)
  const [liveActivities, setLiveActivities] = useState<AgentActivity[]>([])
  const [converting, setConverting] = useState(false)
  const [featureNameDraft, setFeatureNameDraft] = useState('')
  const [showFeatureNameDialog, setShowFeatureNameDialog] = useState(false)
  const [attachments, setAttachments] = useState<PlanPromptAttachment[]>([])
  const [queuedAssistantTurn, setQueuedAssistantTurn] = useState<{
    prompt: string
    attachments: PlanPromptAttachment[]
  } | null>(null)

  const { data: plans = [] } = useQuery({
    queryKey: ['plans', projectId],
    queryFn: () => window.api.plans.list(projectId)
  })
  const { data: activePlanIds = [] } = useQuery<number[]>({
    queryKey: ['active-plans', projectId],
    queryFn: () => window.api.plans.listActive(projectId),
    refetchInterval: 1500
  })

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? null,
    [activePlanId, plans]
  )
  const activePlanRunning = activePlanId !== null && activePlanIds.includes(activePlanId)
  const assistantBusy = assistantRunning || activePlanRunning

  const { data: messages = [] } = useQuery<PlanMessage[]>({
    queryKey: ['plan-messages', activePlanId],
    enabled: activePlanId !== null,
    queryFn: () => window.api.plans.listMessages(activePlanId!)
  })

  useEffect(() => {
    if (plans.length === 0) {
      if (activePlanId !== null) setActivePlanId(null)
      return
    }
    if (activePlanId === null || !plans.some((plan) => plan.id === activePlanId)) {
      setActivePlanId(plans[0].id)
    }
  }, [activePlanId, plans])

  useEffect(() => {
    if (!activePlan) {
      setTitle('')
      setContent('')
      return
    }
    setTitle(activePlan.title)
    setContent(activePlan.content)
    setSaveState('idle')
  }, [activePlan?.id, projectId])

  useEffect(() => {
    if (!activePlan) return
    if (title === activePlan.title && content === activePlan.content) {
      setSaveState('saved')
      return
    }

    setSaveState('saving')
    const timer = window.setTimeout(async () => {
      const saved = await window.api.plans.update(activePlan.id, { title, content })
      setSaveState('saved')
      qc.setQueryData<Plan[]>(['plans', projectId], (current) =>
        current
          ? current
              .map((plan) => (plan.id === saved.id ? saved : plan))
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
          : current
      )
    }, 650)

    return () => window.clearTimeout(timer)
  }, [activePlan, content, projectId, qc, title])

  async function createPlan() {
    const plan = await window.api.plans.create(projectId, `Plan ${plans.length + 1}`)
    await qc.invalidateQueries({ queryKey: ['plans', projectId] })
    setActivePlanId(plan.id)
  }

  async function deletePlan(plan: Plan) {
    if (!confirm(`Delete plan "${plan.title}"?`)) return
    await window.api.plans.delete(plan.id)
    const remaining = plans.filter((p) => p.id !== plan.id)
    setActivePlanId(remaining[0]?.id ?? null)
    await qc.invalidateQueries({ queryKey: ['plans', projectId] })
  }

  function appendToPlan(section: string) {
    setContent((current) => `${current.trimEnd()}\n\n${section}\n`)
  }

  async function sendAssistant(text = assistantInput, files = attachments) {
    const prompt = text.trim() || (files.length > 0 ? 'Review the attached files.' : '')
    if (!prompt || !activePlan) return
    if (assistantBusy) {
      setQueuedAssistantTurn({ prompt, attachments: files })
      setAssistantInput('')
      setAttachments([])
      return
    }
    setAssistantInput('')
    setAssistantError(null)
    setAttachments([])
    try {
      await window.api.plans.sendPrompt({
        planId: activePlan.id,
        prompt,
        planTitle: title,
        planContent: content,
        attachments: files
      })
    } catch (e) {
      setAssistantRunning(false)
      setAssistantError(e instanceof Error ? e.message : String(e))
      setAttachments(files)
    }
  }

  async function addAttachments(files: FileList | File[] | null) {
    if (!files || files.length === 0) return
    const next = await filesToPromptAttachments(files)
    if (next.errors.length > 0) setAssistantError(next.errors.join('\n'))
    if (next.attachments.length > 0) {
      setAssistantError(null)
      setAttachments((current) => [...current, ...next.attachments])
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  useEffect(() => {
    if (assistantBusy || !queuedAssistantTurn) return
    const next = queuedAssistantTurn
    setQueuedAssistantTurn(null)
    void sendAssistant(next.prompt, next.attachments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantBusy, queuedAssistantTurn])

  async function cancelAssistant() {
    if (!activePlan || !assistantBusy) return
    await window.api.plans.cancelPrompt(activePlan.id)
  }

  async function turnIntoFeature() {
    if (!activePlan || converting) return
    if (activePlan.featureId) {
      setView({ kind: 'feature', projectId, featureId: activePlan.featureId })
      return
    }
    const featureName = title.trim()
    if (/^Plan \d+$/i.test(featureName) || featureName === 'Untitled plan') {
      setFeatureNameDraft(suggestFeatureName(content))
      setShowFeatureNameDialog(true)
      return
    }
    await createFeatureFromCurrentPlan(featureName)
  }

  async function createFeatureFromCurrentPlan(featureName: string) {
    if (!activePlan || converting) return
    featureName = featureName.trim()
    if (!featureName) return
    if (repos.length === 0) {
      setAssistantError('Add at least one repo to this project before creating a feature.')
      return
    }
    const previousTitle = title.trim()
    const featureContent =
      previousTitle && previousTitle !== featureName && content.startsWith(`# ${previousTitle}`)
        ? content.replace(`# ${previousTitle}`, `# ${featureName}`)
        : content
    if (previousTitle !== featureName) {
      setTitle(featureName)
      setContent(featureContent)
    }
    setConverting(true)
    setAssistantError(null)
    try {
      const result = await window.api.plans.createFeature({
        planId: activePlan.id,
        name: featureName,
        content: featureContent,
        repoIds: repos.map((repo) => repo.id)
      })
      void qc.invalidateQueries({ queryKey: ['plans', projectId] })
      void qc.invalidateQueries({ queryKey: ['features', projectId] })
      setShowFeatureNameDialog(false)
      setView({
        kind: 'feature',
        projectId,
        featureId: result.feature.id,
        sessionId: result.session.id,
        initialDraft: `Implement ${result.planFile}`
      })
    } catch (e) {
      setAssistantError(e instanceof Error ? e.message : String(e))
    } finally {
      setConverting(false)
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('planning.chatWidth', String(chatWidth))
  }, [chatWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('planning.agentShelved', String(agentShelved))
  }, [agentShelved])

  function startResizingChat(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = chatWidth
    const onMove = (ev: PointerEvent) => {
      const dx = startX - ev.clientX
      const next = Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, startWidth + dx))
      setChatWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const el = assistantInputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [assistantInput])

  useEffect(() => {
    if (activePlanId === null) return
    const unsub = window.api.plans.onEvent((evt) => {
      if (evt.planId !== activePlanId) return
      if (evt.type === 'start') {
        setAssistantRunning(true)
        setAssistantEngine(evt.engine)
        setAssistantError(null)
        setLiveActivities([])
        void qc.invalidateQueries({ queryKey: ['plan-messages', activePlanId] })
      } else if (evt.type === 'activity') {
        setLiveActivities((current) => applyActivity(current, evt.activity))
      } else if (evt.type === 'plan-updated') {
        setContent(evt.content)
        setSaveState('saved')
        qc.setQueryData<Plan[]>(['plans', projectId], (current) =>
          current
            ? current.map((plan) =>
                plan.id === evt.planId
                  ? { ...plan, content: evt.content, updatedAt: new Date().toISOString() }
                  : plan
              )
            : current
        )
      } else if (evt.type === 'done') {
        setAssistantRunning(false)
        void qc.invalidateQueries({ queryKey: ['plan-messages', activePlanId] })
      } else if (evt.type === 'error') {
        setAssistantRunning(false)
        setAssistantError(evt.message)
        void qc.invalidateQueries({ queryKey: ['plan-messages', activePlanId] })
      }
    })
    return unsub
  }, [activePlanId, qc])

  return (
    <div
      className="relative h-full min-h-0 grid overflow-hidden bg-bg"
      style={{
        gridTemplateColumns: agentShelved
          ? '260px minmax(0, 1fr)'
          : `260px minmax(0, 1fr) 6px ${chatWidth}px`
      }}
    >
      <aside className="border-r border-border bg-[#101010] flex flex-col min-h-0">
        <header className="h-14 px-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-medium">Plans</h2>
            <div className="text-[10px] uppercase tracking-wider text-muted tabular-nums">
              {plans.length} documents
            </div>
          </div>
          <button
            onClick={createPlan}
            title="New plan"
            aria-label="New plan"
            className="no-drag w-8 h-8 rounded-md border border-border bg-panel hover:bg-[#1d1d1d] flex items-center justify-center text-muted hover:text-text transition-colors"
          >
            <Plus size={15} />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {plans.length === 0 ? (
            <div className="h-full flex items-center justify-center px-5 text-center">
              <div>
                <FileText className="mx-auto mb-3 text-muted" size={28} />
                <div className="text-sm mb-1">No plans yet</div>
                <p className="text-xs text-muted mb-4">
                  Create a planning doc for feature notes, decisions, and implementation shape.
                </p>
                <Button variant="primary" onClick={createPlan}>
                  <Plus size={14} /> New plan
                </Button>
              </div>
            </div>
          ) : (
            <ul className="space-y-1">
              {plans.map((plan) => (
                <li key={plan.id}>
                  <button
                    onClick={() => setActivePlanId(plan.id)}
                    className={cn(
                      'w-full text-left rounded-md border px-3 py-2.5 transition-colors group',
                      activePlanId === plan.id
                        ? 'bg-[#1a1414] border-accent/40'
                        : 'bg-transparent border-transparent hover:bg-panel hover:border-border'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <FileText size={14} className="mt-0.5 text-muted shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">{plan.title}</div>
                        <div className="text-[10px] text-muted mt-1">
                          {activePlanIds.includes(plan.id) ? (
                            <span className="inline-flex items-center gap-1 text-amber-300">
                              <span className="tb-pulse h-1.5 w-1.5 rounded-full bg-amber-300" />
                              Working
                            </span>
                          ) : (
                            <>Edited {formatRelativeDate(plan.updatedAt)}</>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <main className="min-w-0 min-h-0 flex flex-col overflow-hidden">
        {activePlan ? (
          <>
            <header className="h-14 border-b border-border px-5 flex items-center gap-3 shrink-0 min-w-0">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9 min-w-0 flex-1 bg-transparent border-transparent px-0 text-base font-medium focus:border-transparent"
                aria-label="Plan title"
              />
              <div className="flex items-center gap-2 shrink-0">
                <div className="inline-flex p-1 rounded-md border border-border bg-bg">
                  <DocumentModeButton
                    active={documentMode === 'edit'}
                    onClick={() => setDocumentMode('edit')}
                    label="Code"
                    icon={<Code2 size={14} />}
                  />
                  <DocumentModeButton
                    active={documentMode === 'preview'}
                    onClick={() => setDocumentMode('preview')}
                    label="Render"
                    icon={<Eye size={14} />}
                  />
                </div>
                <span className="hidden lg:inline text-[10px] uppercase tracking-wider text-muted">
                  {saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : 'Local'}
                </span>
                <Button
                  variant="primary"
                  className="h-8 whitespace-nowrap"
                  onClick={turnIntoFeature}
                  disabled={!activePlan || converting}
                  title={
                    activePlan?.featureId
                      ? 'Go to linked feature'
                      : converting
                        ? 'Creating feature...'
                        : 'Turn plan into feature'
                  }
                >
                  <GitBranch size={14} />
                  <span className="hidden xl:inline">
                    {activePlan?.featureId
                      ? 'Go to feature'
                      : converting
                        ? 'Creating...'
                        : 'Turn plan into feature'}
                  </span>
                  <span className="xl:hidden">
                    {activePlan?.featureId ? 'Feature' : converting ? 'Creating' : 'To feature'}
                  </span>
                </Button>
                <button
                  onClick={() => deletePlan(activePlan)}
                  title="Delete plan"
                  aria-label="Delete plan"
                  className="no-drag w-8 h-8 rounded-md border border-border bg-panel hover:bg-red-950/40 hover:text-red-300 flex items-center justify-center text-muted transition-colors shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </header>
            <div className="flex-1 min-h-0 overflow-hidden">
              {documentMode === 'edit' ? (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  spellCheck
                  className="no-drag w-full h-full resize-none bg-[#0d0d0d] text-[#e8e8e8] outline-none px-10 py-8 text-[15px] leading-7 font-mono placeholder:text-muted selection:bg-accent/30"
                  placeholder="# Start planning..."
                  aria-label="Plan content"
                />
              ) : (
                <div className="h-full overflow-y-auto bg-[#0d0d0d] px-10 py-8">
                  {content.trim() ? (
                    <article className="tb-prose w-full max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                    </article>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-muted">
                      Nothing to render yet.
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-center px-6">
            <div>
              <Sparkles className="mx-auto mb-3 text-accent" size={30} />
              <h2 className="text-base mb-1">Start a planning document</h2>
              <p className="text-xs text-muted mb-4 max-w-sm">
                Plans are editable without AI and stay attached to this project.
              </p>
              <Button variant="primary" onClick={createPlan}>
                <Plus size={14} /> New plan
              </Button>
            </div>
          </div>
        )}
      </main>

      {!agentShelved && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat panel"
            onPointerDown={startResizingChat}
            onDoubleClick={() => setChatWidth(CHAT_DEFAULT_WIDTH)}
            className="no-drag relative h-full cursor-col-resize group"
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border" />
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1.5 bg-transparent group-hover:bg-accent/30 transition-colors" />
          </div>
          <aside className="border-l border-border bg-[#111111] flex flex-col min-h-0 min-w-0">
            <header className="h-14 px-4 border-b border-border flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h2 className="text-sm font-medium">Planning agent</h2>
                <div className="text-[10px] uppercase tracking-wider text-muted">
                  {assistantBusy ? 'Working' : 'Draft support'}
                </div>
              </div>
              <button
                onClick={() => setAgentShelved(true)}
                title="Shelve planning agent"
                aria-label="Shelve planning agent"
                className="no-drag w-8 h-8 rounded-md border border-border bg-panel text-muted hover:text-text hover:bg-[#1d1d1d] flex items-center justify-center transition-colors shrink-0"
              >
                <X size={14} />
              </button>
            </header>
        <div className="p-3 border-b border-border">
          <div className="grid grid-cols-2 gap-2">
            {promptChips.map((chip) => (
              <button
                key={chip}
                onClick={() => sendAssistant(chip)}
                disabled={!activePlan || assistantBusy}
                className="no-drag rounded-md border border-border bg-panel px-2.5 py-2 text-xs text-muted hover:text-text hover:bg-[#1d1d1d] transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            className="mt-2 w-full justify-center border border-border"
            onClick={() => appendToPlan(planningTemplate(title || 'Feature plan'))}
            disabled={!activePlan}
          >
            <Plus size={14} /> Insert template
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
          {messages.length === 0 && !assistantBusy && (
            <div className="rounded-lg border border-border bg-panel px-3 py-2.5 text-xs leading-5 text-muted">
              Ask for scope, milestones, risks, acceptance criteria, or repo-specific planning
              guidance. The agent can inspect all repos in this project.
            </div>
          )}
          {messages.map((message) => (
            <PlanChatMessage key={message.id} message={message} />
          ))}
          {(assistantBusy || liveActivities.length > 0) && (
            <ActivityList
              items={liveActivities}
              emptyLabel="Reading project context..."
              engineLabel={assistantEngine ?? 'Agent'}
              busy={assistantBusy}
            />
          )}
          {assistantError && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2.5 text-xs leading-5 text-red-200">
              {assistantError}
            </div>
          )}
        </div>
        <footer
          className="p-3 border-t border-border shrink-0"
          onDrop={(e) => {
            e.preventDefault()
            void addAttachments(filesFromDrop(e))
          }}
          onDragOver={(e) => e.preventDefault()}
        >
          {(attachments.length > 0 || queuedAssistantTurn) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((file, index) => (
                <span
                  key={`${file.name}-${index}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-2 py-1 text-[10px] text-muted max-w-full"
                >
                  <Paperclip size={11} className="shrink-0" />
                  <span className="truncate max-w-[220px]">{file.name}</span>
                  <button
                    onClick={() =>
                      setAttachments((current) => current.filter((_, i) => i !== index))
                    }
                    title="Remove attachment"
                    aria-label="Remove attachment"
                    className="no-drag text-muted hover:text-text"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              {queuedAssistantTurn && (
                <span className="inline-flex items-center rounded-md border border-accent/40 bg-[#1a1414] px-2 py-1 text-[10px] text-accent">
                  1 queued message
                </span>
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
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
              disabled={!activePlan}
              className="no-drag w-9 h-9 rounded-md border border-border bg-panel text-muted hover:text-text hover:bg-[#1d1d1d] flex items-center justify-center transition-colors shrink-0 disabled:opacity-50"
            >
              <Paperclip size={14} />
            </button>
            <textarea
              ref={assistantInputRef}
              value={assistantInput}
              onChange={(e) => setAssistantInput(e.target.value)}
              onPaste={(e) => {
                const files = filesFromClipboard(e)
                if (files.length > 0) void addAttachments(files)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  sendAssistant()
                }
              }}
              placeholder="Ask about this plan... (Shift+Enter for newline)"
              rows={1}
              disabled={!activePlan}
              className="no-drag flex-1 min-w-0 min-h-[36px] max-h-[200px] resize-none rounded-md bg-panel border border-border px-3 py-2 text-sm leading-5 outline-none focus:border-accent placeholder:text-muted disabled:opacity-60"
            />
            <button
              onClick={() => {
                void sendAssistant()
              }}
              title={assistantBusy ? 'Queue message' : 'Send'}
              aria-label={assistantBusy ? 'Queue message' : 'Send'}
              disabled={!activePlan || (!assistantInput.trim() && attachments.length === 0)}
              className="no-drag w-9 h-9 rounded-md border border-accent bg-accent text-black hover:brightness-110 flex items-center justify-center transition-colors shrink-0"
            >
              <Send size={14} />
            </button>
            {assistantBusy && (
              <button
                onClick={() => void cancelAssistant()}
                title="Stop"
                aria-label="Stop"
                disabled={!activePlan}
                className="no-drag w-9 h-9 rounded-md border border-red-900/70 bg-red-950/30 text-red-200 hover:bg-red-950/50 flex items-center justify-center transition-colors shrink-0"
              >
                <Square size={13} />
              </button>
            )}
          </div>
        </footer>
          </aside>
        </>
      )}
      {agentShelved && (
        <button
          onClick={() => setAgentShelved(false)}
          className="no-drag absolute right-4 bottom-4 z-10 inline-flex items-center gap-2 rounded-full border border-border bg-[#171717] px-3 py-2 text-xs text-muted shadow-lg hover:text-text hover:bg-[#1d1d1d] transition-colors"
          title="Show planning agent"
        >
          {assistantBusy && <span className="tb-pulse h-1.5 w-1.5 rounded-full bg-amber-300" />}
          <span>Planning agent</span>
          {assistantBusy && <span className="text-amber-300">Working</span>}
        </button>
      )}
      {showFeatureNameDialog && (
        <Modal onClose={() => !converting && setShowFeatureNameDialog(false)}>
          <Card className="w-[420px] p-4">
            <h3 className="text-sm font-medium mb-1">Name this feature</h3>
            <p className="text-xs text-muted mb-3">
              This creates feature branches for the selected project repos.
            </p>
            <Input
              autoFocus
              value={featureNameDraft}
              onChange={(e) => setFeatureNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createFeatureFromCurrentPlan(featureNameDraft)
                if (e.key === 'Escape' && !converting) setShowFeatureNameDialog(false)
              }}
              placeholder="Feature name"
              disabled={converting}
            />
            {assistantError && (
              <div className="mt-2 text-xs text-red-300">{assistantError}</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setShowFeatureNameDialog(false)} disabled={converting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={converting || !featureNameDraft.trim()}
                onClick={() => void createFeatureFromCurrentPlan(featureNameDraft)}
              >
                {converting ? 'Creating...' : 'Create feature'}
              </Button>
            </div>
          </Card>
        </Modal>
      )}
    </div>
  )
}

function PlanChatMessage({ message }: { message: PlanMessage }) {
  const isAssistant = message.role === 'assistant'
  if (!message.content.trim()) return null
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5 text-xs leading-5',
        isAssistant
          ? 'bg-panel border-border text-text'
          : 'bg-[#1a1414] border-accent/30 text-[#f0d4c8]'
      )}
    >
      {isAssistant ? (
        <article className="tb-prose text-xs">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </article>
      ) : (
        message.content
      )}
    </div>
  )
}

function DocumentModeButton({
  active,
  onClick,
  icon,
  label
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'no-drag w-7 h-7 rounded flex items-center justify-center transition-colors',
        active
          ? 'bg-panel text-text border border-border'
          : 'text-muted hover:text-text border border-transparent'
      )}
    >
      {icon}
    </button>
  )
}

function planningTemplate(title: string) {
  return `## Planning pass: ${title}

### User workflow

### Acceptance criteria
- [ ] 
- [ ] 
- [ ] 

### Risks
| Risk | Mitigation |
| --- | --- |
|  |  |

### Next decisions
- `
}

function suggestFeatureName(content: string): string {
  const heading = content
    .split('\n')
    .map((line) => line.match(/^#{1,3}\s+(.+)$/)?.[1]?.trim())
    .find((line) => line && !/^Plan \d+$/i.test(line) && line !== 'Untitled plan')
  return heading ?? ''
}

function formatRelativeDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
