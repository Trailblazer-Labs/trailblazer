import { Octokit } from '@octokit/rest'
import { kvGetSecret, kvSetSecret } from './db'
import type { Issue, PullRequest, RepoSearchResult, DiffFile } from '@shared/types'

const PAT_KEY = 'github.pat'

let cached: { token: string; client: Octokit } | null = null

export function setPat(token: string) {
  kvSetSecret(PAT_KEY, token)
  cached = null
}

export function hasPat(): boolean {
  return !!kvGetSecret(PAT_KEY)
}

export function octokit(): Octokit {
  const token = kvGetSecret(PAT_KEY)
  if (!token) throw new Error('GitHub PAT not configured')
  if (cached && cached.token === token) return cached.client
  cached = { token, client: new Octokit({ auth: token, userAgent: 'trailblazer/0.0.1' }) }
  return cached.client
}

export async function validatePat(token: string): Promise<{ login: string } | { error: string }> {
  try {
    const ok = new Octokit({ auth: token })
    const me = await ok.users.getAuthenticated()
    return { login: me.data.login }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'invalid token' }
  }
}

export async function searchRepos(q: string): Promise<RepoSearchResult[]> {
  const query = q.trim().toLowerCase()
  const repos = await octokit().paginate(octokit().repos.listForAuthenticatedUser, {
    per_page: 100,
    sort: 'updated',
    affiliation: 'owner,collaborator,organization_member'
  })
  return repos
    .filter((r) => {
      if (!query) return true
      return (
        r.name.toLowerCase().includes(query) ||
        r.full_name.toLowerCase().includes(query) ||
        r.owner?.login.toLowerCase().includes(query) ||
        (r.description ?? '').toLowerCase().includes(query)
      )
    })
    .slice(0, query ? 50 : 30)
    .map((r) => ({
    owner: r.owner!.login,
    name: r.name,
    fullName: r.full_name,
    defaultBranch: r.default_branch ?? 'main',
    description: r.description,
    private: r.private
    }))
}

const PER_PAGE = 50

export async function listIssues(
  owner: string,
  repo: string,
  page = 1
): Promise<{ items: Omit<Issue, 'id' | 'repoId'>[]; hasMore: boolean }> {
  const res = await octokit().issues.listForRepo({
    owner,
    repo,
    state: 'open',
    per_page: PER_PAGE,
    page,
    sort: 'updated',
    direction: 'desc'
  })
  const items = res.data
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body ?? null,
      state: i.state as 'open' | 'closed',
      url: i.html_url,
      updatedAt: i.updated_at
    }))
  // hasMore is based on the raw response length, not filtered length —
  // the endpoint returns issues+PRs in one stream.
  return { items, hasMore: res.data.length === PER_PAGE }
}

export async function createIssue(
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
}> {
  const res = await octokit().issues.create({ owner, repo, title, body })
  return {
    number: res.data.number,
    title: res.data.title,
    body: res.data.body ?? null,
    state: res.data.state as 'open' | 'closed',
    url: res.data.html_url,
    updatedAt: res.data.updated_at
  }
}

export async function closeIssue(owner: string, repo: string, number: number): Promise<void> {
  await octokit().issues.update({ owner, repo, issue_number: number, state: 'closed' })
}

export async function listPulls(
  owner: string,
  repo: string,
  page = 1
): Promise<{ items: Omit<PullRequest, 'id' | 'repoId'>[]; hasMore: boolean }> {
  const res = await octokit().pulls.list({
    owner,
    repo,
    state: 'all',
    per_page: PER_PAGE,
    page,
    sort: 'updated',
    direction: 'desc'
  })
  const items = res.data.map((p) => {
    const linked = parseClosesIssueNumber(p.body ?? '')
    const state: 'open' | 'closed' | 'merged' = p.merged_at ? 'merged' : (p.state as 'open' | 'closed')
    return {
      number: p.number,
      title: p.title,
      state,
      url: p.html_url,
      headBranch: p.head.ref,
      baseBranch: p.base.ref,
      linkedIssueNumber: linked,
      updatedAt: p.updated_at
    }
  })
  return { items, hasMore: res.data.length === PER_PAGE }
}

export async function getPullDetail(owner: string, repo: string, number: number) {
  const [pr, files] = await Promise.all([
    octokit().pulls.get({ owner, repo, pull_number: number }),
    octokit().pulls.listFiles({ owner, repo, pull_number: number, per_page: 300 })
  ])
  const diffFiles: DiffFile[] = files.data.map((f) => ({
    path: f.filename,
    status: (f.status as DiffFile['status']) ?? 'modified',
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch ?? null
  }))
  return {
    number: pr.data.number,
    title: pr.data.title,
    body: pr.data.body ?? '',
    state: pr.data.merged ? 'merged' : (pr.data.state as 'open' | 'closed'),
    mergeable: pr.data.mergeable,
    files: diffFiles
  }
}

export async function mergePull(
  owner: string,
  repo: string,
  number: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash'
) {
  const res = await octokit().pulls.merge({ owner, repo, pull_number: number, merge_method: method })
  return { merged: res.data.merged, sha: res.data.sha }
}

export async function closePull(owner: string, repo: string, number: number) {
  await octokit().pulls.update({ owner, repo, pull_number: number, state: 'closed' })
}

export async function createPull(
  owner: string,
  repo: string,
  opts: { title: string; body: string; head: string; base: string }
) {
  const res = await octokit().pulls.create({ owner, repo, ...opts })
  return { number: res.data.number, url: res.data.html_url }
}

function parseClosesIssueNumber(body: string): number | null {
  const m = body.match(/\b(?:closes|fixes|resolves)\s+(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#(\d+)/i)
  return m ? parseInt(m[1], 10) : null
}
