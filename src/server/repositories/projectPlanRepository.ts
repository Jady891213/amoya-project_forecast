import type { DatabaseClient, SqlStatement } from '../../shared/database'
import type { CreateProjectPlanRequest, ProjectPlan, ProjectPlanInput } from '../../shared/domain/types'

interface PlanRow {
  id: string
  project_id: string
  name: string
  start_period: string
  end_period: string
  status: ProjectPlan['status']
  sort_order: number
  draft_revision: number
  created_at: string
  updated_at: string
}

function fromRow(row: PlanRow): ProjectPlan {
  return {
    projectId: row.project_id,
    planId: row.id,
    name: row.name,
    startPeriod: row.start_period,
    endPeriod: row.end_period,
    status: row.status,
    sortOrder: row.sort_order,
    draftRevision: row.draft_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validate(input: ProjectPlanInput) {
  const name = input.name.trim()
  if (!name) throw Object.assign(new Error('方案名称不能为空'), { code: 'INVALID_REQUEST' })
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.startPeriod)) throw Object.assign(new Error('方案开始期间格式不正确'), { code: 'INVALID_REQUEST' })
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.endPeriod)) throw Object.assign(new Error('方案结束期间格式不正确'), { code: 'INVALID_REQUEST' })
  if (input.endPeriod < input.startPeriod) throw Object.assign(new Error('方案结束期间不能早于开始期间'), { code: 'INVALID_REQUEST' })
  return { name, startPeriod: input.startPeriod, endPeriod: input.endPeriod }
}

export class ProjectPlanRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listAll(): Promise<ProjectPlan[]> {
    return (await this.database.query<PlanRow>('SELECT * FROM dim_plan ORDER BY project_id, status, sort_order, created_at')).map(fromRow)
  }

  async list(projectId: string, includeArchived = true): Promise<ProjectPlan[]> {
    const rows = await this.database.query<PlanRow>(
      `SELECT * FROM dim_plan WHERE project_id = ? ${includeArchived ? '' : "AND status = 'active'"}
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, sort_order, created_at`,
      [projectId],
    )
    return rows.map(fromRow)
  }

  async get(projectId: string, planId: string): Promise<ProjectPlan | undefined> {
    const rows = await this.database.query<PlanRow>('SELECT * FROM dim_plan WHERE project_id = ? AND id = ?', [projectId, planId])
    return rows[0] ? fromRow(rows[0]) : undefined
  }

  async create(projectId: string, request: CreateProjectPlanRequest): Promise<ProjectPlan> {
    const input = validate(request)
    const duplicate = await this.database.query<{ id: string }>('SELECT id FROM dim_plan WHERE project_id = ? AND name = ?', [projectId, input.name])
    if (duplicate.length) throw Object.assign(new Error(`方案“${input.name}”已存在`), { code: 'INVALID_REQUEST' })
    const existing = await this.list(projectId)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await this.database.execute(
      `INSERT INTO dim_plan (id, project_id, name, start_period, end_period, status, sort_order, draft_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)`,
      [id, projectId, input.name, input.startPeriod, input.endPeriod, existing.length + 1, now, now],
    )
    return (await this.get(projectId, id))!
  }

  async update(projectId: string, planId: string, input: ProjectPlanInput): Promise<ProjectPlan> {
    const current = await this.get(projectId, planId)
    if (!current) throw Object.assign(new Error('项目方案不存在'), { code: 'NOT_FOUND' })
    const next = validate(input)
    const conflict = await this.database.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM cfg_model_line
       WHERE project_id = ? AND plan_id = ? AND line_type = 'profit' AND (start_period < ? OR end_period > ?)`,
      [projectId, planId, next.startPeriod, next.endPeriod],
    )
    if ((conflict[0]?.count ?? 0) > 0) throw Object.assign(new Error('新方案期间无法覆盖已有损益预测项'), { code: 'INVALID_REQUEST' })
    await this.database.execute(
      `UPDATE dim_plan SET name = ?, start_period = ?, end_period = ?, updated_at = ? WHERE project_id = ? AND id = ?`,
      [next.name, next.startPeriod, next.endPeriod, new Date().toISOString(), projectId, planId],
    )
    return (await this.get(projectId, planId))!
  }

  async archive(projectId: string, planId: string): Promise<ProjectPlan> {
    const current = await this.get(projectId, planId)
    if (!current) throw Object.assign(new Error('项目方案不存在'), { code: 'NOT_FOUND' })
    const active = (await this.list(projectId, false))
    if (active.length <= 1) throw Object.assign(new Error('项目必须至少保留一个有效方案'), { code: 'INVALID_REQUEST' })
    await this.database.execute("UPDATE dim_plan SET status = 'archived', updated_at = ? WHERE project_id = ? AND id = ?", [new Date().toISOString(), projectId, planId])
    return (await this.get(projectId, planId))!
  }

  async restore(projectId: string, planId: string): Promise<ProjectPlan> {
    const current = await this.get(projectId, planId)
    if (!current) throw Object.assign(new Error('项目方案不存在'), { code: 'NOT_FOUND' })
    await this.database.execute("UPDATE dim_plan SET status = 'active', updated_at = ? WHERE project_id = ? AND id = ?", [new Date().toISOString(), projectId, planId])
    return (await this.get(projectId, planId))!
  }

  async assertRevision(projectId: string, planId: string, expectedRevision: number): Promise<ProjectPlan> {
    const current = await this.get(projectId, planId)
    if (!current) throw Object.assign(new Error('项目方案不存在'), { code: 'NOT_FOUND' })
    if (current.draftRevision !== expectedRevision) throw Object.assign(new Error('当前方案已在其他页面更新，请刷新后重试'), { code: 'REVISION_CONFLICT', currentRevision: current.draftRevision })
    return current
  }

  incrementRevisionStatement(projectId: string, planId: string): SqlStatement {
    return { sql: 'UPDATE dim_plan SET draft_revision = draft_revision + 1, updated_at = ? WHERE project_id = ? AND id = ?', params: [new Date().toISOString(), projectId, planId] }
  }
}
