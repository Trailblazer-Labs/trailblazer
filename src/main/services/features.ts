import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import simpleGit from 'simple-git'
import { getDb } from './db'
import { ensureRepoCloned } from './git'
import * as gh from './github'
import type { Engine, Feature, FeatureRepo, FeatureSession } from '@shared/types'

export function featuresRoot(): string {
  return path.join(app.getPath('userData'), 'features')
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_ ]+/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

export function listFeatures(projectId: number): Feature[] {
  const rows = getDb()
    .prepare(
      `SELECT id, project_id, name, slug, status, workspace_path, created_at
       FROM features WHERE project_id = ? AND status != 'archived' ORDER BY id DESC`
    )
    .all(projectId) as {
    id: number
    project_id: number
    name: string
    slug: string
    status: 'active' | 'archived' | 'merged'
    workspace_path: string
    created_at: string
  }[]
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    workspacePath: r.workspace_path,
    createdAt: r.created_at
  }))
}

export async function listFeaturesWithPrSync(projectId: number): Promise<Feature[]> {
  const summaries = await syncMergedFeatureStatuses(projectId)
  return listFeatures(projectId).map((feature) => ({
    ...feature,
    ...summaries.get(feature.id)
  }))
}

type FeatureCompletionSummary = {
  repoCount: number
  prRepoCount: number
  mergedRepoCount: number
}

async function syncMergedFeatureStatuses(
  projectId: number
): Promise<Map<number, FeatureCompletionSummary>> {
  const rows = getDb()
    .prepare(`SELECT id FROM features WHERE project_id = ? AND status != 'archived'`)
    .all(projectId) as { id: number }[]
  const summaries = new Map<number, FeatureCompletionSummary>()

  for (const feature of rows) {
    const repos = listFeatureRepos(feature.id)
    let prRepoCount = 0
    let mergedRepoCount = 0

    for (const repo of repos) {
      if (!repo.prNumber) continue
      prRepoCount++
      try {
        const detail = await gh.getPullDetail(repo.repoOwner, repo.repoName, repo.prNumber)
        if (detail.state === 'merged') mergedRepoCount++
      } catch {
        // Leave this repo unmerged if GitHub cannot be checked right now.
      }
    }

    const summary = { repoCount: repos.length, prRepoCount, mergedRepoCount }
    summaries.set(feature.id, summary)
    const complete = repos.length > 0 && mergedRepoCount === repos.length
    getDb()
      .prepare(`UPDATE features SET status = ? WHERE id = ?`)
      .run(complete ? 'merged' : 'active', feature.id)
  }

  return summaries
}

export function getFeature(featureId: number): Feature | null {
  const r = getDb()
    .prepare(
      `SELECT id, project_id, name, slug, status, workspace_path, created_at
       FROM features WHERE id = ?`
    )
    .get(featureId) as
    | {
        id: number
        project_id: number
        name: string
        slug: string
        status: 'active' | 'archived' | 'merged'
        workspace_path: string
        created_at: string
      }
    | undefined
  if (!r) return null
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    workspacePath: r.workspace_path,
    createdAt: r.created_at
  }
}

export function listFeatureRepos(featureId: number): FeatureRepo[] {
  const rows = getDb()
    .prepare(
      `SELECT fr.feature_id, fr.repo_id, fr.branch, fr.base_branch, fr.worktree_path,
              fr.pr_number, fr.pr_url, r.owner AS repo_owner, r.name AS repo_name
         FROM feature_repos fr
         JOIN repos r ON r.id = fr.repo_id
        WHERE fr.feature_id = ?
        ORDER BY r.id ASC`
    )
    .all(featureId) as {
    feature_id: number
    repo_id: number
    repo_owner: string
    repo_name: string
    branch: string
    base_branch: string
    worktree_path: string
    pr_number: number | null
    pr_url: string | null
  }[]
  return rows.map((r) => ({
    featureId: r.feature_id,
    repoId: r.repo_id,
    repoOwner: r.repo_owner,
    repoName: r.repo_name,
    branch: r.branch,
    baseBranch: r.base_branch,
    worktreePath: r.worktree_path,
    prNumber: r.pr_number,
    prUrl: r.pr_url
  }))
}

/**
 * Create a new feature: derive slug, create `feature/<slug>` in each affected repo,
 * stand up a workspace directory with git worktrees per repo so the agent can later
 * operate over all of them with a single cwd.
 */
