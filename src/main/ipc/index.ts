import { ipcMain, BrowserWindow, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { getDb } from '../services/db'
import * as gh from '../services/github'
import { ensureRepoCloned } from '../services/git'
import * as runner from '../services/claudeRunner'
import { expandIssue, expandBus } from '../services/issueExpander'
import { detectEngines, getEngine, setEngine } from '../services/engine'
import { getModel, setModel } from '../services/modelPrefs'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  quitAndInstall
} from '../services/updater'
import { checkReleaseGate, getReleaseGateStatus } from '../services/releaseGate'
import {
  getCachedDiscoveredModels,
  refreshDiscoveredModels
} from '../services/modelDiscovery'
import type { ModelUseCase } from '@shared/models'
import * as features from '../services/features'
import * as featureRunner from '../services/featureRunner'
import * as featureDevRunner from '../services/featureDevRunner'
import * as devProfiles from '../services/devProfiles'
import * as plans from '../services/plans'
import * as planningRunner from '../services/planningRunner'
import {
  getProject,
  listProjects,
  projectFromRow,
  updateProjectSettings,
  type ProjectRow,
  type ProjectSettingsPatch
} from '../services/projectPrefs'
import {
  detectGh,
  ghAuthStatus,
  ghBus,
  startGhLogin,
  cancelGhLogin,
  startGhRefreshScopes,
  ghSignOut,
  getAuthMode,
  setAuthMode,
  ghGetToken
} from '../services/ghAuth'
import type {
  Project,
  Repo,
  AppConfig,
  Engine,
  PlanPromptAttachment,
  DevProfileInput
} from '@shared/types'

const TRAILBLAZER_REPO = {
  owner: 'Trailblazer-Labs',
  name: 'trailblazer',
  defaultBranch: 'main'
}

