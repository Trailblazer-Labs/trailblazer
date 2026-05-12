import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button, Card, Pill } from './ui'
import { Modal } from './NewIssueModal'
import type { Issue, Repo } from '@shared/types'

export default function IssueDetailModal({
  issue,
  repo,
  onClose,
  onResolve,
  resolveDisabled
}: {
  issue: Issue
  repo: Repo
  onClose: () => void
  onResolve: () => void
  resolveDisabled?: boolean
}) {
  return (
    <Modal onClose={onClose}>
      <Card className="w-[820px] max-h-[85vh] flex flex-col">
        <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
              {repo.owner}/{repo.name} · #{issue.number}
            </div>
            <h2 className="text-lg leading-snug break-words">{issue.title}</h2>
            <div className="mt-2 flex items-center gap-2">
              <Pill tone={issue.state === 'open' ? 'open' : 'closed'}>{issue.state}</Pill>
              <a
                href={issue.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted hover:text-accent underline"
              >
                View on GitHub ↗
              </a>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-text text-lg leading-none px-1"
            aria-label="close"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-auto px-5 py-4">
          {issue.body && issue.body.trim() ? (
            <article className="tb-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{issue.body}</ReactMarkdown>
            </article>
          ) : (
            <div className="text-sm text-muted italic">No description.</div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
          <div className="text-[11px] text-muted">
            Updated {new Date(issue.updatedAt).toLocaleString()}
          </div>
          <div className="flex gap-2">
            <Button onClick={onClose}>Close</Button>
            <Button
              variant="primary"
              disabled={resolveDisabled}
              onClick={onResolve}
              title={resolveDisabled ? 'A run is already in progress' : ''}
            >
              Resolve issue
            </Button>
          </div>
        </footer>
      </Card>
    </Modal>
  )
}