export async function createFeature(opts: {
  projectId: number
  name: string
  repoIds: number[]
  baseBranches?: Record<number, string>
}): Promise<{ feature: Feature; featureRepos: FeatureRepo[] }> {
  const slug = slugify(opts.name)
  if (!slug) throw new Error('Feature name cannot be empty')

  const db = getDb()
  const repos = db
    .prepare(
      `SELECT id, owner, name, default_branch, local_path, COALESCE(working_branch, default_branch) AS working_branch
         FROM repos WHERE id IN (${opts.repoIds.map(() => '?').join(',')})`
    )
    .all(...opts.repoIds) as {
    id: number
    owner: string
    name: string
    default_branch: string
    local_path: string
    working_branch: string
  }[]
  if (repos.length === 0) throw new Error('No repos selected')

  // Insert feature row up front so we have an id for path.
  const workspacePathPlaceholder = path.join(featuresRoot(), 'pending')
  const r = db
    .prepare(
      `INSERT INTO features(project_id, name, slug, workspace_path) VALUES(?,?,?,?)`
    )
    .run(opts.projectId, opts.name.trim(), slug, workspacePathPlaceholder)
  const featureId = Number(r.lastInsertRowid)
  const workspacePath = path.join(featuresRoot(), `${featureId}-${slug}`)
  fs.mkdirSync(workspacePath, { recursive: true })
  db.prepare('UPDATE features SET workspace_path = ? WHERE id = ?').run(workspacePath, featureId)

  const branch = `feature/${slug}`
  const featureRepos: FeatureRepo[] = []

  for (const repo of repos) {
    const repoPath = await ensureRepoCloned(repo.owner, repo.name)
    const requestedBase = opts.baseBranches?.[repo.id]?.trim()
    const baseBranch = requestedBase || repo.working_branch
    const worktreePath = path.join(workspacePath, repo.name)
    await createOrAttachWorktree(repoPath, worktreePath, branch, baseBranch)
    db.prepare(
      `INSERT INTO feature_repos(feature_id, repo_id, branch, base_branch, worktree_path)
       VALUES(?,?,?,?,?)`
    ).run(featureId, repo.id, branch, baseBranch, worktreePath)
    featureRepos.push({
      featureId,
      repoId: repo.id,
      repoOwner: repo.owner,
      repoName: repo.name,
      branch,
      baseBranch,
      worktreePath,
      prNumber: null,
      prUrl: null
    })
  }

  const feature = getFeature(featureId)!
  return { feature, featureRepos }
}

/**
 * Import an existing feature — attach to existing branches per repo, or create new ones.
 * `repos`: for each repo, either `{ existingBranch: 'foo' }` or `{ newBranch: 'foo' }`.
 */
export async function importFeature(opts: {
  projectId: number
  name: string
  repos: Array<{
    repoId: number
    existingBranch?: string
    newBranch?: string
    baseBranch?: string
  }>
}): Promise<{ feature: Feature; featureRepos: FeatureRepo[] }> {
  const slug = slugify(opts.name)
  if (!slug) throw new Error('Feature name cannot be empty')

  const db = getDb()
  const repoIds = opts.repos.map((r) => r.repoId)
  const repoRows = db
    .prepare(
      `SELECT id, owner, name, default_branch, local_path, COALESCE(working_branch, default_branch) AS working_branch
         FROM repos WHERE id IN (${repoIds.map(() => '?').join(',')})`
    )
    .all(...repoIds) as {
    id: number
    owner: string
    name: string
    default_branch: string
    local_path: string
    working_branch: string
  }[]
  const byId = new Map(repoRows.map((r) => [r.id, r]))

  const inserted = db
    .prepare(`INSERT INTO features(project_id, name, slug, workspace_path) VALUES(?,?,?,?)`)
    .run(opts.projectId, opts.name.trim(), slug, path.join(featuresRoot(), 'pending'))
  const featureId = Number(inserted.lastInsertRowid)
  const workspacePath = path.join(featuresRoot(), `${featureId}-${slug}`)
  fs.mkdirSync(workspacePath, { recursive: true })
  db.prepare('UPDATE features SET workspace_path = ? WHERE id = ?').run(workspacePath, featureId)

  const featureRepos: FeatureRepo[] = []
  for (const sel of opts.repos) {
    const repo = byId.get(sel.repoId)
    if (!repo) continue
    const repoPath = await ensureRepoCloned(repo.owner, repo.name)
    const baseBranch = sel.baseBranch || repo.working_branch
    const branch = sel.newBranch ?? sel.existingBranch
    if (!branch) throw new Error(`Missing branch selection for ${repo.name}`)
    const worktreePath = path.join(workspacePath, repo.name)
    if (sel.newBranch) {
      await createOrAttachWorktree(repoPath, worktreePath, branch, baseBranch)
    } else {
      await attachWorktreeToExisting(repoPath, worktreePath, branch)
    }
    db.prepare(
      `INSERT INTO feature_repos(feature_id, repo_id, branch, base_branch, worktree_path)
       VALUES(?,?,?,?,?)`
    ).run(featureId, repo.id, branch, baseBranch, worktreePath)
    featureRepos.push({
      featureId,
      repoId: repo.id,
      repoOwner: repo.owner,
      repoName: repo.name,
      branch,
      baseBranch,
      worktreePath,
      prNumber: null,
      prUrl: null
    })
  }

  const feature = getFeature(featureId)!
  return { feature, featureRepos }
}

