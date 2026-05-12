import { FireLogo } from './FireLogo'
import type { Engine, EngineDetection } from '@shared/types'

export default function EnginePicker({
  detect,
  selected,
  onSelect
}: {
  detect: EngineDetection | null
  selected: Engine | null
  onSelect: (e: Engine) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card
        title="Claude Code"
        subtitle="Anthropic's coding agent"
        found={detect?.claude.found}
        info={detect?.claude}
        installHint="npm i -g @anthropic-ai/claude-code"
        active={selected === 'claude'}
        onClick={() => detect?.claude.found && onSelect('claude')}
      >
        <FireLogo size={26} />
      </Card>
      <Card
        title="Codex CLI"
        subtitle="OpenAI's coding agent"
        found={detect?.codex.found}
        info={detect?.codex}
        installHint="npm i -g @openai/codex"
        active={selected === 'codex'}
        onClick={() => detect?.codex.found && onSelect('codex')}
      >
        <CodexMark />
      </Card>
    </div>
  )
}

function Card({
  title,
  subtitle,
  found,
  info,
  installHint,
  active,
  onClick,
  children
}: {
  title: string
  subtitle: string
  found?: boolean
  info?: { path?: string; version?: string }
  installHint: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  const disabled = !found
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        'text-left rounded-md p-3 border transition-colors min-h-[120px] ' +
        (active
          ? 'border-accent bg-[#1a1414]'
          : 'border-border bg-panel hover:bg-[#1d1d1d]') +
        (disabled ? ' opacity-60 cursor-not-allowed' : '')
      }
    >
      <div className="flex items-center gap-2 mb-2">
        {children}
        <div className="flex-1">
          <div className="text-sm">{title}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted">{subtitle}</div>
        </div>
        {active && <span className="text-accent text-sm">●</span>}
      </div>
      <div className="text-xs text-muted">
        {found
          ? `Detected${info?.version ? ` · ${info.version}` : ''}`
          : 'Not found'}
      </div>
      {!found && (
        <div className="mt-1 text-[10px] text-muted font-mono break-all">{installHint}</div>
      )}
    </button>
  )
}

function CodexMark() {
  return (
    <div className="w-7 h-7 rounded-md bg-[#0d0d0d] border border-border flex items-center justify-center">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2 L20 7 V17 L12 22 L4 17 V7 Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