export function registerIpc(win: BrowserWindow) {
  // Broadcast run events to renderer.
  runner.runnerBus.on('event', (evt) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.runEvent, evt)
  })
  ghBus.on('event', (evt) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.ghEvent, evt)
  })
  expandBus.on('event', (evt) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.issuesExpandEvent, evt)
  })
  featureRunner.featureBus.on('event', (evt) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.featuresEvent, evt)
  })
  featureDevRunner.featureDevBus.on('event', (evt) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.featuresDevEvent, evt)
  })
  planningRunner.planBus.on('event', (evt) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.plansEvent, evt)
  })

  // ── config ───────────────────────────────────────────
  ipcMain.handle(IPC.configGet, async (): Promise<AppConfig> => {
    const engine = getEngine()
    let authMode = getAuthMode()
    let ghLogin: string | null = null
    let hasPat = gh.hasPat()
    if (authMode === 'gh') {
      const s = await ghAuthStatus()
      ghLogin = s.login ?? null
      if (s.signedIn && !hasPat) {
        const token = await ghGetToken()
        if (token) {
          gh.setPat(token)
          hasPat = true
        }
      }
    } else if (!authMode) {
      const s = await ghAuthStatus()
      if (s.signedIn) {
        const token = await ghGetToken()
        if (token) {
          setAuthMode('gh')
          gh.setPat(token)
          authMode = 'gh'
          ghLogin = s.login ?? null
          hasPat = true
        }
      }
    }
    return {
      authConfigured: authMode === 'gh' ? !!ghLogin || hasPat : hasPat,
      githubPatConfigured: hasPat,
      engineConfigured: !!engine,
      engine,
      authMode,
      ghLogin
    }
  })

  ipcMain.handle(IPC.configSetGithubPat, async (_e, token: string) => {
    const v = await gh.validatePat(token)
    if ('error' in v) throw new Error(v.error)
    gh.setPat(token)
    setAuthMode('pat')
    return { login: v.login }
  })

  ipcMain.handle(IPC.ghDetect, () => detectGh())
  ipcMain.handle(IPC.ghStatus, () => ghAuthStatus())
  ipcMain.handle(IPC.ghLoginStart, () => {
    startGhLogin()
    return { ok: true }
  })
  ipcMain.handle(IPC.ghLoginCancel, () => {
    cancelGhLogin()
    return { ok: true }
  })
  ipcMain.handle(IPC.ghRefreshScopes, (_e, scopes: string[]) => {
    startGhRefreshScopes(scopes)
    return { ok: true }
  })
  ipcMain.handle(IPC.ghSignOut, () => ghSignOut())

  ipcMain.handle(
    IPC.configSetEngine,
    (_e, args: { engine: Engine; path?: string }) => {
      setEngine(args)
      return { ok: true }
    }
  )

  ipcMain.handle(IPC.configDetectEngines, () => detectEngines())
  ipcMain.handle(
    IPC.configGetModel,
    (_e, useCase: ModelUseCase, engine: Engine) => getModel(useCase, engine)
  )
  ipcMain.handle(
    IPC.configSetModel,
    (_e, useCase: ModelUseCase, engine: Engine, modelId: string) => {
      setModel(useCase, engine, modelId)
      return { ok: true }
    }
  )
  ipcMain.handle(IPC.configCachedDiscoveredModels, (_e, engine: Engine) =>
    getCachedDiscoveredModels(engine)
  )
  ipcMain.handle(IPC.configDiscoverModels, (_e, engine: Engine) =>
    refreshDiscoveredModels(engine)
  )
  ipcMain.handle(IPC.updaterGetStatus, () => getUpdateStatus())
  ipcMain.handle(IPC.updaterCheck, () => checkForUpdates())
  ipcMain.handle(IPC.updaterDownload, () => downloadUpdate())
  ipcMain.handle(IPC.updaterQuitAndInstall, () => quitAndInstall())
  ipcMain.handle(IPC.releaseGateGet, () => getReleaseGateStatus())
  ipcMain.handle(IPC.releaseGateRefresh, () => checkReleaseGate())

  // ── github ───────────────────────────────────────────
  ipcMain.handle(IPC.githubValidatePat, (_e, token: string) => gh.validatePat(token))
  ipcMain.handle(IPC.githubSearchRepos, (_e, q: string) => gh.searchRepos(q))
  ipcMain.handle(IPC.githubListIssues, (_e, owner: string, repo: string, page = 1) =>
    gh.listIssues(owner, repo, page)
  )
  ipcMain.handle(
    IPC.githubCreateIssue,
    (_e, owner: string, repo: string, title: string, body: string) =>
      gh.createIssue(owner, repo, title, body)
  )
  ipcMain.handle(IPC.issuesExpand, (_e, args: { brief: string; repoId: number }) =>
    expandIssue(args)
  )
  ipcMain.handle(IPC.githubListPulls, (_e, owner: string, repo: string, page = 1) =>
    gh.listPulls(owner, repo, page)
  )
  ipcMain.handle(IPC.githubGetPullDetail, (_e, owner: string, repo: string, number: number) =>
    gh.getPullDetail(owner, repo, number)
  )
  ipcMain.handle(
    IPC.githubMergePull,
    (_e, owner: string, repo: string, number: number, method: 'merge' | 'squash' | 'rebase') =>
      gh.mergePull(owner, repo, number, method)
  )
  ipcMain.handle(IPC.githubClosePull, (_e, owner: string, repo: string, number: number) =>
    gh.closePull(owner, repo, number)
  )
  ipcMain.handle(IPC.githubCloseIssue, (_e, owner: string, repo: string, number: number) =>
    gh.closeIssue(owner, repo, number)
  )

  // ── projects ─────────────────────────────────────────
  ipcMain.handle(IPC.projectsList, (): Project[] => {
    return listProjects()
  })

  ipcMain.handle(IPC.projectsGet, (_e, projectId: number): Project | null =>
    getProject(projectId)
  )

  ipcMain.handle(
    IPC.projectsCreate,
    (_e, args: string | { name: string; assistantEngine?: Engine | null }): Project => {
    const name = typeof args === 'string' ? args : args.name
    const engine = typeof args === 'string' ? getEngine() : (args.assistantEngine ?? getEngine())
    const r = getDb()
      .prepare('INSERT INTO projects(name, assistant_engine) VALUES(?,?)')
      .run(name, engine)
    return {
      id: Number(r.lastInsertRowid),
      name,
      createdAt: new Date().toISOString(),
      assistantEngine: engine,
      featureModel: null,
      issueExpandModel: null,
      issueResolveModel: null
    }
    }
  )

  ipcMain.handle(
    IPC.projectsUpdateSettings,
    (_e, projectId: number, patch: ProjectSettingsPatch): Project =>
      updateProjectSettings(projectId, patch)
  )

  ipcMain.handle(IPC.projectsDelete, (_e, projectId: number) => {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    return { ok: true }
  })

  ipcMain.handle(
    IPC.projectsAddRepo,
    async (_e, projectId: number, repo: { owner: string; name: string; defaultBranch: string }) => {
      const localPath = await ensureRepoCloned(repo.owner, repo.name)
      const r = getDb()
        .prepare(
          'INSERT OR IGNORE INTO repos(project_id, owner, name, default_branch, local_path) VALUES(?,?,?,?,?)'
        )
        .run(projectId, repo.owner, repo.name, repo.defaultBranch, localPath)
      return { id: Number(r.lastInsertRowid), localPath }
    }
  )

  ipcMain.handle(IPC.projectsAddTrailblazer, async (): Promise<Project> => {
    const db = getDb()
    const existing = db
      .prepare(
        `SELECT p.id, p.name, p.created_at
           FROM projects p
           JOIN repos r ON r.project_id = p.id
          WHERE r.owner = ? AND r.name = ?
          ORDER BY p.id ASC
          LIMIT 1`
      )
      .get(TRAILBLAZER_REPO.owner, TRAILBLAZER_REPO.name) as
      | { id: number; name: string; created_at: string }
      | undefined

    if (existing) {
      return getProject(existing.id) ?? {
        id: existing.id,
        name: existing.name,
        createdAt: existing.created_at,
        assistantEngine: null,
        featureModel: null,
        issueExpandModel: null,
        issueResolveModel: null
      }
    }

    const project =
      (db
        .prepare(
          `SELECT id, name, created_at, assistant_engine, feature_model, issue_expand_model, issue_resolve_model
             FROM projects
            WHERE name = ?
            ORDER BY id ASC
            LIMIT 1`
        )
        .get('Trailblazer') as ProjectRow | undefined) ??
      (() => {
        const created = db
          .prepare('INSERT INTO projects(name, assistant_engine) VALUES(?,?)')
          .run('Trailblazer', getEngine())
        return {
          id: Number(created.lastInsertRowid),
          name: 'Trailblazer',
          created_at: new Date().toISOString(),
          assistant_engine: getEngine(),
          feature_model: null,
          issue_expand_model: null,
          issue_resolve_model: null
        }
      })()

    const localPath = await ensureRepoCloned(TRAILBLAZER_REPO.owner, TRAILBLAZER_REPO.name)
    db.prepare(
      'INSERT OR IGNORE INTO repos(project_id, owner, name, default_branch, local_path) VALUES(?,?,?,?,?)'
    ).run(
      project.id,
      TRAILBLAZER_REPO.owner,
      TRAILBLAZER_REPO.name,
      TRAILBLAZER_REPO.defaultBranch,
      localPath
    )

    return projectFromRow(project)
  })

  ipcMain.handle(IPC.projectsRemoveRepo, (_e, repoId: number) => {
    getDb().prepare('DELETE FROM repos WHERE id = ?').run(repoId)
    return { ok: true }
  })

  ipcMain.handle(IPC.projectsListRepos, (_e, projectId: number): Repo[] => {
    const rows = getDb()
      .prepare(
        'SELECT id, project_id, owner, name, default_branch, local_path, working_branch FROM repos WHERE project_id = ? ORDER BY id ASC'
      )
      .all(projectId) as {
      id: number
      project_id: number
      owner: string
      name: string
      default_branch: string
      local_path: string
      working_branch: string | null
    }[]
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      owner: r.owner,
      name: r.name,
      defaultBranch: r.default_branch,
      localPath: r.local_path,
      workingBranch: r.working_branch
    }))
  })

  // ── planning ────────────────────────────────────────
  ipcMain.handle(IPC.plansList, (_e, projectId: number) => plans.listPlans(projectId))
  ipcMain.handle(IPC.plansGet, (_e, planId: number) => plans.getPlan(planId))
  ipcMain.handle(IPC.plansCreate, (_e, projectId: number, title?: string) =>
    plans.createPlan(projectId, title)
  )
  ipcMain.handle(
    IPC.plansUpdate,
    (_e, planId: number, patch: { title?: string; content?: string }) =>
      plans.updatePlan(planId, patch)
  )
  ipcMain.handle(IPC.plansDelete, (_e, planId: number) => {
    plans.deletePlan(planId)
    return { ok: true }
  })
  ipcMain.handle(IPC.plansListActive, (_e, projectId?: number) =>
    planningRunner.listActivePlanIds(projectId)
  )
  ipcMain.handle(
    IPC.plansCreateFeature,
    (
      _e,
      args: { planId: number; name: string; content: string; repoIds: number[] }
    ) => plans.createFeatureFromPlan(args)
  )
  ipcMain.handle(IPC.plansListMessages, (_e, planId: number) =>
    planningRunner.listMessages(planId)
  )
  ipcMain.handle(
    IPC.plansSendPrompt,
    (
      _e,
      args: {
        planId: number
        prompt: string
        planTitle: string
        planContent: string
        attachments?: PlanPromptAttachment[]
        model?: string
      }
    ) => planningRunner.sendPrompt(args)
  )
  ipcMain.handle(IPC.plansCancelPrompt, (_e, planId: number) =>
    planningRunner.cancelRun(planId)
  )

  // ── features ─────────────────────────────────────────
  ipcMain.handle(IPC.featuresList, (_e, projectId: number) =>
    features.listFeaturesWithPrSync(projectId)
  )
  ipcMain.handle(IPC.featuresGet, (_e, featureId: number) => features.getFeature(featureId))
  ipcMain.handle(IPC.featuresListActive, (_e, projectId?: number) =>
    featureRunner.listActiveFeatureIds(projectId)
  )
  ipcMain.handle(IPC.featuresListRepos, (_e, featureId: number) =>
    features.listFeatureRepos(featureId)
  )
  ipcMain.handle(IPC.featuresListRepoBranches, (_e, repoId: number) =>
    features.listRepoBranches(repoId)
  )
  ipcMain.handle(
    IPC.featuresCreate,
    (
      _e,
      args: {
        projectId: number
        name: string
        repoIds: number[]
        baseBranches?: Record<number, string>
      }
    ) =>
      features.createFeature(args)
  )
  ipcMain.handle(
    IPC.featuresImport,
    (
      _e,
      args: {
        projectId: number
        name: string
        repos: Array<{
          repoId: number
          existingBranch?: string
          newBranch?: string
          baseBranch?: string
        }>
      }
    ) => features.importFeature(args)
  )
  ipcMain.handle(
    IPC.featuresAddRepos,
    (
      _e,
      args: {
        featureId: number
        repos: Array<{
          repoId: number
          existingBranch?: string
          newBranch?: string
          baseBranch?: string
        }>
      }
    ) => features.addReposToFeature(args)
  )
  ipcMain.handle(IPC.featuresDelete, (_e, featureId: number) => features.deleteFeature(featureId))
  ipcMain.handle(
    IPC.featuresRebranchRepo,
    (
      _e,
      args: {
        featureId: number
        repoId: number
        baseBranch: string
        source?: 'base' | 'current'
        force?: boolean
      }
    ) => features.rebranchFeatureRepo(args)
  )
  ipcMain.handle(IPC.featuresListMessages, (_e, sessionId: number) =>
    featureRunner.listMessages(sessionId)
  )
  ipcMain.handle(
    IPC.featuresSendPrompt,
    (
      _e,
      args: {
        featureId: number
        sessionId?: number
        prompt: string
        attachments?: PlanPromptAttachment[]
        model?: string
      }
    ) => featureRunner.sendPrompt(args)
  )
  ipcMain.handle(IPC.featuresListSessions, (_e, featureId: number) =>
    features.listSessions(featureId)
  )
  ipcMain.handle(IPC.featuresCreateSession, (_e, featureId: number, name?: string) =>
    features.createSession(featureId, name)
  )
  ipcMain.handle(IPC.featuresRenameSession, (_e, sessionId: number, name: string) => {
    features.renameSession(sessionId, name)
    return { ok: true }
  })
  ipcMain.handle(IPC.featuresDeleteSession, (_e, sessionId: number) => {
    features.deleteSession(sessionId)
    return { ok: true }
  })
  ipcMain.handle(IPC.featuresTouchSession, (_e, sessionId: number) => {
    features.touchSession(sessionId)
    return { ok: true }
  })
  ipcMain.handle(IPC.featuresCancelTurn, (_e, featureId: number) =>
    featureRunner.cancelRun(featureId)
  )
  ipcMain.handle(IPC.featuresCreatePRs, (_e, featureId: number) =>
    featureRunner.createPRs(featureId)
  )
  ipcMain.handle(
    IPC.featuresGetChanges,
    (
      _e,
      args: number | { featureId: number; scope?: 'overall' | 'session'; sessionId?: number }
    ) => {
      const a = typeof args === 'number' ? { featureId: args } : args
      return featureRunner.getFeatureChanges(a.featureId, {
        scope: a.scope,
        sessionId: a.sessionId
      })
    }
  )
  ipcMain.handle(
    IPC.featuresCommit,
    (_e, args: { featureId: number; message: string; repoId?: number }) =>
      featureRunner.commitFeatureChanges(args.featureId, args.message, args.repoId)
  )
  ipcMain.handle(
    IPC.featuresCommitPublish,
    (_e, args: { featureId: number; message: string; repoId?: number }) =>
      featureRunner.commitAndPublishFeatureChanges(args.featureId, args.message, args.repoId)
  )
  ipcMain.handle(IPC.featuresPublish, (_e, featureId: number) =>
    featureRunner.publishFeatureBranches(featureId)
  )
  ipcMain.handle(IPC.featuresPull, (_e, featureId: number) =>
    featureRunner.pullFeatureBranches(featureId)
  )
  ipcMain.handle(
    IPC.featuresDevRun,
    (_e, args: { featureId: number; repoId: number; command: string; cwd?: string }) =>
      featureDevRunner.startDevCommand(args)
  )
  ipcMain.handle(
    IPC.featuresDevRunProfile,
    (_e, args: { featureId: number; profileId: number }) =>
      featureDevRunner.startProfileDevCommand(args)
  )
  ipcMain.handle(
    IPC.featuresDevRunSetup,
    (_e, args: { featureId: number; profileId: number }) =>
      featureDevRunner.runProfileSetup(args)
  )
  ipcMain.handle(
    IPC.featuresDevSetupState,
    (_e, args: { featureId: number; profileId: number }) =>
      devProfiles.getSetupState(args.featureId, args.profileId)
  )
  ipcMain.handle(IPC.featuresDevStop, (_e, featureId: number) =>
    featureDevRunner.stopDevCommand(featureId)
  )
  ipcMain.handle(IPC.reposSetWorkingBranch, (_e, repoId: number, branch: string | null) => {
    getDb().prepare('UPDATE repos SET working_branch = ? WHERE id = ?').run(branch, repoId)
    return { ok: true }
  })
  ipcMain.handle(IPC.devProfilesList, (_e, projectId: number) =>
    devProfiles.listProfiles(projectId)
  )
  ipcMain.handle(
    IPC.devProfilesSave,
    (_e, projectId: number, profiles: DevProfileInput[]) =>
      devProfiles.saveProfiles(projectId, profiles)
  )
  ipcMain.handle(IPC.openExternal, (_e, url: string) => shell.openExternal(url))

  // ── runs ─────────────────────────────────────────────
  ipcMain.handle(
    IPC.runsStart,
    (
      _e,
      args: {
        repoId: number
        repoOwner: string
        repoName: string
        defaultBranch: string
        issueNumber: number
        issueTitle: string
        issueBody: string
      }
    ) => runner.startRun(args)
  )

  ipcMain.handle(IPC.runsCancel, (_e, runId: string) => runner.cancelRun(runId))
  ipcMain.handle(IPC.runsApprovePush, (_e, runId: string) => runner.approvePush(runId))
  ipcMain.handle(IPC.runsGetActive, () => runner.getActiveRun())
}
