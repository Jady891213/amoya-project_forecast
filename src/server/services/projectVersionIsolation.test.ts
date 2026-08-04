import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeSqliteDatabase } from '../../app/storage/sqlite/initialize'
import { NodeSqliteClient } from '../../app/test/nodeSqliteClient'
import { DepartmentRepository } from '../repositories/departmentRepository'
import { ProjectWorkspaceService } from '../projectWorkspaceService'
import { PivotService } from './pivotService'

let database: NodeSqliteClient

beforeEach(async () => {
  database = await NodeSqliteClient.create()
  await initializeSqliteDatabase(database)
})

afterEach(async () => {
  await database.close()
})

describe('项目多版本隔离与多维事实视图', () => {
  it('复制方案后可独立保存和计算，基础事实及报告不串版本', async () => {
    const department = await new DepartmentRepository(database).save({ code: 'VER', name: '版本验证部' })
    const service = new ProjectWorkspaceService(database)
    const created = await service.createProject({
      code: 'VER-001', name: '多版本验证项目', departmentId: department.id,
      startPeriod: '2026-01', endPeriod: '2026-02',
    })
    const base = await service.saveWorkspace(created.project.id, {
      versionId: 'working',
      expectedRevision: created.draftRevision,
      draft: {
        project: created.project,
        forecast: {
          parameters: [], cashRules: [], overrides: [],
          lines: [{
            code: 'LINE-001', name: '订阅收入', category: 'revenue',
            forecastMethod: 'fixed_monthly', fixedMonthlyValue: '100',
            startPeriod: '2026-01', endPeriod: '2026-02',
            amountBasis: 'tax_exclusive', taxRate: '0', assumption: '',
            sortOrder: 1, monthlyValues: {},
          }],
        },
      },
    })
    expect((await service.calculate(created.project.id, 'working', base.draftRevision)).success).toBe(true)

    const copied = await service.createVersion(created.project.id, {
      versionId: 'version_1', copyFromVersionId: 'working',
    })
    const sourceLine = copied.forecast.lines[0]
    const growth = await service.saveWorkspace(created.project.id, {
      versionId: copied.currentVersion.versionId,
      expectedRevision: copied.draftRevision,
      draft: {
        project: copied.project,
        forecast: {
          parameters: [], cashRules: [], overrides: [],
          lines: [{
            id: sourceLine.id, code: sourceLine.code, name: sourceLine.name,
            category: sourceLine.category, forecastMethod: 'fixed_monthly',
            fixedMonthlyValue: '150', startPeriod: sourceLine.startPeriod,
            endPeriod: sourceLine.endPeriod, amountBasis: sourceLine.amountBasis,
            taxRate: sourceLine.taxRate, assumption: sourceLine.assumption,
            sortOrder: sourceLine.sortOrder, monthlyValues: {},
          }],
        },
      },
    })
    expect((await service.calculate(created.project.id, growth.currentVersion.versionId, growth.draftRevision)).success).toBe(true)

    const baseReport = await service.buildReport(created.project.id, undefined, 'working')
    const growthReport = await service.buildReport(created.project.id, undefined, growth.currentVersion.versionId)
    expect(baseReport.summary.revenue).toBe('200')
    expect(growthReport.summary.revenue).toBe('300')
    expect(baseReport.version.name).toBe('基准方案')
    expect(growthReport.version.name).toBe('版本 1')
    expect(growthReport.calculatedFacts.every((item) => item.versionId === growth.currentVersion.versionId)).toBe(true)

    const facts = await database.query<{ version_id: string; value_text: string }>(
      `SELECT version_id, value_text FROM fact_metric_value
       WHERE project_id = ? AND metric_code = 'revenue'
       ORDER BY version_id, period`,
      [created.project.id],
    )
    expect(facts).toHaveLength(4)
    expect(new Set(facts.map((item) => item.version_id))).toEqual(new Set(['working', 'version_1']))
  })

  it('只允许项目启用平台预置版本，不能自由创建第四个版本', async () => {
    const department = await new DepartmentRepository(database).save({ code: 'FIX', name: '固定版本部' })
    const service = new ProjectWorkspaceService(database)
    const created = await service.createProject({
      code: 'FIX-001', name: '固定版本验证项目', departmentId: department.id,
      startPeriod: '2026-01', endPeriod: '2026-01',
    })
    const version = await service.createVersion(created.project.id, { versionId: 'version_2' })
    expect(version.currentVersion.name).toBe('版本 2')
    await expect(service.createVersion(created.project.id, { versionId: 'custom-version' }))
      .rejects.toThrow('请选择系统预置版本')
  })

  it('多维视图可同时返回同项目不同版本并重算派生指标', async () => {
    const department = await new DepartmentRepository(database).save({ code: 'PVT', name: '透视验证部' })
    const service = new ProjectWorkspaceService(database)
    const created = await service.createProject({
      code: 'PVT-001', name: '透视验证项目', departmentId: department.id,
      startPeriod: '2026-01', endPeriod: '2026-01',
    })
    const saved = await service.saveWorkspace(created.project.id, {
      versionId: 'working', expectedRevision: 0,
      draft: {
        project: created.project,
        forecast: { parameters: [], cashRules: [], overrides: [], lines: [
          { code: 'LINE-001', name: '收入', category: 'revenue', forecastMethod: 'fixed_monthly', fixedMonthlyValue: '100', startPeriod: '2026-01', endPeriod: '2026-01', amountBasis: 'tax_exclusive', taxRate: '0', assumption: '', sortOrder: 1, monthlyValues: {} },
          { code: 'LINE-002', name: '成本', category: 'cost', forecastMethod: 'fixed_monthly', fixedMonthlyValue: '40', startPeriod: '2026-01', endPeriod: '2026-01', amountBasis: 'tax_exclusive', taxRate: '0', assumption: '', sortOrder: 2, monthlyValues: {} },
        ] },
      },
    })
    await service.calculate(created.project.id, 'working', saved.draftRevision)
    const view = await new PivotService(database).build({
      rows: ['project', 'metric'], columns: ['version'],
      filters: { projectIds: [created.project.id], metricCodes: ['revenue', 'gross_profit', 'gross_margin'] },
    })
    expect(view.sourceFactCount).toBe(2)
    expect(view.cells.find((cell) => cell.rowLabels.at(-1) === '收入')?.value).toBe('100')
    expect(view.cells.find((cell) => cell.rowLabels.at(-1) === '毛利')?.value).toBe('60')
    expect(view.cells.find((cell) => cell.rowLabels.at(-1) === '毛利率')?.value).toBe('0.6')
  })
})
