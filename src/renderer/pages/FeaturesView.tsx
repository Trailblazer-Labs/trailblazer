import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Pill } from '../components/ui'
import NewFeatureModal from '../components/NewFeatureModal'
import { FireLogo } from '../components/FireLogo'
import { useApp } from '../stores/app'
import type { Feature, Repo } from '@shared/types'

export default function FeaturesView({ projectId, repos }: { projectId: number; repos: Repo[] }) {
  const qc = useQueryClient()
  const setView = useApp((s) => s.setView)
  const { data: features = [], isLoading } = useQuery({
    queryKey: ['features', projectId],
    queryFn: () => window.api.features.list(projectId)
  })
  const { data: activeFeatureIds = [] } = useQuery<number[]>({
    queryKey: ['active-features', projectId],
    queryFn: () => window.api.features.listActive(projectId),
    refetchInterval: 1500
  })
  const [creating, setCreating] = useState(false)
  const { openFeatures, closedFeatures } = useMemo(() => {
    const open: Feature[] = []
    const closed: Feature[] = []
    for (const feature of features) {
      if (isFeatureClosed(feature)) closed.push(feature)
      else open.push(feature)
    }
    return { openFeatures: open, closedFeatures: closed }
  }, [features])

  function onCreated(f: Feature) {
    void qc.invalidateQueries({ queryKey: ['features', projectId] })
    setCreating(false)
    setView({ kind: 'feature', projectId, featureId: f.id })
  }

  async function onDelete(f: Feature) {
    if (!confirm(`Delete feature "${f.name}"? Worktrees will be removed; branches remain on disk.`))
      return
    await window.api.features.delete(f.id)
    void qc.invalidateQueries({ queryKey: ['features', projectId] })
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto px-8 py-6">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="font-brand text-xl mb-1">Features</h2>
            <p className="text-xs text-muted">
              Group changes across multiple repos. Each feature has its own branches and an agent
              chat.
            </p>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New feature
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-36 rounded-xl border border-border bg-panel/70 animate-pulse"
              />
            ))}
          </div>
        ) : features.length === 0 ? (
          <Card className="p-10 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#1f1614] border border-border mb-4">
              <FireLogo size={36} />
            </div>
            <h3 className="text-base mb-1">No features yet</h3>
            <p className="text-xs text-muted max-w-md mx-auto mb-5">
              Start a new feature to spin up branches across selected repos, or import an
              in-progress branch you already have.
            </p>
            <Button variant="primary" onClick={() => setCreating(true)}>
              + New feature
            </Button>
          </Card>
        ) : (
          <div className="space-y-6">
            <FeatureSection title="Open features" count={openFeatures.length} empty="No open features.">
              {openFeatures.map((f) => (
                <FeatureCard
                  key={f.id}
                  feature={f}
                  working={activeFeatureIds.includes(f.id)}
                  onOpen={() => setView({ kind: 'feature', projectId, featureId: f.id })}
                  onDelete={() => onDelete(f)}
                />
              ))}
            </FeatureSection>
            <FeatureSection title="Closed features" count={closedFeatures.length} empty="No closed features yet.">
              {closedFeatures.map((f) => (
                <FeatureCard
                  key={f.id}
                  feature={f}
                  working={activeFeatureIds.includes(f.id)}
                  onOpen={() => setView({ kind: 'feature', projectId, featureId: f.id })}
                  onDelete={() => onDelete(f)}
                />
              ))}
            </FeatureSection>
          </div>
        )}
      </div>

      {creating && (
        <NewFeatureModal
          projectId={projectId}
          repos={repos}
          onClose={() => setCreating(false)}
          onCreated={onCreated}
        />
      )}
    </div>
  )
}

function FeatureSection({
  title,
  count,
  empty,
  children
}: {
  title: string
  count: number
  empty?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted tabular-nums">{count}</span>
      </div>
      {count === 0 && empty ? (
        <div className="rounded-lg border border-border bg-panel/50 px-4 py-3 text-xs text-muted">
          {empty}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
      )}
    </section>
  )
}

function isFeatureClosed(feature: Feature): boolean {
  const repoCount = feature.repoCount ?? 0
  return repoCount > 0 && feature.mergedRepoCount === repoCount
}

function isFeaturePartial(feature: Feature): boolean {
  return !isFeatureClosed(feature) && (feature.mergedRepoCount ?? 0) > 0
}

function FeatureCard({
  feature,
  working,
  onOpen,
  onDelete
}: {
  feature: Feature
  working: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <div
      onClick={onOpen}
      className="group relative rounded-xl border border-border bg-panel p-5 hover:border-accent/60 hover:bg-[#1a1414] transition-colors cursor-pointer"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#1f1614] flex items-center justify-center border border-border shrink-0">
            <FireLogo size={22} />
          </div>
          <div className="min-w-0">
            <div className="text-base truncate">{feature.name}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted truncate">
              feature/{feature.slug}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {working && <Pill tone="running">Working</Pill>}
          {isFeatureClosed(feature) && <Pill tone="merged">Closed</Pill>}
          {isFeaturePartial(feature) && <Pill tone="open">Partial</Pill>}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="text-muted hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="delete feature"
        >
          Delete
        </button>
      </div>
      {(feature.repoCount ?? 0) > 0 && (
        <div className="mt-2 text-[10px] text-muted">
          {feature.mergedRepoCount ?? 0}/{feature.repoCount} repo PRs merged
        </div>
      )}
      <div className="mt-3 text-[10px] text-muted">
        Created {new Date(feature.createdAt).toLocaleDateString()}
      </div>
    </div>
  )
}
