import { defaultModelFor } from '@shared/models'
import type { ModelUseCase } from '@shared/models'
import type { Engine, Project } from '@shared/types'
import { getDb } from './db'
import { getEngine } from './engine'
import { getModel } from './modelPrefs'

export type ProjectRow = {
  id: number
  name: string
  created_at: string
  assistant_engine: string | null
  feature_model: string | null
  issue_expand_model: string | null
  issue_resolve_model: string | null
}

export type ProjectSettingsPatch = {
  assistantEngine?: Engine | null
  featureModel?: string | null
  issueExpandModel?: string | null
  issueResolveModel?: string | null
}

export function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    assistantEngine: row.assistant_engine as Engine | null,
    featureModel: row.feature_model,
    issueExpandModel: row.issue_expand_model,
    issueResolveModel: row.issue_resolve_model
  }
}

export function getProject(projectId: number): Project | null {
  const row = getDb()
    .prepare(
      `SELECT id, name, created_at, assistant_engine, feature_model, issue_expand_model, issue_resolve_model
         FROM projects
        WHERE id = ?`
    )
    .get(projectId) as ProjectRow | undefined
  return row ? projectFromRow(row) : null
}

export function listProjects(): Project[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, created_at, assistant_engine, feature_model, issue_expand_model, issue_resolve_model
         FROM projects
        ORDER BY id DESC`
    )
    .all() as ProjectRow[]
  return rows.map(projectFromRow)
}

export function updateProjectSettings(projectId: number, patch: ProjectSettingsPatch): Project {
  const current = getProject(projectId)
  if (!current) throw new Error('project not found')
  const next = {
    assistantEngine: patch.assistantEngine ?? current.assistantEngine,
    featureModel: patch.featureModel === undefined ? current.featureModel : patch.featureModel,
    issueExpandModel:
      patch.issueExpandModel === undefined ? current.issueExpandModel : patch.issueExpandModel,
    issueResolveModel:
      patch.issueResolveModel === undefined ? current.issueResolveModel : patch.issueResolveModel
  }
  getDb()
    .prepare(
      `UPDATE projects
          SET assistant_engine = ?,
              feature_model = ?,
              issue_expand_model = ?,
              issue_resolve_model = ?
        WHERE id = ?`
    )
    .run(
      next.assistantEngine,
      next.featureModel,
      next.issueExpandModel,
      next.issueResolveModel,
      projectId
    )
  return getProject(projectId)!
}

export function setProjectModel(projectId: number, useCase: ModelUseCase, modelId: string) {
  const column =
    useCase === 'feature'
      ? 'feature_model'
      : useCase === 'issueExpand'
        ? 'issue_expand_model'
        : 'issue_resolve_model'
  getDb().prepare(`UPDATE projects SET ${column} = ? WHERE id = ?`).run(modelId, projectId)
}

export function resolveProjectAgent(
  projectId: number,
  useCase: ModelUseCase,
  overrideModel?: string
): { engine: Engine; model: string } {
  const project = getProject(projectId)
  if (!project) throw new Error('project not found')
  const engine = project.assistantEngine ?? getEngine()
  if (!engine) throw new Error('No assistant configured for this project')
  const projectModel =
    useCase === 'feature'
      ? project.featureModel
      : useCase === 'issueExpand'
        ? project.issueExpandModel
        : project.issueResolveModel
  return {
    engine,
    model: overrideModel || projectModel || getModel(useCase, engine) || defaultModelFor(engine)
  }
}

export function getProjectIdForRepo(repoId: number): number {
  const row = getDb()
    .prepare('SELECT project_id FROM repos WHERE id = ?')
    .get(repoId) as { project_id: number } | undefined
  if (!row) throw new Error('repo not found')
  return row.project_id
}
