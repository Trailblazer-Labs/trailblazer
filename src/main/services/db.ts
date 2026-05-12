import Database from 'better-sqlite3'
import { app, safeStorage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  db = new Database(path.join(dir, 'trailblazer.db'))
  db.pragma('journal_mode = WAL')
  migrate(db)
  return db
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      local_path TEXT NOT NULL,
      UNIQUE(project_id, owner, name)
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      issue_repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      issue_number INTEGER NOT NULL,
      worktree_path TEXT NOT NULL,
      branch TEXT NOT NULL,
      status TEXT NOT NULL,
      pr_number INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS run_logs (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      stream TEXT NOT NULL,
      chunk TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      workspace_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, slug)
    );
    CREATE TABLE IF NOT EXISTS feature_repos (
      feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      branch TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      pr_number INTEGER,
      pr_url TEXT,
      PRIMARY KEY (feature_id, repo_id)
    );
    CREATE TABLE IF NOT EXISTS feature_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      activities TEXT,
      ts TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // Add per-repo working_branch column for the "issues working branch" setting.
  const repoCols = d.prepare('PRAGMA table_info(repos)').all() as { name: string }[]
  if (!repoCols.some((c) => c.name === 'working_branch')) {
    d.exec('ALTER TABLE repos ADD COLUMN working_branch TEXT')
  }

  // ─── feature_sessions: multiple sessions per feature ───────────────────────
  // Older builds stored one row per (feature_id, engine) with a composite PK and only
  // tracked the CLI session id. The new shape gives each session its own id, name,
  // and lifecycle so the user can have multiple parallel conversations per feature.
  const sessCols = d.prepare('PRAGMA table_info(feature_sessions)').all() as { name: string }[]
  const hasNewSessionShape = sessCols.some((c) => c.name === 'id') && sessCols.some((c) => c.name === 'name')
  if (sessCols.length > 0 && !hasNewSessionShape) {
    // Wipe legacy rows — they're tied to feature_messages without a session_id link anyway.
    d.exec('DROP TABLE feature_sessions')
  }
  d.exec(`
    CREATE TABLE IF NOT EXISTS feature_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      engine TEXT,
      cli_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS feature_sessions_feature_idx ON feature_sessions(feature_id);
    CREATE TABLE IF NOT EXISTS feature_session_baselines (
      session_id INTEGER NOT NULL REFERENCES feature_sessions(id) ON DELETE CASCADE,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      base_sha TEXT NOT NULL,
      PRIMARY KEY (session_id, repo_id)
    );
  `)

  // Add session_id column to feature_messages so each message belongs to a session.
  const msgCols = d.prepare('PRAGMA table_info(feature_messages)').all() as { name: string }[]
  if (!msgCols.some((c) => c.name === 'session_id')) {
    d.exec('ALTER TABLE feature_messages ADD COLUMN session_id INTEGER')
  }

  // Backfill: for any feature that has messages but no sessions yet, create a default
  // session and attribute pre-existing messages to it.
  const orphanFeatures = d
    .prepare(
      `SELECT DISTINCT m.feature_id AS feature_id
         FROM feature_messages m
        WHERE m.session_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM feature_sessions s WHERE s.feature_id = m.feature_id
          )`
    )
    .all() as { feature_id: number }[]
  for (const o of orphanFeatures) {
    const r = d
      .prepare(
        `INSERT INTO feature_sessions(feature_id, name, last_used_at)
         VALUES(?, 'Session 1', datetime('now'))`
      )
      .run(o.feature_id)
    const sessionId = Number(r.lastInsertRowid)
    d.prepare('UPDATE feature_messages SET session_id = ? WHERE feature_id = ? AND session_id IS NULL').run(
      sessionId,
      o.feature_id
    )
  }
}

// Encrypted KV helpers (Electron safeStorage). Falls back to plaintext on unsupported platforms.
export function kvSetSecret(key: string, value: string) {
  const d = getDb()
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value)
    : Buffer.from(value, 'utf8')
  d.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(
    key,
    buf
  )
}

export function kvGetSecret(key: string): string | null {
  const d = getDb()
  const row = d.prepare('SELECT v FROM kv WHERE k = ?').get(key) as { v: Buffer } | undefined
  if (!row) return null
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(row.v)
    } catch {
      return null
    }
  }
  return row.v.toString('utf8')
}

export function kvDelete(key: string) {
  getDb().prepare('DELETE FROM kv WHERE k = ?').run(key)
}
