import type { Engine, Feature, FeatureSession } from '@shared/types'

export function buildResumeCommand(args: {
  feature: Feature
  session?: FeatureSession | null
  engine?: Engine | null
}): string {
  const engine = args.engine ?? args.session?.engine ?? 'claude'
  const cd = `cd ${shellQuote(args.feature.workspacePath)}`
  const resume = args.session?.cliSessionId
  if (!resume) return `${cd} && ${engine}`
  return `${cd} && ${engine} --resume ${shellQuote(resume)}`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
