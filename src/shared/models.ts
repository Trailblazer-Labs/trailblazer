import type { Engine } from './types'

export interface AgentModel {
  /** Value passed to the CLI's --model flag (or alias the CLI accepts). */
  id: string
  /** Human-readable name shown in the UI. */
  label: string
  /** Short description / use-case hint. */
  hint?: string
  /** Marked as default for this engine. */
  default?: boolean
}

/**
 * Curated lists. Both Claude Code and Codex accept aliases for their models in addition to
 * the fully versioned identifiers; we use the aliases so the lists don't rot when new
 * minor versions ship.
 *
 * Neither CLI exposes a "list models for this account" endpoint, so the catalog can drift
 * from what your auth actually permits (e.g. some codex models are API-key-only and won't
 * work with a ChatGPT account). The "Use CLI default" entry skips the --model flag entirely,
 * and users can type a custom model id via the picker as a fallback.
 */
export const AUTO_MODEL_ID = '__auto__'

export const MODELS: Record<Engine, AgentModel[]> = {
  claude: [
    { id: AUTO_MODEL_ID, label: 'Use CLI default', hint: 'Whatever claude picks', default: true },
    { id: 'opus', label: 'Claude Opus', hint: 'Most capable, slower' },
    { id: 'sonnet', label: 'Claude Sonnet', hint: 'Balanced' },
    { id: 'haiku', label: 'Claude Haiku', hint: 'Fast, cheap' }
  ],
  codex: [
    { id: AUTO_MODEL_ID, label: 'Use CLI default', hint: 'Whatever codex picks', default: true },
    { id: 'gpt-5', label: 'GPT-5', hint: 'Works with ChatGPT-account auth' },
    { id: 'o3', label: 'OpenAI o3', hint: 'Deep reasoning' },
    { id: 'gpt-4.1', label: 'GPT-4.1', hint: 'Older, faster' },
    { id: 'gpt-5-codex', label: 'GPT-5 Codex', hint: 'API-key auth only' }
  ]
}

/** Whether an id represents "don't pass --model and let the CLI pick". */
export function isAutoModel(id: string | undefined | null): boolean {
  return !id || id === AUTO_MODEL_ID
}

/** Merge curated catalog with dynamically-discovered model ids, deduped by id. */
export function mergedModels(
  engine: Engine,
  discovered: Array<{ id: string; label?: string }> | null | undefined
): AgentModel[] {
  const curated = MODELS[engine] ?? []
  if (!discovered || discovered.length === 0) return curated
  const seen = new Set(curated.map((m) => m.id))
  const extras: AgentModel[] = []
  for (const d of discovered) {
    if (!d.id || seen.has(d.id) || d.id === AUTO_MODEL_ID) continue
    seen.add(d.id)
    extras.push({ id: d.id, label: d.label ?? d.id })
  }
  return [...curated, ...extras]
}

export function defaultModelFor(engine: Engine): string {
  return MODELS[engine].find((m) => m.default)?.id ?? MODELS[engine][0]?.id ?? ''
}

export type ModelUseCase = 'issueExpand' | 'issueResolve' | 'feature'
