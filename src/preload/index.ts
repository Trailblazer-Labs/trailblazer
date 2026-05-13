import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { ModelUseCase } from '../shared/models'
import type {
  AppConfig,
  Engine,
  EngineDetection,
  ExpandEvent,
  Feature,
  FeatureMessage,
  FeatureRepo,
  FeatureCommitResult,
  FeatureRepoChanges,
  FeatureRunEvent,
  FeatureSession,
  GhAuthEvent,
  Plan,
  PlanFeatureResult,
  PlanMessage,
  PlanRunEvent,
  PRCreateResult,
  Project,
  Repo,
  RepoSearchResult,
  Issue,
  PullRequest,
  Run,
  RunEvent,
  DiffFile,
  UpdateStatus
} from '../shared/types'

const api = {
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.configGet),
    setGithubPat: (token: string): Promise<{ login: string }> =>
      ipcRenderer.invoke(IPC.configSetGithubPat, token),
    setEngine: (args: { engine: Engine; path?: string }): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.configSetEngine, args),
    detectEngines: (): Promise<EngineDetection> => ipcRenderer.invoke(IPC.configDetectEngines),
    getModel: (useCase: ModelUseCase, engine: Engine): Promise<string> =>
      ipcRenderer.invoke(IPC.configGetModel, useCase, engine),
    setModel: (
      useCase: ModelUseCase,
      engine: Engine,
      modelId: string
    ): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.configSetModel, useCase, engine, modelId),
    cachedDiscoveredModels: (
      engine: Engine
    ): Promise<Array<{ id: string; label?: string }> | null> =>
      ipcRenderer.invoke(IPC.configCachedDiscoveredModels, engine),
    discoverModels: (engine: Engine): Promise<Array<{ id: string; label?: string }>> =>
      ipcRenderer.invoke(IPC.configDiscoverModels, engine)
  },
  updater: {
    getStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updaterGetStatus),
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updaterCheck),
    download: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updaterDownload),
    quitAndInstall: (): Promise<UpdateStatus> =>
      ipcRenderer.invoke(IPC.updaterQuitAndInstall),
    onEvent: (cb: (status: UpdateStatus) => void) => {
      const listener = (_e: IpcRendererEvent, status: UpdateStatus) => cb(status)
      ipcRenderer.on(IPC.updaterEvent, listener)
      return () => { ipcRenderer.off(IPC.updaterEvent, listener) }
    }
  },
  gh: {
    detect: (): Promise<{ found: boolean; path?: string; version?: string }> =>
      ipcRenderer.invoke(IPC.ghDetect),
    status: (): Promise<{ signedIn: boolean; login?: string }> =>
      ipcRenderer.invoke(IPC.ghStatus),
    loginStart: (): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.ghLoginStart),
    loginCancel: (): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.ghLoginCancel),
    refreshScopes: (scopes: string[]): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.ghRefreshScopes, scopes),
    signOut: (): Promise<void> => ipcRenderer.invoke(IPC.ghSignOut),
    onEvent: (cb: (evt: GhAuthEvent) => void) => {
      const listener = (_e: IpcRendererEvent, evt: GhAuthEvent) => cb(evt)
      ipcRenderer.on(IPC.ghEvent, listener)
      return () => { ipcRenderer.off(IPC.ghEvent, listener) }
    }
  },
  github: {
    validatePat: (token: string) => ipcRenderer.invoke(IPC.githubValidatePat, token),
    searchRepos: (q: string): Promise<RepoSearchResult[]> =>
      ipcRenderer.invoke(IPC.githubSearchRepos, q),
    listIssues: (
      owner: string,
      repo: string,
      page = 1
    ): Promise<{ items: Omit<Issue, 'id' | 'repoId'>[]; hasMore: boolean }> =>
      ipcRenderer.invoke(IPC.githubListIssues, owner, repo, page),
    createIssue: (
      owner: string,
      repo: string,
      title: string,
      body: string
    ): Promise<{
      number: number
      title: string
      body: string | null
      state: 'open' | 'closed'
      url: string
      updatedAt: string
    }> => ipcRenderer.invoke(IPC.githubCreateIssue, owner, repo, title, body),
    expandIssue: (args: {
      brief: string
      repoId: number
    }): Promise<{ title: string; body: string }> => ipcRenderer.invoke(IPC.issuesExpand, args),
    onExpandEvent: (cb: (evt: ExpandEvent) => void) => {
      const listener = (_e: IpcRendererEvent, evt: ExpandEvent) => cb(evt)
      ipcRenderer.on(IPC.issuesExpandEvent, listener)
      return () => { ipcRenderer.off(IPC.issuesExpandEvent, listener) }
    },
    listPulls: (
      owner: string,
      repo: string,
      page = 1
    ): Promise<{ items: Omit<PullRequest, 'id' | 'repoId'>[]; hasMore: boolean }> =>
      ipcRenderer.invoke(IPC.githubListPulls, owner, repo, page),
    getPullDetail: (
      owner: string,
      repo: string,
      number: number
    ): Promise<{
      number: number
      title: string
      body: string
      state: string
      mergeable: boolean | null
      files: DiffFile[]
    }> => ipcRenderer.invoke(IPC.githubGetPullDetail, owner, repo, number),
    mergePull: (
      owner: string,
      repo: string,
      number: number,
      method: 'merge' | 'squash' | 'rebase'
    ) => ipcRenderer.invoke(IPC.githubMergePull, owner, repo, number, method),
    closePull: (owner: string, repo: string, number: number) =>
      ipcRenderer.invoke(IPC.githubClosePull, owner, repo, number),
    closeIssue: (owner: string, repo: string, number: number) =>
      ipcRenderer.invoke(IPC.githubCloseIssue, owner, repo, number)
  },
  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke(IPC.projectsList),
    create: (name: string): Promise<Project> => ipcRenderer.invoke(IPC.projectsCreate, name),
    delete: (id: number) => ipcRenderer.invoke(IPC.projectsDelete, id),
    addRepo: (
      projectId: number,
      repo: { owner: string; name: string; defaultBranch: string }
    ): Promise<{ id: number; localPath: string }> =>
      ipcRenderer.invoke(IPC.projectsAddRepo, projectId, repo),
    addTrailblazer: (): Promise<Project> =>
      ipcRenderer.invoke(IPC.projectsAddTrailblazer),
    removeRepo: (repoId: number) => ipcRenderer.invoke(IPC.projectsRemoveRepo, repoId),
    listRepos: (projectId: number): Promise<Repo[]> =>
      ipcRenderer.invoke(IPC.projectsListRepos, projectId)
  },
  plans: {
    list: (projectId: number): Promise<Plan[]> => ipcRenderer.invoke(IPC.plansList, projectId),
    get: (planId: number): Promise<Plan | null> => ipcRenderer.invoke(IPC.plansGet, planId),
    create: (projectId: number, title?: string): Promise<Plan> =>
      ipcRenderer.invoke(IPC.plansCreate, projectId, title),
    update: (planId: number, patch: { title?: string; content?: string }): Promise<Plan> =>
      ipcRenderer.invoke(IPC.plansUpdate, planId, patch),
    delete: (planId: number): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.plansDelete, planId),
    createFeature: (args: {
      planId: number
      name: string
      content: string
      repoIds: number[]
    }): Promise<PlanFeatureResult> => ipcRenderer.invoke(IPC.plansCreateFeature, args),
    listMessages: (planId: number): Promise<PlanMessage[]> =>
      ipcRenderer.invoke(IPC.plansListMessages, planId),
    sendPrompt: (args: {
      planId: number
      prompt: string
      planTitle: string
      planContent: string
      model?: string
    }): Promise<{ assistantMessageId: number }> => ipcRenderer.invoke(IPC.plansSendPrompt, args),
    cancelPrompt: (planId: number): Promise<void> =>
      ipcRenderer.invoke(IPC.plansCancelPrompt, planId),
    onEvent: (cb: (evt: PlanRunEvent) => void) => {
      const listener = (_e: IpcRendererEvent, evt: PlanRunEvent) => cb(evt)
      ipcRenderer.on(IPC.plansEvent, listener)
      return () => { ipcRenderer.off(IPC.plansEvent, listener) }
    }
  },
  features: {
    list: (projectId: number): Promise<Feature[]> => ipcRenderer.invoke(IPC.featuresList, projectId),
    get: (featureId: number): Promise<Feature | null> =>
      ipcRenderer.invoke(IPC.featuresGet, featureId),
    listRepos: (featureId: number): Promise<FeatureRepo[]> =>
      ipcRenderer.invoke(IPC.featuresListRepos, featureId),
    listRepoBranches: (repoId: number): Promise<string[]> =>
      ipcRenderer.invoke(IPC.featuresListRepoBranches, repoId),
    create: (args: {
      projectId: number
      name: string
      repoIds: number[]
    }): Promise<{ feature: Feature; featureRepos: FeatureRepo[] }> =>
      ipcRenderer.invoke(IPC.featuresCreate, args),
    import: (args: {
      projectId: number
      name: string
      repos: Array<{
        repoId: number
        existingBranch?: string
        newBranch?: string
        baseBranch?: string
      }>
    }): Promise<{ feature: Feature; featureRepos: FeatureRepo[] }> =>
      ipcRenderer.invoke(IPC.featuresImport, args),
    delete: (featureId: number): Promise<void> => ipcRenderer.invoke(IPC.featuresDelete, featureId),
    listMessages: (sessionId: number): Promise<FeatureMessage[]> =>
      ipcRenderer.invoke(IPC.featuresListMessages, sessionId),
    sendPrompt: (args: {
      featureId: number
      sessionId?: number
      prompt: string
      model?: string
    }): Promise<{ assistantMessageId: number; sessionId: number }> =>
      ipcRenderer.invoke(IPC.featuresSendPrompt, args),
    listSessions: (featureId: number): Promise<FeatureSession[]> =>
      ipcRenderer.invoke(IPC.featuresListSessions, featureId),
    createSession: (featureId: number, name?: string): Promise<FeatureSession> =>
      ipcRenderer.invoke(IPC.featuresCreateSession, featureId, name),
    renameSession: (sessionId: number, name: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.featuresRenameSession, sessionId, name),
    deleteSession: (sessionId: number): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.featuresDeleteSession, sessionId),
    touchSession: (sessionId: number): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.featuresTouchSession, sessionId),
    cancelTurn: (featureId: number): Promise<void> =>
      ipcRenderer.invoke(IPC.featuresCancelTurn, featureId),
    createPRs: (featureId: number): Promise<PRCreateResult[]> =>
      ipcRenderer.invoke(IPC.featuresCreatePRs, featureId),
    getChanges: (
      args:
        | number
        | { featureId: number; scope?: 'overall' | 'session'; sessionId?: number }
    ): Promise<FeatureRepoChanges[]> => ipcRenderer.invoke(IPC.featuresGetChanges, args),
    commit: (args: { featureId: number; message: string }): Promise<FeatureCommitResult[]> =>
      ipcRenderer.invoke(IPC.featuresCommit, args),
    onEvent: (cb: (evt: FeatureRunEvent) => void) => {
      const listener = (_e: IpcRendererEvent, evt: FeatureRunEvent) => cb(evt)
      ipcRenderer.on(IPC.featuresEvent, listener)
      return () => { ipcRenderer.off(IPC.featuresEvent, listener) }
    }
  },
  repos: {
    setWorkingBranch: (repoId: number, branch: string | null): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.reposSetWorkingBranch, repoId, branch)
  },
  shell: {
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(IPC.openExternal, url)
  },
  runs: {
    start: (args: {
      repoId: number
      repoOwner: string
      repoName: string
      defaultBranch: string
      issueNumber: number
      issueTitle: string
      issueBody: string
    }): Promise<Run> => ipcRenderer.invoke(IPC.runsStart, args),
    cancel: (runId: string) => ipcRenderer.invoke(IPC.runsCancel, runId),
    approvePush: (runId: string): Promise<{ prNumber: number; url: string }> =>
      ipcRenderer.invoke(IPC.runsApprovePush, runId),
    onEvent: (cb: (evt: RunEvent) => void) => {
      const listener = (_e: IpcRendererEvent, evt: RunEvent) => cb(evt)
      ipcRenderer.on(IPC.runEvent, listener)
      return () => { ipcRenderer.off(IPC.runEvent, listener) }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type TrailblazerApi = typeof api