export function deleteFeature(featureId: number) {
  const feature = getFeature(featureId)
  if (!feature) return
  // Remove worktrees gracefully via git; then nuke the workspace dir.
  const featureRepos = listFeatureRepos(featureId)
  for (const fr of featureRepos) {
    const r = getDb()
      .prepare('SELECT local_path FROM repos WHERE id = ?')
      .get(fr.repoId) as { local_path: string } | undefined
    if (!r) continue
    try {
      const git = simpleGit(r.local_path)
      git.raw(['worktree', 'remove', '--force', fr.worktreePath]).catch(() => {})
    } catch {
      // best effort
    }
  }
  try {
    if (fs.existsSync(feature.workspacePath))
      fs.rmSync(feature.workspacePath, { recursive: true, force: true })
  } catch {
    // ignore
  }
  getDb().prepare('DELETE FROM features WHERE id = ?').run(featureId)
}

// ── Session management ──────────────────────────────────────────────────────

function rowToSession(r: {
  id: number
  feature_id: number
  name: string
  engine: string | null
  cli_session_id: string | null
  created_at: string
  last_used_at: string | null
}): FeatureSession {
  return {
    id: r.id,
    featureId: r.feature_id,
    name: r.name,
    engine: (r.engine as Engine) ?? null,
    cliSessionId: r.cli_session_id,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at
  }
}

function querySessionRows(featureId: number): Parameters<typeof rowToSession>[0][] {
  return getDb()
    .prepare(
      `SELECT id, feature_id, name, engine, cli_session_id, created_at, last_used_at
         FROM feature_sessions
        WHERE feature_id = ?
        ORDER BY id ASC`
    )
    .all(featureId) as Parameters<typeof rowToSession>[0][]
}

/**
 * Lists sessions for a feature. If none exist yet, a default one is created and returned —
 * so the caller never has to deal with an empty list / race condition on first open.
 */
export function listSessions(featureId: number): FeatureSession[] {
  let rows = querySessionRows(featureId)
  if (rows.length === 0) {
    createSession(featureId, 'Session 1')
    rows = querySessionRows(featureId)
  }
  return rows.map(rowToSession)
}

export function getSession(sessionId: number): FeatureSession | null {
  const r = getDb()
    .prepare(
      `SELECT id, feature_id, name, engine, cli_session_id, created_at, last_used_at
         FROM feature_sessions WHERE id = ?`
    )
    .get(sessionId) as Parameters<typeof rowToSession>[0] | undefined
  return r ? rowToSession(r) : null
}

export function ensureDefaultSession(featureId: number): FeatureSession {
  const existing = listSessions(featureId)
  if (existing.length > 0) return existing[0]
  return createSession(featureId, 'Session 1')
}

export function createSession(featureId: number, name?: string): FeatureSession {
  const finalName = (name && name.trim()) || nextDefaultName(featureId)
  const r = getDb()
    .prepare(
      `INSERT INTO feature_sessions(feature_id, name, last_used_at)
       VALUES(?, ?, datetime('now'))`
    )
    .run(featureId, finalName)
  const sessionId = Number(r.lastInsertRowid)
  // Snapshot per-repo HEADs as the session's baseline so we can compute "changes during
  // this session" later. Synchronous via simple-git's raw call for setup speed.
  const featureRepos = listFeatureRepos(featureId)
  for (const fr of featureRepos) {
    try {
      const git = simpleGit(fr.worktreePath)
      // Fire-and-forget; baselines that fail to record just won't filter session-scope diffs.
      void git.revparse(['HEAD']).then((sha) => {
        const trimmed = sha.trim()
        if (!trimmed) return
        getDb()
          .prepare(
            'INSERT OR REPLACE INTO feature_session_baselines(session_id, repo_id, base_sha) VALUES(?,?,?)'
          )
          .run(sessionId, fr.repoId, trimmed)
      })
    } catch {
      // ignore — best effort
    }
  }
  return getSession(sessionId)!
}

