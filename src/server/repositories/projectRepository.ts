import type { DatabaseClient, SqlStatement } from '../../app/storage/types'
import type {
  Project,
  ProjectInput,
  Scenario,
  Version,
} from '../../shared/domain/types'

interface ProjectRow {
  id: string
  code: string | null
  name: string
  department_id: string
  start_period: string
  end_period: string
  status: Project['status']
  attributes_json: string | null
  draft_revision: number
  origin: Project['origin']
  dataset_id: string | null
  created_at: string
  updated_at: string
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

interface VersionRow {
  id: string
  code: string
  name: string
  status: Version['status']
  is_mutable: number
  origin: Version['origin']
  created_at: string
  updated_at: string
}

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    code: row.code ?? undefined,
    name: row.name,
    departmentId: row.department_id,
    startPeriod: row.start_period,
    endPeriod: row.end_period,
    status: row.status,
    attributesJson: row.attributes_json ?? undefined,
    draftRevision: row.draft_revision ?? 0,
    origin: row.origin,
    datasetId: row.dataset_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function scenarioFromRow(row: ScenarioRow): Scenario {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isDefault: Boolean(row.is_default),
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function versionFromRow(row: VersionRow): Version {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    isMutable: Boolean(row.is_mutable),
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function invalidProjectInput(message: string): never {
  throw Object.assign(new Error(message), { code: 'INVALID_REQUEST' })
}

export class ProjectRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(): Promise<Project[]> {
    return (
      await this.database.query<ProjectRow>(
        'SELECT * FROM dim_project ORDER BY updated_at DESC',
      )
    ).map(projectFromRow)
  }

  async get(id: string): Promise<Project | undefined> {
    const rows = await this.database.query<ProjectRow>(
      'SELECT * FROM dim_project WHERE id = ?',
      [id],
    )
    return rows[0] ? projectFromRow(rows[0]) : undefined
  }

  async listScenarios(): Promise<Scenario[]> {
    const rows = await this.database.query<ScenarioRow>(
      `SELECT * FROM dim_scenario
       ORDER BY is_default DESC, code`,
    )
    return rows.map(scenarioFromRow)
  }

  async listVersions(): Promise<Version[]> {
    const rows = await this.database.query<VersionRow>(
      `SELECT * FROM dim_version
       ORDER BY status, code`,
    )
    return rows.map(versionFromRow)
  }

  async save(input: ProjectInput, expectedRevision?: number): Promise<Project> {
    const name = input.name.trim()
    const departmentId = input.departmentId.trim()
    const startPeriod = input.startPeriod.trim()
    const endPeriod = input.endPeriod.trim()
    const code = input.code?.trim().toUpperCase() || undefined
    if (!name) invalidProjectInput('项目名称不能为空')
    if (!departmentId) invalidProjectInput('申报部门不能为空')
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startPeriod)) {
      invalidProjectInput('开始期间格式不正确')
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(endPeriod)) invalidProjectInput('结束期间格式不正确')
    if (endPeriod < startPeriod) invalidProjectInput('结束期间不能早于开始期间')

    const departments = await this.database.query<{ origin: string }>(
      'SELECT origin FROM dim_department WHERE id = ?',
      [departmentId],
    )
    if (departments.length === 0) invalidProjectInput('申报部门不存在')
    if (departments[0].origin !== 'user') {
      invalidProjectInput('真实项目必须引用用户维护的申报部门')
    }
    if (code) {
      const duplicate = await this.database.query<{ id: string }>(
        'SELECT id FROM dim_project WHERE code = ? AND id <> ?',
        [code, input.id ?? ''],
      )
      if (duplicate.length > 0) invalidProjectInput(`项目编码“${code}”已存在`)
    }

    const existing = input.id ? await this.get(input.id) : undefined
    if (
      expectedRevision !== undefined &&
      (existing?.draftRevision ?? 0) !== expectedRevision
    ) {
      const error = new Error('项目已在其他页面更新，请刷新后重试') as Error & {
        code?: string
        currentRevision?: number
      }
      error.code = 'REVISION_CONFLICT'
      error.currentRevision = existing?.draftRevision ?? 0
      throw error
    }
    const projectId = existing?.id ?? crypto.randomUUID()
    const now = new Date().toISOString()
    const project: Project = {
      id: projectId,
      code,
      name,
      departmentId,
      startPeriod,
      endPeriod,
      status: existing?.status ?? 'calculating',
      draftRevision: (existing?.draftRevision ?? 0) + 1,
      origin: 'user',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    if (
      existing &&
      (existing.startPeriod !== startPeriod ||
        existing.endPeriod !== endPeriod)
    ) {
      const periodConflicts = await this.database.query<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM cfg_model_line
         WHERE project_id = ?
           AND line_type = 'profit'
           AND (start_period < ? OR end_period > ?)`,
        [projectId, startPeriod, endPeriod],
      )
      if ((periodConflicts[0]?.count ?? 0) > 0) {
        invalidProjectInput('新项目周期无法覆盖已有预测行，请先调整行项目生效期间')
      }
    }
    const statements: SqlStatement[] = [
      {
        sql: `INSERT INTO dim_project (
          id, code, name, department_id, start_period, end_period,
          status, attributes_json, origin,
          dataset_id, created_at, updated_at, draft_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'user', NULL, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          code = excluded.code, name = excluded.name,
          department_id = excluded.department_id,
          start_period = excluded.start_period,
          end_period = excluded.end_period,
          updated_at = excluded.updated_at,
          draft_revision = excluded.draft_revision`,
        params: [
          project.id,
          project.code ?? null,
          project.name,
          project.departmentId,
          project.startPeriod,
          project.endPeriod,
          project.status,
          project.createdAt,
          project.updatedAt,
          project.draftRevision,
        ],
      },
    ]

    await this.database.batch(statements)
    return project
  }

  async archive(id: string): Promise<Project> {
    return this.setStatus(id, 'archived')
  }

  async restore(id: string): Promise<Project> {
    return this.setStatus(id, 'calculating')
  }

  async delete(id: string): Promise<void> {
    const project = await this.get(id)
    if (!project) throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' })
    await this.database.execute('DELETE FROM dim_project WHERE id = ?', [id])
  }

  private async setStatus(id: string, status: Project['status']): Promise<Project> {
    const project = await this.get(id)
    if (!project) throw new Error('项目不存在')
    const updatedAt = new Date().toISOString()
    await this.database.execute(
      'UPDATE dim_project SET status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, id],
    )
    return { ...project, status, updatedAt }
  }
}
