export interface Project {
  id: number
  name: string
  createdAt: string
}

export interface Repo {
  id: number
  projectId: number
  owner: string
  name: string
  defaultBranch: string
  localPath: string
  workingBranch: string | null
}

export interface Feature {
  id: number
  projectId: number
  name: string
  slug: string
  status: 'active' | 'archived' | 'merged'
  workspacePath: string
  createdAt: string
}

export interface FeatureRepo {
  featureId: number
  repoId: number
  repoOwner: string
  repoName: string
  branch: string
  baseBranch: string
  worktreePath: string
  prNumber: number | null
  prUrl: string | null
}

export interface FeatureSession {
  id: number
  featureId: number
  name: string
  engine: Engine | null
  cliSessionId: string | null
  createdAt: string
  lastUsedAt: string | null
}

export interface FeatureMessage {
  id: number
  featureId: number
  sessionId: number | null
  role: 'user' | 'assistant' | 'system'
  content: string
  activities: AgentActivity[] | null
  ts: string
}

export type FeatureRunEvent =
  | { type: 'start'; featureId: number; engine: Engine; userMessageId: number }
  | { type: 'activity'; featureId: number; activity: AgentActivity }
  | {
      type: 'done'
      featureId: number
      assistantMessageId: number
      perRepo: Array<{
        repoId: number
        repoName: string
        branch: string
        commitsAdded: number
        filesChanged: number
        hasUncommitted: boolean
      }>
    }
  | { type: 'error'; featureId: number; message: string }

export interface FeatureChangedFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  patch: string | null
  state: 'committed' | 'uncommitted'
}

export interface FeatureRepoChanges {
  repoId: number
  repoName: string
  branch: string
  baseBranch: string
  commitsAhead: number
  hasUncommitted: boolean
  prNumber: number | null
  prUrl: string | null
  files: FeatureChangedFile[]
}

export interface FeatureCommitResult {
  repoId: number
  repoName: string
  status: 'committed' | 'clean' | 'failed'
  sha?: string
  filesCommitted?: number
  error?: string
}

export interface PRCreateResult {
  repoId: number
  repoName: string
  branch: string
  status: 'opened' | 'existing' | 'skipped'
  prNumber?: number
  prUrl?: string
  reason?: string
}

export interface Issue {
  id: number
  repoId: number
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  url: string
  updatedAt: string
}

export interface PullRequest {
  id: number
  repoId: number
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  url: string
  headBranch: string
  baseBranch: string
  linkedIssueNumber: number | null
  updatedAt: string
}

export interface Run {
  id: string
  issueId: number
  repoId: number
  worktreePath: string
  branch: string
  status: 'pending' | 'running' | 'awaiting-approval' | 'pushed' | 'failed' | 'cancelled'
  prNumber: number | null
  startedAt: string
  endedAt: string | null
}

export type Engine = 'claude' | 'codex'

export interface EngineDetection {
  claude: { found: boolean; path?: string; version?: string }
  codex: { found: boolean; path?: string; version?: string }
}

export interface AppConfig {
  githubPatConfigured: boolean
  engineConfigured: boolean
  engine: Engine | null
  authMode: 'gh' | 'pat' | null
  ghLogin: string | null
}

export interface UpdateStatus {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'disabled'
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  percent: number | null
  message: string | null
  checkedAt: string | null
}

export type ExpandEvent =
  | { type: 'start'; engine: Engine }
  | { type: 'chunk'; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'activity'; activity: AgentActivity }
  | { type: 'done' }
  | { type: 'error'; message: string }

export type GhAuthEvent =
  | { type: 'code'; code: string; url: string }
  | { type: 'progress'; message: string }
  | { type: 'done'; login: string }
  | { type: 'error'; message: string }

export interface RepoSearchResult {
  owner: string
  name: string
  fullName: string
  defaultBranch: string
  description: string | null
  private: boolean
}

export interface DiffFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  patch: string | null
}

export interface AgentActivity {
  id: string
  kind: 'message' | 'tool' | 'thinking' | 'error' | 'final' | 'system'
  tool?: string
  label: string
  detail?: string
  status?: 'running' | 'done' | 'failed'
  ts: number
}

export type RunEvent =
  | { type: 'log'; runId: string; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'activity'; runId: string; activity: AgentActivity }
  | { type: 'status'; runId: string; status: Run['status'] }
  | { type: 'diff-ready'; runId: string; files: DiffFile[] }
  | { type: 'pr-created'; runId: string; prNumber: number; url: string }
  | { type: 'error'; runId: string; message: string }
