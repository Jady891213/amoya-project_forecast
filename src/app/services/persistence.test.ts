import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeSqliteDatabase } from '../storage/sqlite/initialize'
import { DepartmentRepository } from '../repositories/departmentRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { FactRepository } from '../repositories/factRepository'
import { ReferenceDatasetService } from './referenceDatasetService'
import { ProjectReportService } from './projectReportService'
import { NodeSqliteClient } from '../test/nodeSqliteClient'
import { CalculationService } from './calculationService'
import { ForecastLineValueRepository } from '../repositories/forecastLineValueRepository'
import { CashScheduleRepository } from '../repositories/cashScheduleRepository'
import { ProjectWorkspaceService } from '../../server/projectWorkspaceService'

let database: NodeSqliteClient

beforeEach(async () => {
  database = await NodeSqliteClient.create()
  await initializeSqliteDatabase(database)
})

afterEach(async () => {
  await database.close()
})

describe('SQLite repositories and reference data isolation', () => {
  it('空库初始化幂等并建立当前规范表结构', async () => {
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
        'cfg_model_line',
        'cfg_model_line_value',
        'fact_metric_value',
        'fact_forecast_line_value',
        'fact_cash_schedule_value',
        'sys_calculation_run',
        'sys_app_metadata',
        'sys_schema_migration',
      ]),
    )
    expect(
      await database.query('SELECT * FROM sys_schema_migration'),
    ).toHaveLength(9)
    const projectColumns = await database.query<{ name: string }>(
      'PRAGMA table_info(dim_project)',
    )
    const runColumns = await database.query<{ name: string }>(
      'PRAGMA table_info(sys_calculation_run)',
    )
    expect(projectColumns.map((item) => item.name)).toEqual(expect.arrayContaining([
      'start_period', 'end_period', 'draft_revision',
    ]))
    expect(projectColumns.map((item) => item.name)).not.toEqual(expect.arrayContaining([
      'customer', 'owner', 'remark', 'duration_months',
    ]))
    expect(runColumns.map((item) => item.name)).toEqual(
      expect.arrayContaining(['draft_revision', 'project_snapshot_json']),
    )
    expect(
      await database.query<{ name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'cfg_forecast_override'`,
      ),
    ).toHaveLength(1)
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
    expect(cloud.factCount).toBe(91)
    expect(tv.factCount).toBe(10)
    expect(cloud.summary.revenue).not.toBe(tv.summary.revenue)
  })

  it('五个可结构化历史项目由已保存配置计算并与源表关键结果核对', async () => {
    await new ReferenceDatasetService(database).initialize()
    const reports = new ProjectReportService(database)
    const expectations = [
      {
        projectId: 'project-hebei-unicom-cloud',
        revenue: 400.943396226415,
        cost: 174.141289214644,
        cashInflow: 425,
        cashOutflow: 193.5355,
      },
      {
        projectId: 'project-chongqing-mobile-screen',
        revenue: 198.31,
        cost: 176.25,
        cashInflow: 0,
        cashOutflow: 0,
      },
      {
        projectId: 'project-hebei-cable-iptv',
        revenue: 29.9094339622641,
        cost: 19.735241509434,
        cashInflow: 0,
        cashOutflow: 0,
      },
      {
        projectId: 'project-bestv-ctv-ad',
        revenue: 4999.69811320755,
        cost: 6149.54318279578,
        cashInflow: 28498.4905660377,
        cashOutflow: 26121.02498269,
      },
      {
        projectId: 'project-hebei-cloud-game-report',
        revenue: 80.625212890299,
        cost: 57.352178812533,
        cashInflow: 0,
        cashOutflow: 0,
      },
    ]
    for (const expected of expectations) {
      const report = await reports.build({
        projectId: expected.projectId,
        scenarioId: 'baseline',
        versionId: 'working',
      })
      expect(Number(report.summary.revenue) / 10_000).toBeCloseTo(expected.revenue, 2)
      expect(Number(report.summary.cost) / 10_000).toBeCloseTo(expected.cost, 2)
      expect(Number(report.summary.cashInflow) / 10_000).toBeCloseTo(expected.cashInflow, 2)
      expect(Number(report.summary.cashOutflow) / 10_000).toBeCloseTo(expected.cashOutflow, 2)
      expect(
        await database.query(
          'SELECT id FROM cfg_model_line WHERE project_id = ?',
          [expected.projectId],
        ),
      ).not.toHaveLength(0)
      expect(
        await database.query(
          `SELECT id FROM sys_calculation_run
           WHERE project_id = ? AND status = 'success'`,
          [expected.projectId],
        ),
      ).toHaveLength(1)
    }
  })

  it('河北联通按17个月经营期和3个月回收期回放，百视通保留成本构成', async () => {
    await new ReferenceDatasetService(database).initialize()
    const reports = new ProjectReportService(database)
    const unicom = await reports.build({
      projectId: 'project-hebei-unicom-cloud',
      scenarioId: 'baseline',
      versionId: 'working',
    })
    expect(unicom.operationEndPeriod).toBe('2027-12')
    expect(unicom.reportEndPeriod).toBe('2028-03')
    expect(unicom.monthly.filter((row) => row.isRecoveryPeriod)).toHaveLength(3)
    expect(unicom.monthly.slice(17).every((row) => row.revenue === '0' && row.cost === '0')).toBe(true)

    const bestvCostLines = await database.query<{ name: string }>(
      `SELECT name FROM cfg_model_line
       WHERE project_id = ? AND line_type = 'profit' AND category = 'cost'
       ORDER BY sort_order`,
      ['project-bestv-ctv-ad'],
    )
    expect(bestvCostLines.map((row) => row.name)).toEqual([
      '营业成本',
      '销售费用',
      '管理费用',
      '税金及附加',
    ])
  })

  it('用户项目自动创建公共模块并复用全局场景与版本', async () => {
    const departments = new DepartmentRepository(database)
    const projects = new ProjectRepository(database)
    const department = await departments.save({ code: 'FIN', name: '财务部' })
    const project = await projects.save({
      code: 'REAL-001',
      name: '真实项目',
      departmentId: department.id,
      startPeriod: '2026-08',
      endPeriod: '2027-07',
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

  it('项目聚合保存递增修订号并拒绝过期页面覆盖', async () => {
    const departments = new DepartmentRepository(database)
    const projects = new ProjectRepository(database)
    const department = await departments.save({ code: 'REV', name: '修订测试部' })
    const input = {
      code: 'REV-001', name: '修订测试项目',
      departmentId: department.id, startPeriod: '2026-01',
      endPeriod: '2026-12', modules: [],
    }
    const created = await projects.save(input, 0)
    expect(created.draftRevision).toBe(1)
    const updated = await projects.save({ ...input, id: created.id, name: '修订测试项目（已更新）' }, 1)
    expect(updated.draftRevision).toBe(2)
    await expect(
      projects.save({ ...input, id: created.id, name: '过期页面修改' }, 1),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 2 })
  })

  it('非计算项目信息修改不使结果过期，计算坐标修改会使结果过期', async () => {
    await new ReferenceDatasetService(database).initialize()
    const projects = new ProjectRepository(database)
    const departments = new DepartmentRepository(database)
    const calculation = new CalculationService(database)
    const project = (await projects.get('project-hebei-cable-iptv'))!
    expect((await calculation.getProjectState(project.id)).isResultCurrent).toBe(true)

    const modules = (await projects.listModules(project.id))
      .filter((item) => !item.isCommon)
      .map((item) => ({ code: item.code, name: item.name }))
    const renamed = await projects.save({
      id: project.id,
      code: project.code,
      name: `${project.name}（展示名调整）`,
      departmentId: project.departmentId,
      startPeriod: project.startPeriod,
      endPeriod: project.endPeriod,
      modules,
    }, project.draftRevision)
    expect((await calculation.getProjectState(project.id)).isResultCurrent).toBe(true)

    const replacementDepartment = await departments.save({ code: 'ALT', name: '替代部门' })
    await projects.save({
      id: renamed.id,
      code: renamed.code,
      name: renamed.name,
      departmentId: replacementDepartment.id,
      startPeriod: renamed.startPeriod,
      endPeriod: renamed.endPeriod,
      modules,
    }, renamed.draftRevision)
    expect((await calculation.getProjectState(project.id)).isResultCurrent).toBe(false)
  })

  it('项目聚合保存失败时回滚项目信息和全部配置', async () => {
    await new ReferenceDatasetService(database).initialize()
    const service = new ProjectWorkspaceService(database)
    const before = await service.getWorkspace('project-hebei-cable-iptv')
    await expect(service.saveWorkspace(before.project.id, {
      expectedRevision: before.draftRevision,
      draft: {
        project: {
          id: before.project.id,
          code: before.project.code,
          name: '不应落库的名称',
          departmentId: before.project.departmentId,
          startPeriod: before.project.startPeriod,
          endPeriod: before.project.endPeriod,
          modules: before.modules.filter((item) => !item.isCommon).map((item) => ({ code: item.code, name: item.name })),
        },
        forecast: {
          parameters: [],
          lines: [{
            name: '非法模块收入',
            category: 'revenue',
            businessModuleId: 'not-current-project-module',
            forecastMethod: 'fixed_monthly',
            startPeriod: before.project.startPeriod,
            endPeriod: before.project.startPeriod,
            fixedMonthlyValue: '100',
            amountBasis: 'tax_exclusive',
            taxRate: '0',
            assumption: '',
            sortOrder: 1,
            monthlyValues: {},
          }],
          cashRules: [],
          overrides: [],
        },
      },
    })).rejects.toThrow('业务模块')
    const after = await service.getWorkspace(before.project.id)
    expect(after.project.name).toBe(before.project.name)
    expect(after.draftRevision).toBe(before.draftRevision)
    expect(after.forecast.lines).toEqual(before.forecast.lines)
  })

  it('复制项目保留完整配置但不复制计算结果，删除后不影响原项目', async () => {
    await new ReferenceDatasetService(database).initialize()
    const service = new ProjectWorkspaceService(database)
    const source = await service.getWorkspace('project-hebei-cable-iptv')

    const copied = await service.copy(source.project.id)

    expect(copied.project.id).not.toBe(source.project.id)
    expect(copied.project.name).toBe(`${source.project.name} 副本`)
    expect(copied.project.code).toBe(`${source.project.code}-COPY`)
    expect(copied.modules.map((item) => item.code)).toEqual(source.modules.map((item) => item.code))
    expect(copied.forecast.lines.map((item) => item.code)).toEqual(source.forecast.lines.map((item) => item.code))
    expect(copied.forecast.parameters.map((item) => item.code)).toEqual(source.forecast.parameters.map((item) => item.code))
    expect(copied.forecast.latestRun).toBeUndefined()
    expect(await new FactRepository(database).list(copied.project.id)).toHaveLength(0)

    await service.delete(copied.project.id)

    await expect(service.getWorkspace(copied.project.id)).rejects.toThrow('项目不存在')
    expect(await service.getWorkspace(source.project.id)).toBeDefined()
  })

  it('清除参考数据不影响后续用户部门和项目', async () => {
    const reference = new ReferenceDatasetService(database)
    await reference.initialize()
    const departments = new DepartmentRepository(database)
    const projects = new ProjectRepository(database)
    const department = await departments.save({ code: 'OPS', name: '运营部' })
    const project = await projects.save({
      name: '用户项目',
      departmentId: department.id,
      startPeriod: '2026-01',
      endPeriod: '2026-06',
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
      departmentId: department.id,
      startPeriod: '2026-01',
      endPeriod: '2026-06',
      modules: [],
    })
    await expect(projects.save({
      code: 'P-001',
      name: '项目二',
      departmentId: department.id,
      startPeriod: '2026-01',
      endPeriod: '2026-06',
      modules: [],
    })).rejects.toThrow('已存在')
  })

  it('项目信息修改会保护被预测行引用的期间和业务模块', async () => {
    const departments = new DepartmentRepository(database)
    const projects = new ProjectRepository(database)
    const department = await departments.save({ code: 'SAFE', name: '安全校验部' })
    const project = await projects.save({
      code: 'SAFE-001',
      name: '引用保护项目',
      departmentId: department.id,
      startPeriod: '2026-01',
      endPeriod: '2026-12',
      modules: [{ code: 'SERVICE', name: '服务模块' }],
    })
    const serviceModule = (await projects.listModules(project.id))
      .find((module) => module.code === 'SERVICE')!
    await new CalculationService(database).saveDraft(project.id, [{
      name: '服务收入',
      category: 'revenue',
      businessModuleId: serviceModule.id,
      forecastMethod: 'fixed_monthly',
      startPeriod: '2026-01',
      endPeriod: '2026-12',
      fixedMonthlyValue: '10000',
      assumption: '',
      sortOrder: 1,
      monthlyValues: {},
    }])
    await expect(projects.save({
      id: project.id,
      code: project.code,
      name: project.name,
      departmentId: project.departmentId,
      startPeriod: '2026-02',
      endPeriod: project.endPeriod,
      modules: [{ code: 'SERVICE', name: '服务模块' }],
    })).rejects.toThrow('无法覆盖已有预测行')
    await expect(projects.save({
      id: project.id,
      code: project.code,
      name: project.name,
      departmentId: project.departmentId,
      startPeriod: project.startPeriod,
      endPeriod: project.endPeriod,
      modules: [],
    })).rejects.toThrow('已被预测行引用')
  })

  it('预测配置保存、计算、结果过期与项目隔离形成闭环', async () => {
    await new ReferenceDatasetService(database).initialize()
    const projects = new ProjectRepository(database)
    const project = await projects.get('project-hebei-unicom-cloud')
    expect(project).toBeDefined()
    const modules = await projects.listModules(project!.id)
    const publicModule = modules.find((module) => module.isCommon)!
    const cloudModule = modules.find((module) => module.code === 'CLOUD_GAME')!
    const calculation = new CalculationService(database)
    const result = await calculation.saveAndCalculate(project!.id, [
      {
        name: '云游戏包盘收入',
        category: 'revenue',
        businessModuleId: cloudModule.id,
        forecastMethod: 'fixed_monthly',
        startPeriod: '2026-08',
        endPeriod: '2026-10',
        fixedMonthlyValue: '200000',
        assumption: '固定月收入',
        sortOrder: 1,
        monthlyValues: {},
      },
      {
        name: '公共运营成本',
        category: 'cost',
        businessModuleId: publicModule.id,
        forecastMethod: 'monthly_input',
        startPeriod: '2026-08',
        endPeriod: '2026-10',
        assumption: '逐月填写',
        sortOrder: 2,
        monthlyValues: {
          '2026-08': '80000',
          '2026-09': '90000',
        },
      },
    ])
    expect(result.success).toBe(true)
    expect(result.issues.some((issue) => issue.severity === 'warning')).toBe(true)
    const state = await calculation.getProjectState(project!.id)
    expect(state.lines).toHaveLength(2)
    expect(state.isResultCurrent).toBe(true)
    const breakdown = await new ForecastLineValueRepository(database).listBreakdown(
      result.run.id,
    )
    expect(breakdown).toHaveLength(2)
    expect(new Set(breakdown.map((item) => item.lineCode)).size).toBe(2)

    const facts = await new FactRepository(database).list(project!.id)
    expect(facts.every((fact) => fact.calculationRunId === result.run.id)).toBe(true)
    expect(
      facts
        .filter((fact) => fact.metricCode === 'revenue')
        .reduce((sum, fact) => sum + Number(fact.value), 0),
    ).toBe(600000)
    expect(
      facts
        .filter((fact) => fact.metricCode === 'cost')
        .reduce((sum, fact) => sum + Number(fact.value), 0),
    ).toBe(170000)

    const otherFacts = await new FactRepository(database).list(
      'project-hebei-cable-iptv',
    )
    expect(otherFacts).toHaveLength(10)

    const drafts = state.lines.map((line) => ({
      id: line.id,
      code: line.code,
      name: line.name,
      category: line.category,
      businessModuleId: line.businessModuleId,
      forecastMethod: line.forecastMethod,
      startPeriod: line.startPeriod,
      endPeriod: line.endPeriod,
      fixedMonthlyValue:
        line.category === 'revenue' ? '210000' : line.fixedMonthlyValue,
      assumption: line.assumption,
      sortOrder: line.sortOrder,
      monthlyValues: Object.fromEntries(
        state.values
          .filter((value) => value.lineId === line.id)
          .map((value) => [value.period, value.value]),
      ),
    }))
    await calculation.saveDraft(project!.id, drafts)
    const staleState = await calculation.getProjectState(project!.id)
    expect(staleState.isResultCurrent).toBe(false)
    expect(await new FactRepository(database).list(project!.id)).toEqual(facts)

    await calculation.saveDraft(
      project!.id,
      drafts
        .slice()
        .reverse()
        .slice(0, 1)
        .map((draft) => ({
          ...draft,
          name: '已修改但尚未计算的名称',
          sortOrder: 1,
        })),
    )
    const historicalBreakdown =
      await new ForecastLineValueRepository(database).listBreakdown(result.run.id)
    expect(historicalBreakdown.map((item) => item.lineName)).toEqual([
      '云游戏包盘收入',
      '公共运营成本',
    ])
  })

  it('预测计算失败时保留上一批成功事实', async () => {
    const departments = new DepartmentRepository(database)
    const projects = new ProjectRepository(database)
    const department = await departments.save({ code: 'CALC', name: '测算部' })
    const project = await projects.save({
      code: 'CALC-001',
      name: '事务测试项目',
      departmentId: department.id,
      startPeriod: '2026-01',
      endPeriod: '2026-03',
      modules: [],
    })
    const module = (await projects.listModules(project.id))[0]
    const calculation = new CalculationService(database)
    const validDraft = {
      name: '固定收入',
      category: 'revenue' as const,
      businessModuleId: module.id,
      forecastMethod: 'fixed_monthly' as const,
      startPeriod: '2026-01',
      endPeriod: '2026-03',
      fixedMonthlyValue: '100000',
      assumption: '',
      sortOrder: 1,
      monthlyValues: {},
    }
    const success = await calculation.saveAndCalculate(project.id, [validDraft])
    expect(success.success).toBe(true)
    const beforeFacts = await new FactRepository(database).list(project.id)
    const failed = await calculation.saveAndCalculate(project.id, [
      { ...validDraft, fixedMonthlyValue: 'not-a-number' },
    ])
    expect(failed.success).toBe(false)
    expect(await new FactRepository(database).list(project.id)).toEqual(beforeFacts)
    expect((await calculation.getProjectState(project.id)).isResultCurrent).toBe(false)
  })

  it('项目参数和行项目公式形成可追溯计算闭环', async () => {
    const departments = new DepartmentRepository(database)
    const projects = new ProjectRepository(database)
    const department = await departments.save({ code: 'FORMULA', name: '公式测试部' })
    const project = await projects.save({
      code: 'FORMULA-001',
      name: '参数公式项目',
      departmentId: department.id,
      startPeriod: '2026-01',
      endPeriod: '2026-02',
      modules: [],
    })
    const module = (await projects.listModules(project.id))[0]
    const calculation = new CalculationService(database)
    const draft = {
      parameters: [
        {
          code: 'PAR-001',
          name: '用户数',
          parameterType: 'fixed' as const,
          valueType: 'quantity' as const,
          unit: '户',
          fixedValue: '100',
          description: '',
          sortOrder: 1,
          monthlyValues: {},
        },
        {
          code: 'PAR-002',
          name: '月单价',
          parameterType: 'fixed' as const,
          valueType: 'currency' as const,
          unit: '元',
          fixedValue: '10',
          description: '',
          sortOrder: 2,
          monthlyValues: {},
        },
        {
          code: 'PAR-003',
          name: '分成比例',
          parameterType: 'fixed' as const,
          valueType: 'percentage' as const,
          unit: '%',
          fixedValue: '20',
          description: '',
          sortOrder: 3,
          monthlyValues: {},
        },
      ],
      lines: [
        {
          code: 'LINE-001',
          name: '业务收入',
          category: 'revenue' as const,
          businessModuleId: module.id,
          forecastMethod: 'formula' as const,
          startPeriod: '2026-01',
          endPeriod: '2026-02',
          formulaExpression: 'PARAM("PAR-001") * PARAM("PAR-002")',
          assumption: '',
          sortOrder: 1,
          monthlyValues: {},
        },
        {
          code: 'LINE-002',
          name: '渠道分成',
          category: 'cost' as const,
          businessModuleId: module.id,
          forecastMethod: 'formula' as const,
          startPeriod: '2026-01',
          endPeriod: '2026-02',
          formulaExpression: 'LINE("LINE-001") * PARAM("PAR-003")',
          assumption: '',
          sortOrder: 2,
          monthlyValues: {},
        },
      ],
    }
    const result = await calculation.saveAndCalculate(project.id, draft)
    expect(result.success).toBe(true)
    const state = await calculation.getProjectState(project.id)
    expect(state.parameters.find((item) => item.code === 'PAR-003')?.fixedValue)
      .toBe('0.2')
    expect(result.run.configSnapshotJson).toContain('formulaExpression')
    expect(state.isResultCurrent).toBe(true)
    const facts = await new FactRepository(database).list(project.id)
    expect(
      facts
        .filter((fact) => fact.metricCode === 'revenue')
        .reduce((sum, fact) => sum + Number(fact.value), 0),
    ).toBe(2000)
    expect(
      facts
        .filter((fact) => fact.metricCode === 'cost')
        .reduce((sum, fact) => sum + Number(fact.value), 0),
    ).toBe(400)

    await expect(
      calculation.saveDraft(project.id, {
        lines: draft.lines,
        parameters: draft.parameters.slice(0, 2),
      }),
    ).rejects.toThrow('正在被行项目')
  })

  it('税口径与收付款规则生成可追溯现金尾期', async () => {
    const departments = new DepartmentRepository(database)
    const projects = new ProjectRepository(database)
    const department = await departments.save({
      code: 'CASH',
      name: '现金流测试部',
    })
    const project = await projects.save({
      code: 'CASH-001',
      name: '税与现金流项目',
      departmentId: department.id,
      startPeriod: '2026-01',
      endPeriod: '2026-02',
      modules: [],
    })
    const module = (await projects.listModules(project.id))[0]
    const calculation = new CalculationService(database)
    const draft = {
      parameters: [],
      lines: [
        {
          code: 'LINE-001',
          name: '含税服务收入',
          category: 'revenue' as const,
          businessModuleId: module.id,
          forecastMethod: 'fixed_monthly' as const,
          startPeriod: '2026-01',
          endPeriod: '2026-01',
          fixedMonthlyValue: '10600',
          amountBasis: 'tax_inclusive' as const,
          taxRate: '0.06',
          assumption: '',
          sortOrder: 1,
          monthlyValues: {},
        },
        {
          code: 'LINE-002',
          name: '未税服务成本',
          category: 'cost' as const,
          businessModuleId: module.id,
          forecastMethod: 'fixed_monthly' as const,
          startPeriod: '2026-01',
          endPeriod: '2026-01',
          fixedMonthlyValue: '10000',
          amountBasis: 'tax_exclusive' as const,
          taxRate: '0.06',
          assumption: '',
          sortOrder: 2,
          monthlyValues: {},
        },
        {
          code: 'LINE-003',
          name: '其他直接收款',
          category: 'cash_inflow' as const,
          businessModuleId: module.id,
          forecastMethod: 'fixed_monthly' as const,
          startPeriod: '2026-03',
          endPeriod: '2026-03',
          fixedMonthlyValue: '500',
          amountBasis: 'non_taxable' as const,
          taxRate: '0',
          assumption: '',
          sortOrder: 3,
          monthlyValues: {},
        },
      ],
      cashRules: [
        {
          sourceLineCode: 'LINE-001',
          method: 'delayed' as const,
          delayMonths: 3,
          installments: [],
        },
        {
          sourceLineCode: 'LINE-002',
          method: 'installment' as const,
          delayMonths: 0,
          installments: [
            { sequence: 1, offsetMonths: 0, ratio: '0.5' },
            { sequence: 2, offsetMonths: 2, ratio: '0.5' },
          ],
        },
      ],
    }
    const result = await calculation.saveAndCalculate(project.id, draft)
    expect(result.success).toBe(true)
    expect(result.run.configSnapshotJson).toContain('cashRules')

    const facts = await new FactRepository(database).list(project.id)
    expect(
      facts.find(
        (fact) =>
          fact.metricCode === 'revenue' && fact.period === '2026-01',
      )?.value,
    ).toBe('10000')
    expect(
      facts.find(
        (fact) =>
          fact.metricCode === 'cash_inflow' && fact.period === '2026-04',
      )?.value,
    ).toBe('10600')
    expect(
      facts.find(
        (fact) =>
          fact.metricCode === 'cash_inflow' && fact.period === '2026-03',
      )?.value,
    ).toBe('500')
    expect(
      facts
        .filter((fact) => fact.metricCode === 'cash_outflow')
        .map((fact) => [fact.period, fact.value]),
    ).toEqual([
      ['2026-01', '5300'],
      ['2026-03', '5300'],
    ])

    const schedule = await new CashScheduleRepository(database).listByRun(
      result.run.id,
    )
    expect(schedule).toHaveLength(3)
    expect(schedule[0]).toEqual(
      expect.objectContaining({
        netValue: '10000',
        taxValue: '600',
      }),
    )
    const report = await new ProjectReportService(database).build({
      projectId: project.id,
      scenarioId: 'baseline',
      versionId: 'working',
    })
    expect(report.operationEndPeriod).toBe('2026-02')
    expect(report.reportEndPeriod).toBe('2026-04')
    expect(report.monthly.filter((month) => month.isRecoveryPeriod))
      .toHaveLength(2)

    await calculation.saveDraft(project.id, {
      ...draft,
      cashRules: draft.cashRules.map((rule) =>
        rule.sourceLineCode === 'LINE-001'
          ? { ...rule, delayMonths: 2 }
          : rule,
      ),
    })
    expect((await calculation.getProjectState(project.id)).isResultCurrent)
      .toBe(false)
  })

  it('SQLite导出后可恢复项目、预测配置、批次与事实', async () => {
    await new ReferenceDatasetService(database).initialize()
    const projects = new ProjectRepository(database)
    const project = (await projects.list())[0]
    const module = (await projects.listModules(project.id))[0]
    const result = await new CalculationService(database).saveAndCalculate(
      project.id,
      {
        parameters: [],
        lines: [{
          code: 'LINE-001',
          name: '备份测试收入',
          category: 'revenue',
          businessModuleId: module.id,
          forecastMethod: 'fixed_monthly',
          startPeriod: project.startPeriod,
          endPeriod: project.startPeriod,
          fixedMonthlyValue: '12345.67',
          amountBasis: 'tax_exclusive',
          taxRate: '0.06',
          assumption: '',
          sortOrder: 1,
          monthlyValues: {},
        }],
        cashRules: [{
          sourceLineCode: 'LINE-001',
          method: 'immediate',
          delayMonths: 0,
          installments: [],
        }],
      },
    )
    expect(result.success).toBe(true)
    const beforeProjects = await new ProjectRepository(database).list()
    const beforeFacts = await new FactRepository(database).list()
    const beforeLineCount = (
      await database.query('SELECT id FROM cfg_model_line')
    ).length
    const beforeRunCount = (
      await database.query('SELECT id FROM sys_calculation_run')
    ).length
    const beforeLineFactCount = (
      await database.query('SELECT id FROM fact_forecast_line_value')
    ).length
    const beforeModelConfigs = await database.query<{ id: string; config_json: string }>(
      'SELECT id, config_json FROM cfg_model_line ORDER BY id',
    )
    const beforeCashFactCount = (
      await database.query('SELECT id FROM fact_cash_schedule_value')
    ).length
    const bytes = await database.exportDatabase()

    const restored = await NodeSqliteClient.create()
    await restored.importDatabase(bytes)
    expect(await new ProjectRepository(restored).list()).toHaveLength(beforeProjects.length)
    expect(await new FactRepository(restored).list()).toHaveLength(beforeFacts.length)
    expect(await restored.query('SELECT * FROM cfg_model_line')).toHaveLength(beforeLineCount)
    expect(await restored.query('SELECT * FROM sys_calculation_run')).toHaveLength(beforeRunCount)
    expect(
      await restored.query('SELECT * FROM fact_forecast_line_value'),
    ).toHaveLength(beforeLineFactCount)
    expect(await restored.query('SELECT id, config_json FROM cfg_model_line ORDER BY id'))
      .toEqual(beforeModelConfigs)
    expect(await restored.query('SELECT * FROM fact_cash_schedule_value'))
      .toHaveLength(beforeCashFactCount)
    await restored.close()
  })
})
