import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card } from '../components/ui'
import NewFeatureModal from '../components/NewFeatureModal'
import { FireLogo } from '../components/FireLogo'
import { useApp } from '../stores/app'
import type { Feature, Repo } from '@shared/types'

export default function FeaturesView({ projectId, repos }: { projectId: number; repos: Repo[] }) {
  const qc = useQueryClient()
  const setView = useApp((s) => s.setView)
  const { data: features = [] } = useQuery({
    queryKey: ['features', projectId],
    queryFn: () => window.api.features.list(projectId)
  })
  const [creating, setCreating] = useState(false)

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

        {features.length === 0 ? (
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f) => (
              <FeatureCard
                key={f.id}
                feature={f}
                onOpen={() => setView({ kind: 'feature', projectId, featureId: f.id })}
                onDelete={() => onDelete(f)}
              />
            ))}
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

function FeatureCard({
  feature,
  onOpen,
  onDelete
}: {
  feature: Feature
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <div
      onClick={onOpen}
      className="group relative rounded-xl border border-border bg-panel p-5 hover:border-accent/60 hover:bg-[#1a1414] transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-lg bg-[#1f1614] flex items-center justify-center border border-border">
          <FireLogo size={22} />
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
      <div className="text-base mb-1 truncate">{feature.name}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted">feature/{feature.slug}</div>
      <div className="mt-3 text-[10px] text-muted">
        Created {new Date(feature.createdAt).toLocaleDateString()}
      </div>
    </div>
  )
}
