import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from './db'
import { listFeatureRepos } from './features'
import type { DevProfile, DevProfileInput, DevSetupState } from '@shared/types'

type ProfileRow = {
  id: number
  project_id: number
  name: string
  repo_id: number
  repo_name: string
  cwd: string
  setup_command: string | null
  dev_command: string
  env_json: string
  created_at: string
  updated_at: string
}

export function listProfiles(projectId: number): DevProfile[] {
  const rows = getDb()
    .prepare(
      `SELECT dp.id, dp.project_id, dp.name, dp.repo_id, r.name AS repo_name, dp.cwd,
              dp.setup_command, dp.dev_command, dp.env_json, dp.created_at, dp.updated_at
         FROM dev_profiles dp
         JOIN repos r ON r.id = dp.repo_id
        WHERE dp.project_id = ?
        ORDER BY dp.id ASC`
    )
    .all(projectId) as ProfileRow[]
  return rows.map(profileFromRow)
}

export function saveProfiles(projectId: number, profiles: DevProfileInput[]): DevProfile[] {
  const db = getDb()
  const clean = profiles
    .map((profile) => ({
      ...profile,
      name: profile.name.trim(),
      cwd: normalizeCwd(profile.cwd),
      setupCommand: profile.setupCommand?.trim() || null,
      devCommand: profile.devCommand.trim(),
      env: sanitizeEnv(profile.env)
    }))
    .filter((profile) => profile.name && profile.repoId && profile.devCommand)

  const tx = db.transaction(() => {
    const existing = db
      .prepare('SELECT id FROM dev_profiles WHERE project_id = ?')
      .all(projectId) as { id: number }[]
    const keepIds = new Set(clean.map((profile) => profile.id).filter((id): id is number => !!id))
    for (const row of existing) {
      if (!keepIds.has(row.id)) db.prepare('DELETE FROM dev_profiles WHERE id = ?').run(row.id)
    }

    for (const profile of clean) {
      if (profile.id && existing.some((row) => row.id === profile.id)) {
        db.prepare(
          `UPDATE dev_profiles
              SET name = ?, repo_id = ?, cwd = ?, setup_command = ?, dev_command = ?,
                  env_json = ?, updated_at = datetime('now')
            WHERE id = ? AND project_id = ?`
        ).run(
          profile.name,
          profile.repoId,
          profile.cwd,
          profile.setupCommand,
          profile.devCommand,
          JSON.stringify(profile.env),
          profile.id,
          projectId
        )
      } else {
        db.prepare(
          `INSERT INTO dev_profiles(project_id, name, repo_id, cwd, setup_command, dev_command, env_json)
           VALUES(?,?,?,?,?,?,?)`
        ).run(
          projectId,
          profile.name,
          profile.repoId,
          profile.cwd,
          profile.setupCommand,
          profile.devCommand,
          JSON.stringify(profile.env)
        )
      }
    }
  })
  tx()
  return listProfiles(projectId)
}

export function getProfile(profileId: number): DevProfile | null {
  const row = getDb()
    .prepare(
      `SELECT dp.id, dp.project_id, dp.name, dp.repo_id, r.name AS repo_name, dp.cwd,
              dp.setup_command, dp.dev_command, dp.env_json, dp.created_at, dp.updated_at
         FROM dev_profiles dp
         JOIN repos r ON r.id = dp.repo_id
        WHERE dp.id = ?`
    )
    .get(profileId) as ProfileRow | undefined
  return row ? profileFromRow(row) : null
}

export function getSetupState(featureId: number, profileId: number): DevSetupState {
  const profile = getProfile(profileId)
  if (!profile) throw new Error('dev profile not found')
  const hash = computeDependencyHash(featureId, profile)
  const row = getDb()
    .prepare(
      `SELECT dependency_hash, status, last_setup_at, exit_code, logs
         FROM dev_setup_state
        WHERE feature_id = ? AND profile_id = ?`
    )
    .get(featureId, profileId) as
    | {
        dependency_hash: string
        status: DevSetupState['status']
        last_setup_at: string | null
        exit_code: number | null
        logs: string
      }
    | undefined
  if (!row) {
    return {
      profileId,
      featureId,
      dependencyHash: hash,
      status: profile.setupCommand ? 'missing' : 'passed',
      lastSetupAt: null,
      exitCode: null,
      logs: ''
    }
  }
  return {
    profileId,
    featureId,
    dependencyHash: hash,
    status: row.dependency_hash === hash ? row.status : 'stale',
    lastSetupAt: row.last_setup_at,
    exitCode: row.exit_code,
    logs: row.logs
  }
}

export function upsertSetupState(args: {
  featureId: number
  profileId: number
  dependencyHash: string
  status: DevSetupState['status']
  exitCode?: number | null
  logs?: string
}) {
  getDb()
    .prepare(
      `INSERT INTO dev_setup_state(
        profile_id, feature_id, dependency_hash, status, last_setup_at, exit_code, logs
      ) VALUES(?,?,?,?,datetime('now'),?,?)
      ON CONFLICT(profile_id, feature_id) DO UPDATE SET
        dependency_hash = excluded.dependency_hash,
        status = excluded.status,
        last_setup_at = excluded.last_setup_at,
        exit_code = excluded.exit_code,
        logs = excluded.logs`
    )
    .run(
      args.profileId,
      args.featureId,
      args.dependencyHash,
      args.status,
      args.exitCode ?? null,
      args.logs ?? ''
    )
}

export function resolveProfileWorktree(featureId: number, profile: DevProfile) {
  const repo = listFeatureRepos(featureId).find((r) => r.repoId === profile.repoId)
  if (!repo) throw new Error(`${profile.repoName} is not attached to this feature`)
  return {
    repo,
    cwd: path.resolve(repo.worktreePath, normalizeCwd(profile.cwd)),
    workspaceRoot: path.dirname(repo.worktreePath)
  }
}

export function computeDependencyHash(featureId: number, profile: DevProfile): string {
  const { cwd } = resolveProfileWorktree(featureId, profile)
  const files = [
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
    'gradle.lockfile',
    'pom.xml',
    'pyproject.toml',
    'poetry.lock',
    'requirements.txt',
    'Cargo.toml',
    'Cargo.lock',
    'go.mod',
    'go.sum'
  ]
  const hash = createHash('sha256')
  hash.update(profile.setupCommand ?? '')
  hash.update(profile.devCommand)
  for (const file of files) {
    const p = path.join(cwd, file)
    if (!fs.existsSync(p)) continue
    hash.update(file)
    hash.update(fs.readFileSync(p))
  }
  return hash.digest('hex')
}

function profileFromRow(row: ProfileRow): DevProfile {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    repoId: row.repo_id,
    repoName: row.repo_name,
    cwd: row.cwd,
    setupCommand: row.setup_command,
    devCommand: row.dev_command,
    env: parseJson(row.env_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function normalizeCwd(value: string): string {
  const cwd = value.trim() || '.'
  if (path.isAbsolute(cwd)) throw new Error('cwd must be relative to the repo worktree')
  if (cwd.split(/[\\/]/).includes('..')) {
    throw new Error('cwd cannot contain parent directory segments')
  }
  return cwd
}

function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env ?? {})) {
    const k = key.trim()
    if (k) out[k] = String(value)
  }
  return out
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
