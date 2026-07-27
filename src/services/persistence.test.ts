import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeSqliteDatabase } from '../storage/sqlite/initialize'
import { DepartmentRepository } from '../repositories/departmentRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { FactRepository } from '../repositories/factRepository'
import { DemoDatasetService } from './demoDatasetService'
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

describe('SQLite repositories and demo isolation', () => {
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
    ).toHaveLength(1)
  })

  it('演示数据初始化幂等且两个项目数据隔离', async () => {
    const demo = new DemoDatasetService(database)
    await demo.initialize()
    const firstProjects = await new ProjectRepository(database).list()
    const firstFacts = await new FactRepository(database).list()
    await demo.initialize()
    expect(await new ProjectRepository(database).list()).toHaveLength(firstProjects.length)
    expect(await new FactRepository(database).list()).toHaveLength(firstFacts.length)

    const reports = new ProjectReportService(database)
    const cloud = await reports.build({
      projectId: 'project-demo-cloud',
      scenarioId: 'project-demo-cloud:baseline',
      versionId: 'project-demo-cloud:working',
    })
    const tv = await reports.build({
      projectId: 'project-demo-tv',
      scenarioId: 'project-demo-tv:baseline',
      versionId: 'project-demo-tv:working',
    })
    expect(cloud.factCount).toBe(96)
    expect(tv.factCount).toBe(24)
    expect(cloud.summary.revenue).not.toBe(tv.summary.revenue)
  })

  it('用户项目自动创建公共模块、基准场景和工作版', async () => {
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
    expect(await projects.listScenarios(project.id)).toHaveLength(1)
    expect(await projects.listVersions(project.id)).toHaveLength(1)
  })

  it('清除演示数据不影响用户部门和真实项目', async () => {
    const demo = new DemoDatasetService(database)
    await demo.initialize()
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
    await demo.clear()
    expect(await projects.get(project.id)).toBeDefined()
    expect(await departments.get(department.id)).toBeDefined()
    expect((await projects.list()).filter((item) => item.origin === 'demo')).toHaveLength(0)
    expect(await new FactRepository(database).list()).toHaveLength(0)
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
    await new DemoDatasetService(database).initialize()
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
