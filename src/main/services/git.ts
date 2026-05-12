import simpleGit, { SimpleGit } from 'simple-git'
import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import { kvGetSecret } from './db'
import type { DiffFile } from '@shared/types'

const PAT_KEY = 'github.pat'

export function reposRoot(): string {
  return path.join(app.getPath('userData'), 'repos')
}

export function worktreesRoot(): string {
  return path.join(app.getPath('userData'), 'worktrees')
}

function cloneUrl(owner: string, name: string): string {
  const pat = kvGetSecret(PAT_KEY)
  if (!pat) throw new Error('GitHub PAT not configured')
  return `https://x-access-token:${pat}@github.com/${owner}/${name}.git`
}

export async function ensureRepoCloned(owner: string, name: string): Promise<string> {
  const localPath = path.join(reposRoot(), `${owner}-${name}`)
  if (fs.existsSync(path.join(localPath, '.git')) || fs.existsSync(path.join(localPath, 'HEAD'))) {
    return localPath
  }
  fs.mkdirSync(reposRoot(), { recursive: true })
  const git = simpleGit()
  await git.clone(cloneUrl(owner, name), localPath)
  return localPath
}

export async function createWorktree(
  repoPath: string,
  branch: string,
  baseBranch: string
): Promise<string> {
  fs.mkdirSync(worktreesRoot(), { recursive: true })
  const wtPath = path.join(worktreesRoot(), branch.replace(/[^a-zA-Z0-9._-]+/g, '_'))
  if (fs.existsSync(wtPath)) {
    throw new Error(`worktree already exists at ${wtPath}`)
  }
  const git: SimpleGit = simpleGit(repoPath)
  await git.fetch('origin', baseBranch)
  await git.raw(['worktree', 'add', '-b', branch, wtPath, `origin/${baseBranch}`])
  return wtPath
}

export async function diffAgainstBase(
  worktreePath: string,
  baseBranch: string
): Promise<DiffFile[]> {
  const git = simpleGit(worktreePath)
  await git.fetch('origin', baseBranch)
  const summary = await git.diffSummary([`origin/${baseBranch}...HEAD`])
  const files: DiffFile[] = []
  for (const f of summary.files) {
    const patch = await git.diff([`origin/${baseBranch}...HEAD`, '--', f.file])
    const isBinary = 'binary' in f && (f as { binary: boolean }).binary
    files.push({
      path: f.file,
      status: 'modified',
      additions: isBinary ? 0 : (f as { insertions: number }).insertions ?? 0,
      deletions: isBinary ? 0 : (f as { deletions: number }).deletions ?? 0,
      patch: patch || null
    })
  }
  return files
}

export async function hasChanges(worktreePath: string): Promise<boolean> {
  const git = simpleGit(worktreePath)
  const status = await git.status()
  return !status.isClean()
}

export async function commitAll(worktreePath: string, message: string): Promise<void> {
  const git = simpleGit(worktreePath)
  await git.add(['-A'])
  await git.commit(message)
}

export async function pushBranch(worktreePath: string, branch: string): Promise<void> {
  const git = simpleGit(worktreePath)
  await git.push(['-u', 'origin', branch])
}

/**
 * Rewrite the `origin` remote URL with the current token. Cloned repos store the
 * token in their .git/config; without this, every push reuses the token that was
 * valid at clone time even if the user has since refreshed/rotated their gh token.
 */
export async function refreshRemoteUrl(
  worktreePath: string,
  owner: string,
  name: string
): Promise<void> {
  const git = simpleGit(worktreePath)
  try {
    await git.remote(['set-url', 'origin', cloneUrl(owner, name)])
  } catch {
    // best-effort — if remote doesn't exist or git errors, push will surface the real issue.
  }
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  const git = simpleGit(repoPath)
  try {
    await git.raw(['worktree', 'remove', '--force', worktreePath])
  } catch {
    if (fs.existsSync(worktreePath)) fs.rmSync(worktreePath, { recursive: true, force: true })
  }
}
