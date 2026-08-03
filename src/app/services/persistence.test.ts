import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeSqliteDatabase } from '../storage/sqlite/initialize'
import { DepartmentRepository } from '../repositories/departmentRepository'
import { FactRepository } from '../repositories/factRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { NodeSqliteClient } from '../test/nodeSqliteClient'
import { CalculationService } from './calculationService'
import { ProjectReportService } from './projectReportService'
import { ReferenceDatasetService } from './referenceDatasetService'

let database: NodeSqliteClient

beforeEach(async () => {
  database = await NodeSqliteClient.create()
  await initializeSqliteDatabase(database)
})

afterEach(async () => {
  await database.close()
})

describe('SQLite 当前数据结构与测算闭环', () => {
  it('空库幂等初始化且完全不包含业务模块结构', async () => {
    await initializeSqliteDatabase(database)
    const tables = await database.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
      'dim_project', 'dim_department', 'dim_period', 'dim_scenario',
      'dim_version', 'dim_metric', 'cfg_model_line', 'cfg_model_line_value',
      'fact_metric_value', 'fact_forecast_line_value',
      'fact_cash_schedule_value', 'sys_calculation_run',
    ]))
    expect(tables.map((row) => row.name)).not.toContain('dim_business_module')
    for (const table of ['cfg_model_line', 'fact_metric_value', 'fact_forecast_line_value', 'fact_cash_schedule_value']) {
      const columns = await database.query<{ name: string }>(`PRAGMA table_info(${table})`)
      expect(columns.map((item) => item.name)).not.toContain('business_module_id')
    }
    expect(await database.query('SELECT * FROM sys_schema_migration')).toHaveLength(1)
  })

  it('五个参考项目幂等初始化并保持历史关键结果', async () => {
    const reference = new ReferenceDatasetService(database)
    await reference.initialize()
    const firstFacts = await new FactRepository(database).list()
    await reference.initialize()
    expect(await new ProjectRepository(database).list()).toHaveLength(5)
    expect(await new FactRepository(database).list()).toHaveLength(firstFacts.length)

    const reports = new ProjectReportService(database)
    const expectations = [
      ['project-hebei-unicom-cloud', 400.943396226415, 174.141289214644, 425, 193.5355],
      ['project-chongqing-mobile-screen', 198.31, 176.25, 0, 0],
      ['project-hebei-cable-iptv', 29.9094339622641, 19.735241509434, 0, 0],
      ['project-bestv-ctv-ad', 4999.69811320755, 6149.54318279578, 28498.4905660377, 26121.02498269],
      ['project-hebei-cloud-game-report', 80.625212890299, 57.352178812533, 0, 0],
    ] as const
    for (const [projectId, revenue, cost, cashInflow, cashOutflow] of expectations) {
      const report = await reports.build({ projectId, scenarioId: 'baseline', versionId: 'working' })
      expect(Number(report.summary.revenue) / 10_000).toBeCloseTo(revenue, 2)
      expect(Number(report.summary.cost) / 10_000).toBeCloseTo(cost, 2)
      expect(Number(report.summary.cashInflow) / 10_000).toBeCloseTo(cashInflow, 2)
      expect(Number(report.summary.cashOutflow) / 10_000).toBeCloseTo(cashOutflow, 2)
    }
  })

  it('保存配置不写事实，计算后才替换工作版事实', async () => {
    const departments = new DepartmentRepository(database)
    const projects = new ProjectRepository(database)
    const department = await departments.save({ code: 'FIN', name: '财务部' })
    const project = await projects.save({
      code: 'REAL-001', name: '真实项目', departmentId: department.id,
      startPeriod: '2026-01', endPeriod: '2026-02',
    })
    const calculation = new CalculationService(database)
    await calculation.saveDraft(project.id, {
      lines: [{
        id: 'line-revenue', code: 'LINE-001', name: '会员收入',
        category: 'revenue', forecastMethod: 'formula',
        formulaExpression: '24 * 100', calculationPreset: 'price_quantity',
        calculationConfig: { priceValue: '24', quantityValue: '100' },
        startPeriod: '2026-01', endPeriod: '2026-02',
        amountBasis: 'tax_exclusive', taxRate: '0', assumption: '',
        sortOrder: 1, monthlyValues: {},
      }],
      parameters: [], cashRules: [], overrides: [],
    })
    expect(await new FactRepository(database).list(project.id)).toHaveLength(0)
    const result = await calculation.calculateSaved(project.id)
    expect(result.success).toBe(true)
    const report = await new ProjectReportService(database).build({
      projectId: project.id, scenarioId: 'baseline', versionId: 'working',
    })
    expect(report.summary.revenue).toBe('4800')
  })
})
