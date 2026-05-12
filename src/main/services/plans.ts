import { getDb } from './db'
import type { Plan } from '@shared/types'

type PlanRow = {
  id: number
  project_id: number
  title: string
  content: string
  created_at: string
  updated_at: string
}

function toPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listPlans(projectId: number): Plan[] {
  const rows = getDb()
    .prepare(
      `SELECT id, project_id, title, content, created_at, updated_at
         FROM plans
        WHERE project_id = ?
        ORDER BY updated_at DESC, id DESC`
    )
    .all(projectId) as PlanRow[]
  return rows.map(toPlan)
}

export function getPlan(planId: number): Plan | null {
  const row = getDb()
    .prepare(
      `SELECT id, project_id, title, content, created_at, updated_at
         FROM plans
        WHERE id = ?`
    )
    .get(planId) as PlanRow | undefined
  return row ? toPlan(row) : null
}

export function createPlan(projectId: number, title?: string): Plan {
  const cleanTitle = title?.trim() || 'Untitled plan'
  const starter = `# ${cleanTitle}

## Goal

## Scope

## Decisions

## Open questions

## Implementation notes
`
  const result = getDb()
    .prepare('INSERT INTO plans(project_id, title, content) VALUES(?,?,?)')
    .run(projectId, cleanTitle, starter)
  return getPlan(Number(result.lastInsertRowid))!
}

export function updatePlan(
  planId: number,
  patch: { title?: string; content?: string }
): Plan {
  const existing = getPlan(planId)
  if (!existing) throw new Error('Plan not found')

  const title = patch.title === undefined ? existing.title : patch.title.trim() || 'Untitled plan'
  const content = patch.content === undefined ? existing.content : patch.content
  getDb()
    .prepare(
      `UPDATE plans
          SET title = ?,
              content = ?,
              updated_at = datetime('now')
        WHERE id = ?`
    )
    .run(title, content, planId)

  return getPlan(planId)!
}

export function deletePlan(planId: number) {
  getDb().prepare('DELETE FROM plans WHERE id = ?').run(planId)
}
