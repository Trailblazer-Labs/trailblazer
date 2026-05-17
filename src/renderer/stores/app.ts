import { create } from 'zustand'
import { applyActivity } from '../components/ActivityList'
import type { ActiveIssueRun, AgentActivity, Project, Repo, RunEvent, DiffFile } from '@shared/types'

type View =
  | { kind: 'loading' }
  | { kind: 'onboarding' }
  | { kind: 'projects' }
  | { kind: 'project'; projectId: number; tab?: 'features' | 'planning' | 'issues'; planId?: number }
  | { kind: 'feature'; projectId: number; featureId: number; sessionId?: number; initialDraft?: string }

const VIEW_STORAGE_KEY = 'trailblazer:last-view'

interface RunState {
  runId: string | null
  repoOwner: string | null
  repoName: string | null
  issueNumber: number | null
  issueTitle: string | null
  status: string
  logs: string
  activities: AgentActivity[]
  diff: DiffFile[] | null
  prNumber: number | null
  prUrl: string | null
  error: string | null
}

interface AppState {
  view: View
  setView: (v: View) => void
  selectedProject: Project | null
  setSelectedProject: (p: Project | null) => void
  selectedRepos: Repo[]
  setSelectedRepos: (r: Repo[]) => void
  run: RunState
  resetRun: () => void
  hydrateActiveRun: (run: ActiveIssueRun | null) => void
  applyRunEvent: (e: RunEvent) => void
}

const initialRun: RunState = {
  runId: null,
  repoOwner: null,
  repoName: null,
  issueNumber: null,
  issueTitle: null,
  status: 'idle',
  logs: '',
  activities: [],
  diff: null,
  prNumber: null,
  prUrl: null,
  error: null
}

export const useApp = create<AppState>((set) => ({
  view: { kind: 'loading' },
  setView: (view) => {
    persistView(view)
    set({ view })
  },
  selectedProject: null,
  setSelectedProject: (p) => set({ selectedProject: p }),
  selectedRepos: [],
  setSelectedRepos: (selectedRepos) => set({ selectedRepos }),
  run: initialRun,
  resetRun: () => set({ run: initialRun }),
  hydrateActiveRun: (active) =>
    set((s) => {
      if (!active) {
        return ['pending', 'running', 'awaiting-approval'].includes(s.run.status)
          ? { run: initialRun }
          : s
      }
      if (s.run.runId === active.run.id) {
        return {
          run: {
            ...s.run,
            repoOwner: active.repoOwner,
            repoName: active.repoName,
            issueNumber: active.issueNumber,
            issueTitle: active.issueTitle,
            status: active.run.status,
            prNumber: active.run.prNumber
          }
        }
      }
      return {
        run: {
          ...initialRun,
          runId: active.run.id,
          repoOwner: active.repoOwner,
          repoName: active.repoName,
          issueNumber: active.issueNumber,
          issueTitle: active.issueTitle,
          status: active.run.status,
          prNumber: active.run.prNumber
        }
      }
    }),
  applyRunEvent: (e) =>
    set((s) => {
      const r = { ...s.run }
      if (e.type === 'log') r.logs = r.logs + e.chunk
      else if (e.type === 'activity') r.activities = applyActivity(r.activities, e.activity)
      else if (e.type === 'status') r.status = e.status
      else if (e.type === 'diff-ready') r.diff = e.files
      else if (e.type === 'pr-created') {
        r.prNumber = e.prNumber
        r.prUrl = e.url
      } else if (e.type === 'error') r.error = e.message
      r.runId = 'runId' in e ? e.runId : r.runId
      return { run: r }
    })
}))

export function restoreLastView(): View {
  if (typeof window === 'undefined') return { kind: 'projects' }
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY)
    if (!raw) return { kind: 'projects' }
    return normalizeStoredView(JSON.parse(raw))
  } catch {
    return { kind: 'projects' }
  }
}

function persistView(view: View) {
  if (typeof window === 'undefined') return
  const stable = stableView(view)
  if (!stable) return
  window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(stable))
}

function stableView(view: View): View | null {
  if (view.kind === 'projects') return view
  if (view.kind === 'project') return view
  if (view.kind === 'feature') {
    const { initialDraft: _initialDraft, ...stable } = view
    return stable
  }
  return null
}

function normalizeStoredView(value: unknown): View {
  if (!value || typeof value !== 'object') return { kind: 'projects' }
  const view = value as Partial<View>
  if (view.kind === 'projects') return { kind: 'projects' }
  if (view.kind === 'project' && typeof view.projectId === 'number') {
    const tab =
      view.tab === 'features' || view.tab === 'planning' || view.tab === 'issues'
        ? view.tab
        : undefined
    return {
      kind: 'project',
      projectId: view.projectId,
      tab,
      planId: typeof view.planId === 'number' ? view.planId : undefined
    }
  }
  if (
    view.kind === 'feature' &&
    typeof view.projectId === 'number' &&
    typeof view.featureId === 'number'
  ) {
    return {
      kind: 'feature',
      projectId: view.projectId,
      featureId: view.featureId,
      sessionId: typeof view.sessionId === 'number' ? view.sessionId : undefined
    }
  }
  return { kind: 'projects' }
}
