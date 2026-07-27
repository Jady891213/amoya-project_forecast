import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeSqliteDatabase } from '../storage/sqlite/initialize'
import { SCHEMA_V1 } from '../storage/sqlite/migrations'
import { DepartmentRepository } from '../repositories/departmentRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { FactRepository } from '../repositories/factRepository'
import { ReferenceDatasetService } from './referenceDatasetService'
import { ProjectReportService } from './projectReportService'
import { NodeSqliteClient } from '../test/nodeSqliteClient'

let database: NodeSqliteClient

beforeEach(async () => {
  database = await NodeSqliteClient.create()
  await initializeSqliteDatabase(database)
})

afterEach(async () => {
  await database.close()
})

describe('SQLite repositories and reference data isolation', () => {
  it('空库迁移幂等并建立规范表结构', async () => {
    await initializeSqliteDatabase(database)
    const tables = await database.query<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'dim_project',
        'dim_department',
        'dim_business_module',
        'dim_period',
        'dim_scenario',
        'dim_version',
        'dim_metric',
        'fact_metric_value',
        'sys_app_metadata',
        'sys_schema_migration',
      ]),
    )
    expect(
      await database.query('SELECT * FROM sys_schema_migration'),
    ).toHaveLength(2)
  })

  it('Schema v1 可迁移为全局场景和版本维度', async () => {
    const legacy = await NodeSqliteClient.create()
    await legacy.execute(SCHEMA_V1)
    await legacy.execute(
      `INSERT INTO sys_schema_migration (version, description, applied_at)
       VALUES (1, 'legacy', '2026-07-27T00:00:00.000Z')`,
    )
    await initializeSqliteDatabase(legacy)
    const scenarioColumns = await legacy.query<{ name: string }>(
      'PRAGMA table_info(dim_scenario)',
    )
    const versionColumns = await legacy.query<{ name: string }>(
      'PRAGMA table_info(dim_version)',
    )
    expect(scenarioColumns.some((column) => column.name === 'project_id')).toBe(false)
    expect(versionColumns.some((column) => column.name === 'project_id')).toBe(false)
    expect(await legacy.query('SELECT * FROM dim_scenario')).toHaveLength(1)
    expect(await legacy.query('SELECT * FROM dim_version')).toHaveLength(1)
    await legacy.close()
  })

  it('参考数据初始化幂等且项目数据隔离', async () => {
    const reference = new ReferenceDatasetService(database)
    await reference.initialize()
    const firstProjects = await new ProjectRepository(database).list()
    const firstFacts = await new FactRepository(database).list()
    await reference.initialize()
    expect(await new ProjectRepository(database).list()).toHaveLength(firstProjects.length)
    expect(await new FactRepository(database).list()).toHaveLength(firstFacts.length)

    const reports = new ProjectReportService(database)
    const cloud = await reports.build({
      projectId: 'project-hebei-unicom-cloud',
      scenarioId: 'baseline',
      versionId: 'working',
    })
    const tv = await reports.build({
      projectId: 'project-hebei-cable-iptv',
      scenarioId: 'baseline',
      versionId: 'working',
    })
    expect(cloud.factCount).toBe(136)
    expect(tv.factCount).toBe(20)
    expect(cloud.summary.revenue).not.toBe(tv.summary.revenue)
  })

  it('用户项目自动创建公共模块并复用全局场景与版本', async () => {
    const departments = new DepartmentRepository(database)
    const projects = new ProjectRepository(database)
    const department = await departments.save({ code: 'FIN', name: '财务部' })
    const project = await projects.save({
      code: 'REAL-001',
      name: '真实项目',
      customer: '真实客户',
      departmentId: department.id,
      owner: '财务负责人',
      startPeriod: '2026-08',
      durationMonths: 12,
      remark: '',
      modules: [{ code: 'SERVICE', name: '服务模块' }],
    })
    expect((await projects.listModules(project.id)).map((item) => item.code)).toEqual([
      'PUBLIC',
      'SERVICE',
    ])
    expect(await projects.listScenarios()).toHaveLength(1)
    expect(await projects.listVersions()).toHaveLength(1)
    expect((await projects.listScenarios())[0].id).toBe('baseline')
    expect((await projects.listVersions())[0].id).toBe('working')
  })

  it('清除参考数据不影响后续用户部门和项目', async () => {
    const reference = new ReferenceDatasetService(database)
    await reference.initialize()
    const departments = new DepartmentRepository(database)
    const projects = new ProjectRepository(database)
    const department = await departments.save({ code: 'OPS', name: '运营部' })
    const project = await projects.save({
      name: '用户项目',
      customer: '',
      departmentId: department.id,
      owner: '',
      startPeriod: '2026-01',
      durationMonths: 6,
      remark: '',
      modules: [],
    })
    await reference.clear()
    expect(await projects.get(project.id)).toBeDefined()
    expect(await departments.get(department.id)).toBeDefined()
    expect((await projects.list()).filter((item) => item.datasetId)).toHaveLength(0)
    expect(await new FactRepository(database).list()).toHaveLength(0)
    expect(await projects.listScenarios()).toHaveLength(1)
    expect(await projects.listVersions()).toHaveLength(1)
  })

  it('项目编码和事实完整坐标保持唯一', async () => {
    const departments = new DepartmentRepository(database)
    const projects = new ProjectRepository(database)
    const department = await departments.save({ code: 'DEV', name: '事业部' })
    await projects.save({
      code: 'P-001',
      name: '项目一',
      customer: '',
      departmentId: department.id,
      owner: '',
      startPeriod: '2026-01',
      durationMonths: 6,
      remark: '',
      modules: [],
    })
    await expect(projects.save({
      code: 'P-001',
      name: '项目二',
      customer: '',
      departmentId: department.id,
      owner: '',
      startPeriod: '2026-01',
      durationMonths: 6,
      remark: '',
      modules: [],
    })).rejects.toThrow('已存在')
  })

  it('SQLite导出后可恢复全部项目与事实', async () => {
    await new ReferenceDatasetService(database).initialize()
    const beforeProjects = await new ProjectRepository(database).list()
    const beforeFacts = await new FactRepository(database).list()
    const bytes = await database.exportDatabase()

    const restored = await NodeSqliteClient.create()
    await restored.importDatabase(bytes)
    expect(await new ProjectRepository(restored).list()).toHaveLength(beforeProjects.length)
    expect(await new FactRepository(restored).list()).toHaveLength(beforeFacts.length)
    await restored.close()
  })
})
