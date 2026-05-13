import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Code2, Eye, FileText, GitBranch, Lightbulb, Plus, Send, Sparkles, Square, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button, Input } from '../components/ui'
import ActivityList, { applyActivity } from '../components/ActivityList'
import { cn } from '../lib/cn'
import { useApp } from '../stores/app'
import type { AgentActivity, Engine, Plan, PlanMessage, Repo } from '@shared/types'

const promptChips = [
  'Find the gaps in this plan',
  'Suggest implementation milestones',
  'List risks and mitigations',
  'Draft acceptance criteria'
]

export default function PlanningView({ projectId, repos }: { projectId: number; repos: Repo[] }) {
  const qc = useQueryClient()
  const setView = useApp((s) => s.setView)
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

  const { data: plans = [] } = useQuery({
    queryKey: ['plans', projectId],
    queryFn: () => window.api.plans.list(projectId)
  })

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? null,
    [activePlanId, plans]
  )

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
    if (title === activePlan.title && content === activePlan.content) return

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

  async function sendAssistant(text = assistantInput) {
    const prompt = text.trim()
    if (!prompt || !activePlan || assistantRunning) return
    setAssistantInput('')
    setAssistantError(null)
    try {
      await window.api.plans.sendPrompt({
        planId: activePlan.id,
        prompt,
        planTitle: title,
        planContent: content
      })
    } catch (e) {
      setAssistantRunning(false)
      setAssistantError(e instanceof Error ? e.message : String(e))
    }
  }

  async function cancelAssistant() {
    if (!activePlan || !assistantRunning) return
    await window.api.plans.cancelPrompt(activePlan.id)
  }

  async function turnIntoFeature() {
    if (!activePlan || converting) return
    let featureName = title.trim()
    if (/^Plan \d+$/i.test(featureName) || featureName === 'Untitled plan') {
      const named = window.prompt('Name this feature', '')
      if (named === null) return
      featureName = named.trim()
    }
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
    <div className="h-full min-h-0 grid grid-cols-[260px_minmax(0,1fr)_320px] overflow-hidden bg-bg">
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
                          Edited {formatRelativeDate(plan.updatedAt)}
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
            <header className="h-14 border-b border-border px-5 flex items-center gap-3 shrink-0">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9 max-w-xl bg-transparent border-transparent px-0 text-base font-medium focus:border-transparent"
                aria-label="Plan title"
              />
              <div className="ml-auto flex items-center gap-3">
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
                <span className="text-[10px] uppercase tracking-wider text-muted">
                  {saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : 'Local'}
                </span>
                <Button
                  variant="primary"
                  className="h-8"
                  onClick={turnIntoFeature}
                  disabled={!activePlan || converting}
                >
                  <GitBranch size={14} />
                  {converting ? 'Creating...' : 'Turn plan into feature'}
                </Button>
                <button
                  onClick={() => deletePlan(activePlan)}
                  title="Delete plan"
                  aria-label="Delete plan"
                  className="no-drag w-8 h-8 rounded-md border border-border bg-panel hover:bg-red-950/40 hover:text-red-300 flex items-center justify-center text-muted transition-colors"
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
                    <article className="tb-prose max-w-4xl">
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

      <aside className="border-l border-border bg-[#111111] flex flex-col min-h-0">
        <header className="h-14 px-4 border-b border-border flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-md border border-border bg-[#1f1614] flex items-center justify-center text-accent">
            <Lightbulb size={15} />
          </div>
          <div>
            <h2 className="text-sm font-medium">Planning agent</h2>
            <div className="text-[10px] uppercase tracking-wider text-muted">
              Draft support
            </div>
          </div>
        </header>
        <div className="p-3 border-b border-border">
          <div className="grid grid-cols-2 gap-2">
            {promptChips.map((chip) => (
              <button
                key={chip}
                onClick={() => sendAssistant(chip)}
                disabled={!activePlan || assistantRunning}
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
          {messages.length === 0 && !assistantRunning && (
            <div className="rounded-lg border border-border bg-panel px-3 py-2.5 text-xs leading-5 text-muted">
              Ask for scope, milestones, risks, acceptance criteria, or repo-specific planning
              guidance. The agent can inspect all repos in this project.
            </div>
          )}
          {messages.map((message) => (
            <PlanChatMessage key={message.id} message={message} />
          ))}
          {(assistantRunning || liveActivities.length > 0) && (
            <ActivityList
              items={liveActivities}
              emptyLabel="Reading project context..."
              engineLabel={assistantEngine ?? 'Agent'}
              busy={assistantRunning}
            />
          )}
          {assistantError && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2.5 text-xs leading-5 text-red-200">
              {assistantError}
            </div>
          )}
        </div>
        <footer className="p-3 border-t border-border shrink-0">
          <div className="flex items-center gap-2">
            <Input
              value={assistantInput}
              onChange={(e) => setAssistantInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendAssistant()
              }}
              placeholder="Ask about this plan..."
              className="h-9"
              disabled={!activePlan || assistantRunning}
            />
            <button
              onClick={() => {
                if (assistantRunning) void cancelAssistant()
                else void sendAssistant()
              }}
              title={assistantRunning ? 'Stop' : 'Send'}
              aria-label={assistantRunning ? 'Stop' : 'Send'}
              disabled={!activePlan}
              className="no-drag w-9 h-9 rounded-md border border-accent bg-accent text-black hover:brightness-110 flex items-center justify-center transition-colors shrink-0"
            >
              {assistantRunning ? <Square size={13} /> : <Send size={14} />}
            </button>
          </div>
        </footer>
      </aside>
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

function formatRelativeDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