export function getSessionBaselines(sessionId: number): Map<number, string> {
  const rows = getDb()
    .prepare('SELECT repo_id, base_sha FROM feature_session_baselines WHERE session_id = ?')
    .all(sessionId) as { repo_id: number; base_sha: string }[]
  return new Map(rows.map((r) => [r.repo_id, r.base_sha]))
}

export function renameSession(sessionId: number, name: string) {
  const n = name.trim().slice(0, 80) || 'Untitled'
  getDb().prepare('UPDATE feature_sessions SET name = ? WHERE id = ?').run(n, sessionId)
}

export function deleteSession(sessionId: number) {
  // Cascade: drop messages tied to this session first, then the session itself.
  getDb().prepare('DELETE FROM feature_messages WHERE session_id = ?').run(sessionId)
  getDb().prepare('DELETE FROM feature_sessions WHERE id = ?').run(sessionId)
}

export function touchSession(sessionId: number) {
  getDb()
    .prepare("UPDATE feature_sessions SET last_used_at = datetime('now') WHERE id = ?")
    .run(sessionId)
}

export function getSessionCli(
  sessionId: number,
  engine: Engine
): string | null {
  const r = getDb()
    .prepare(
      `SELECT cli_session_id FROM feature_sessions WHERE id = ? AND engine = ?`
    )
    .get(sessionId, engine) as { cli_session_id: string | null } | undefined
  return r?.cli_session_id ?? null
}

export function setSessionCli(sessionId: number, engine: Engine, cliSessionId: string) {
  getDb()
    .prepare('UPDATE feature_sessions SET engine = ?, cli_session_id = ? WHERE id = ?')
    .run(engine, cliSessionId, sessionId)
}

export function clearSessionCli(sessionId: number) {
  getDb()
    .prepare('UPDATE feature_sessions SET cli_session_id = NULL WHERE id = ?')
    .run(sessionId)
}

function nextDefaultName(featureId: number): string {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM feature_sessions WHERE feature_id = ?')
    .get(featureId) as { n: number }
  return `Session ${row.n + 1}`
}

export async function listRepoBranches(repoId: number): Promise<string[]> {
  const r = getDb()
    .prepare('SELECT owner, name, local_path FROM repos WHERE id = ?')
    .get(repoId) as { owner: string; name: string; local_path: string } | undefined
  if (!r) return []
  const repoPath = await ensureRepoCloned(r.owner, r.name)
  const git = simpleGit(repoPath)
  try {
    await git.fetch(['--prune'])
  } catch {
    // offline ok
  }
  const out = await git.branch(['-a'])
  const names = new Set<string>()
  for (const raw of out.all) {
    // Strip "remotes/origin/" prefixes; skip HEAD pointer.
    const m = raw.replace(/^\*\s+/, '').trim()
    if (m.endsWith('/HEAD')) continue
    if (m.startsWith('remotes/origin/')) names.add(m.slice('remotes/origin/'.length))
    else names.add(m)
  }
  return Array.from(names).sort()
}

async function createOrAttachWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  baseBranch: string
): Promise<void> {
  const git = simpleGit(repoPath)
  if (fs.existsSync(worktreePath)) {
    // already set up; trust it
    return
  }
  await git.fetch('origin', baseBranch).catch(() => {})
  // If branch already exists remotely, attach to it; otherwise create a new branch from base.
  const exists = await branchExists(repoPath, branch)
  if (exists) {
    await git.raw(['worktree', 'add', worktreePath, branch])
  } else {
    await git.raw(['worktree', 'add', '-b', branch, worktreePath, `origin/${baseBranch}`])
  }
}

async function attachWorktreeToExisting(
  repoPath: string,
  worktreePath: string,
  branch: string
): Promise<void> {
  const git = simpleGit(repoPath)
  if (fs.existsSync(worktreePath)) return
  await git.fetch('origin', branch).catch(() => {})
  await git.raw(['worktree', 'add', worktreePath, branch])
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  const git = simpleGit(repoPath)
  try {
    await git.revparse(['--verify', `refs/heads/${branch}`])
    return true
  } catch {
    // local miss; try remote
  }
  try {
    await git.revparse(['--verify', `refs/remotes/origin/${branch}`])
    return true
  } catch {
    return false
  }
}
