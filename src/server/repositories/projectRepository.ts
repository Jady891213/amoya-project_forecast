import type { DatabaseClient } from '../../shared/database'
import type { Project, ProjectInput, Scenario } from '../../shared/domain/types'
import { nextProjectCode } from '../../shared/domain/projectCode'

interface ProjectRow {
  id: string
  code: string | null
  name: string
  department_id: string
  status: Project['status']
  attributes_json: string | null
  origin: Project['origin']
  dataset_id: string | null
  created_at: string
  updated_at: string
  start_period: string | null
  end_period: string | null
  draft_revision: number | null
  plan_count: number | null
}

interface ScenarioRow {
  id: string
  code: string
  name: string
  is_default: number
  origin: Scenario['origin']
  created_at: string
  updated_at: string
}

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    code: row.code ?? undefined,
    name: row.name,
    departmentId: row.department_id,
    status: row.status,
    startPeriod: row.start_period ?? '',
    endPeriod: row.end_period ?? '',
    draftRevision: row.draft_revision ?? 0,
    planCount: row.plan_count ?? 0,
    attributesJson: row.attributes_json ?? undefined,
    origin: row.origin,
    datasetId: row.dataset_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function scenarioFromRow(row: ScenarioRow): Scenario {
  return { id: row.id, code: row.code, name: row.name, isDefault: Boolean(row.is_default), origin: row.origin, createdAt: row.created_at, updatedAt: row.updated_at }
}

function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: 'INVALID_REQUEST' })
}

export class ProjectRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(): Promise<Project[]> {
    return (await this.database.query<ProjectRow>(`SELECT p.*, pl.start_period, pl.end_period, pl.draft_revision,
      (SELECT COUNT(*) FROM dim_plan pc WHERE pc.project_id = p.id AND pc.status = 'active') AS plan_count
      FROM dim_project p LEFT JOIN dim_plan pl ON pl.id = (
        SELECT fp.id FROM dim_plan fp WHERE fp.project_id = p.id AND fp.status = 'active'
        ORDER BY fp.sort_order, fp.created_at, fp.id LIMIT 1
      )
      ORDER BY p.updated_at DESC`)).map(projectFromRow)
  }

  async get(id: string): Promise<Project | undefined> {
    const rows = await this.database.query<ProjectRow>(`SELECT p.*, pl.start_period, pl.end_period, pl.draft_revision,
      (SELECT COUNT(*) FROM dim_plan pc WHERE pc.project_id = p.id AND pc.status = 'active') AS plan_count
      FROM dim_project p LEFT JOIN dim_plan pl ON pl.id = (
        SELECT fp.id FROM dim_plan fp WHERE fp.project_id = p.id AND fp.status = 'active'
        ORDER BY fp.sort_order, fp.created_at, fp.id LIMIT 1
      )
      WHERE p.id = ?`, [id])
    return rows[0] ? projectFromRow(rows[0]) : undefined
  }

  async listScenarios(): Promise<Scenario[]> {
    return (await this.database.query<ScenarioRow>('SELECT * FROM dim_scenario ORDER BY is_default DESC, code')).map(scenarioFromRow)
  }

  async save(input: Pick<ProjectInput, 'id' | 'code' | 'name' | 'departmentId'> & Partial<Pick<ProjectInput, 'startPeriod' | 'endPeriod'>>): Promise<Project> {
    const name = input.name.trim()
    const departmentId = input.departmentId.trim()
    let code = input.code?.trim().toUpperCase() || undefined
    if (!name) invalid('项目名称不能为空')
    if (!departmentId) invalid('申报部门不能为空')
    const departments = await this.database.query<{ origin: string }>('SELECT origin FROM dim_department WHERE id = ?', [departmentId])
    if (!departments.length) invalid('申报部门不存在')
    if (departments[0].origin !== 'user') invalid('真实项目必须引用用户维护的申报部门')
    if (!input.id && !code) {
      const existingCodes = await this.database.query<{ code: string | null }>('SELECT code FROM dim_project')
      code = nextProjectCode(existingCodes.map((item) => item.code ?? undefined))
    }
    if (code) {
      const duplicate = await this.database.query<{ id: string }>('SELECT id FROM dim_project WHERE code = ? AND id <> ?', [code, input.id ?? ''])
      if (duplicate.length) invalid(`项目编码“${code}”已存在`)
    }
    const existing = input.id ? await this.get(input.id) : undefined
    const id = existing?.id ?? crypto.randomUUID()
    const now = new Date().toISOString()
    await this.database.execute(
      `INSERT INTO dim_project (id, code, name, department_id, status, attributes_json, origin, dataset_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'user', NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name, department_id = excluded.department_id, updated_at = excluded.updated_at`,
      [id, code ?? null, name, departmentId, existing?.status ?? 'calculating', existing?.createdAt ?? now, now],
    )
    return (await this.get(id))!
  }

  async archive(id: string): Promise<Project> { return this.setStatus(id, 'archived') }
  async restore(id: string): Promise<Project> { return this.setStatus(id, 'calculating') }

  async delete(id: string): Promise<void> {
    if (!await this.get(id)) throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' })
    await this.database.execute('DELETE FROM dim_project WHERE id = ?', [id])
  }

  private async setStatus(id: string, status: Project['status']): Promise<Project> {
    const project = await this.get(id)
    if (!project) throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' })
    await this.database.execute('UPDATE dim_project SET status = ?, updated_at = ? WHERE id = ?', [status, new Date().toISOString(), id])
    return (await this.get(id))!
  }
}
