import type { DatabaseClient, SqlStatement } from '../storage/types'
import type {
  Project,
  ProjectInput,
  ProjectModule,
  Scenario,
  Version,
} from '../domain/types'

interface ProjectRow {
  id: string
  code: string | null
  name: string
  customer: string
  department_id: string
  owner: string
  start_period: string
  duration_months: number
  status: Project['status']
  remark: string
  attributes_json: string | null
  origin: Project['origin']
  dataset_id: string | null
  created_at: string
  updated_at: string
}

interface ModuleRow {
  id: string
  project_id: string
  code: string
  name: string
  is_common: number
  origin: ProjectModule['origin']
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
    customer: row.customer,
    departmentId: row.department_id,
    owner: row.owner,
    startPeriod: row.start_period,
    durationMonths: row.duration_months,
    status: row.status,
    remark: row.remark,
    attributesJson: row.attributes_json ?? undefined,
    origin: row.origin,
    datasetId: row.dataset_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function moduleFromRow(row: ModuleRow): ProjectModule {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    isCommon: Boolean(row.is_common),
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

function normalizeModules(modules: ProjectInput['modules']) {
  const seen = new Set<string>(['PUBLIC'])
  return modules
    .map((module) => ({
      code: module.code.trim().toUpperCase(),
      name: module.name.trim(),
    }))
    .filter((module) => module.code && module.name && module.code !== 'PUBLIC')
    .filter((module) => {
      if (seen.has(module.code)) return false
      seen.add(module.code)
      return true
    })
}

function endPeriod(startPeriod: string, durationMonths: number) {
  const [year, month] = startPeriod.split('-').map(Number)
  const date = new Date(year, month - 1 + durationMonths - 1, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
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

  async listModules(projectId: string): Promise<ProjectModule[]> {
    return (
      await this.database.query<ModuleRow>(
        `SELECT * FROM dim_business_module
         WHERE project_id = ?
         ORDER BY is_common DESC, code`,
        [projectId],
      )
    ).map(moduleFromRow)
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

  async save(input: ProjectInput): Promise<Project> {
    const name = input.name.trim()
    const departmentId = input.departmentId.trim()
    const startPeriod = input.startPeriod.trim()
    const code = input.code?.trim().toUpperCase() || undefined
    if (!name) throw new Error('项目名称不能为空')
    if (!departmentId) throw new Error('所属部门不能为空')
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startPeriod)) {
      throw new Error('开始期间格式不正确')
    }
    if (
      !Number.isInteger(input.durationMonths) ||
      input.durationMonths < 1 ||
      input.durationMonths > 36
    ) {
      throw new Error('预测周期必须是1～36个月')
    }

    const departments = await this.database.query<{ origin: string }>(
      'SELECT origin FROM dim_department WHERE id = ?',
      [departmentId],
    )
    if (departments.length === 0) throw new Error('所属部门不存在')
    if (departments[0].origin !== 'user') {
      throw new Error('真实项目必须引用用户维护的部门')
    }
    if (code) {
      const duplicate = await this.database.query<{ id: string }>(
        'SELECT id FROM dim_project WHERE code = ? AND id <> ?',
        [code, input.id ?? ''],
      )
      if (duplicate.length > 0) throw new Error(`项目编码“${code}”已存在`)
    }

    const existing = input.id ? await this.get(input.id) : undefined
    const projectId = existing?.id ?? crypto.randomUUID()
    const now = new Date().toISOString()
    const project: Project = {
      id: projectId,
      code,
      name,
      customer: input.customer.trim(),
      departmentId,
      owner: input.owner.trim(),
      startPeriod,
      durationMonths: input.durationMonths,
      status: existing?.status ?? 'calculating',
      remark: input.remark.trim(),
      origin: 'user',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    const existingModules = existing ? await this.listModules(projectId) : []
    const normalizedModules = normalizeModules(input.modules)
    const requestedCodes = new Set(['PUBLIC', ...normalizedModules.map((m) => m.code)])
    if (
      existing &&
      (existing.startPeriod !== startPeriod ||
        existing.durationMonths !== input.durationMonths)
    ) {
      const periodConflicts = await this.database.query<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM cfg_forecast_line
         WHERE project_id = ?
           AND (start_period < ? OR end_period > ?)`,
        [projectId, startPeriod, endPeriod(startPeriod, input.durationMonths)],
      )
      if ((periodConflicts[0]?.count ?? 0) > 0) {
        throw new Error('新项目周期无法覆盖已有预测行，请先调整行项目生效期间')
      }
    }
    const removedModuleIds = existingModules
      .filter((module) => !requestedCodes.has(module.code))
      .map((module) => module.id)
    if (removedModuleIds.length > 0) {
      const placeholders = removedModuleIds.map(() => '?').join(', ')
      const moduleConflicts = await this.database.query<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM cfg_forecast_line
         WHERE business_module_id IN (${placeholders})`,
        removedModuleIds,
      )
      if ((moduleConflicts[0]?.count ?? 0) > 0) {
        throw new Error('待删除业务模块已被预测行引用，请先调整对应行项目')
      }
    }
    const statements: SqlStatement[] = [
      {
        sql: `INSERT INTO dim_project (
          id, code, name, customer, department_id, owner, start_period,
          duration_months, status, remark, attributes_json, origin,
          dataset_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'user', NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          code = excluded.code, name = excluded.name, customer = excluded.customer,
          department_id = excluded.department_id, owner = excluded.owner,
          start_period = excluded.start_period,
          duration_months = excluded.duration_months, remark = excluded.remark,
          updated_at = excluded.updated_at`,
        params: [
          project.id,
          project.code ?? null,
          project.name,
          project.customer,
          project.departmentId,
          project.owner,
          project.startPeriod,
          project.durationMonths,
          project.status,
          project.remark,
          project.createdAt,
          project.updatedAt,
        ],
      },
    ]

    const common = existingModules.find((module) => module.code === 'PUBLIC')
    const modules = [
      {
        id: common?.id ?? crypto.randomUUID(),
        code: 'PUBLIC',
        name: '公共',
        isCommon: true,
        createdAt: common?.createdAt ?? now,
      },
      ...normalizedModules.map((module) => {
        const previous = existingModules.find((item) => item.code === module.code)
        return {
          id: previous?.id ?? crypto.randomUUID(),
          ...module,
          isCommon: false,
          createdAt: previous?.createdAt ?? now,
        }
      }),
    ]
    modules.forEach((module) => {
      statements.push({
        sql: `INSERT INTO dim_business_module (
          id, project_id, code, name, is_common, origin, dataset_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'user', NULL, ?, ?)
        ON CONFLICT(project_id, code) DO UPDATE SET
          name = excluded.name, is_common = excluded.is_common,
          updated_at = excluded.updated_at`,
        params: [
          module.id,
          projectId,
          module.code,
          module.name,
          module.isCommon ? 1 : 0,
          module.createdAt,
          now,
        ],
      })
    })
    existingModules
      .filter((module) => !requestedCodes.has(module.code))
      .forEach((module) =>
        statements.push({
          sql: 'DELETE FROM dim_business_module WHERE id = ? AND is_common = 0',
          params: [module.id],
        }),
      )

    await this.database.batch(statements)
    return project
  }

  async archive(id: string): Promise<Project> {
    return this.setStatus(id, 'archived')
  }

  async restore(id: string): Promise<Project> {
    return this.setStatus(id, 'calculating')
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
