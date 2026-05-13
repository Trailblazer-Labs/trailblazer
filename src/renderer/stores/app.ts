import { create } from 'zustand'
import { applyActivity } from '../components/ActivityList'
import type { AgentActivity, Project, Repo, RunEvent, DiffFile } from '@shared/types'

type View =
  | { kind: 'loading' }
  | { kind: 'onboarding' }
  | { kind: 'projects' }
  | { kind: 'project'; projectId: number }
  | { kind: 'feature'; projectId: number; featureId: number; sessionId?: number; initialDraft?: string }

interface RunState {
  runId: string | null
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
  applyRunEvent: (e: RunEvent) => void
}

const initialRun: RunState = {
  runId: null,
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
  setView: (view) => set({ view }),
  selectedProject: null,
  setSelectedProject: (p) => set({ selectedProject: p }),
  selectedRepos: [],
  setSelectedRepos: (selectedRepos) => set({ selectedRepos }),
  run: initialRun,
  resetRun: () => set({ run: initialRun }),
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
