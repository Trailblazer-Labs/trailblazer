import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Code2, Eye, FileText, Lightbulb, Plus, Send, Sparkles, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button, Input } from '../components/ui'
import { cn } from '../lib/cn'
import type { Plan } from '@shared/types'

type AssistantMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const promptChips = [
  'Find gaps',
  'Create milestones',
  'List risks',
  'Write acceptance criteria'
]

export default function PlanningView({ projectId }: { projectId: number }) {
  const qc = useQueryClient()
  const [activePlanId, setActivePlanId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [documentMode, setDocumentMode] = useState<'edit' | 'preview'>('edit')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [assistantInput, setAssistantInput] = useState('')
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'I can help shape this plan. Ask for scope, milestones, risks, acceptance criteria, or insert a planning template.'
    }
  ])

  const { data: plans = [] } = useQuery({
    queryKey: ['plans', projectId],
    queryFn: () => window.api.plans.list(projectId)
  })

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? null,
    [activePlanId, plans]
  )

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

  function sendAssistant(text = assistantInput) {
    const prompt = text.trim()
    if (!prompt) return
    setAssistantInput('')
    const reply = buildAssistantReply(prompt, title, content)
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', content: prompt },
      { id: crypto.randomUUID(), role: 'assistant', content: reply }
    ])
  }

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
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'rounded-lg border px-3 py-2.5 text-xs leading-5',
                message.role === 'assistant'
                  ? 'bg-panel border-border text-text'
                  : 'bg-[#1a1414] border-accent/30 text-[#f0d4c8]'
              )}
            >
              {message.content}
            </div>
          ))}
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
            />
            <button
              onClick={() => sendAssistant()}
              title="Send"
              aria-label="Send"
              className="no-drag w-9 h-9 rounded-md border border-accent bg-accent text-black hover:brightness-110 flex items-center justify-center transition-colors shrink-0"
            >
              <Send size={14} />
            </button>
          </div>
        </footer>
      </aside>
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

function buildAssistantReply(prompt: string, title: string, content: string) {
  const words = content.trim().split(/\s+/).filter(Boolean).length
  const hasScope = /scope/i.test(content)
  const hasRisks = /risk/i.test(content)
  const base = title.trim() || 'this feature'

  if (/risk/i.test(prompt)) {
    return `For ${base}, capture technical risk, product ambiguity, dependency risk, and rollout risk. Add owner, mitigation, and a decision date for each.`
  }
  if (/milestone|step|phase/i.test(prompt)) {
    return `A good milestone shape is discovery, design decisions, implementation, validation, and release. Keep each milestone tied to a concrete artifact or user-visible outcome.`
  }
  if (/acceptance|criteria/i.test(prompt)) {
    return `Write acceptance criteria as observable behavior: given the project context, when the user opens Planning, then they can create, edit, switch, and keep plans without starting an agent run.`
  }
  if (/gap/i.test(prompt)) {
    const gaps = [
      hasScope ? null : 'scope boundaries',
      hasRisks ? null : 'risks and mitigations',
      words < 80 ? 'user workflow details' : null
    ].filter(Boolean)
    return gaps.length
      ? `I would tighten ${gaps.join(', ')}. Add the decisions that would block engineering work if left implicit.`
      : 'The plan has the core scaffolding. Next, make every open question actionable with an owner or decision trigger.'
  }
  return `For ${base}, turn the next planning pass into decisions, open questions, risks, and acceptance criteria. That keeps the document useful before implementation starts.`
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
