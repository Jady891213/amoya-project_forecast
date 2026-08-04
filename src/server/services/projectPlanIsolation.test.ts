import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeSqliteDatabase } from '../../app/storage/sqlite/initialize'
import { NodeSqliteClient } from '../../app/test/nodeSqliteClient'
import { DepartmentRepository } from '../repositories/departmentRepository'
import { ProjectPlanRepository } from '../repositories/projectPlanRepository'
import { ProjectWorkspaceService } from '../projectWorkspaceService'
import { PivotService } from './pivotService'

let database: NodeSqliteClient
beforeEach(async () => { database = await NodeSqliteClient.create(); await initializeSqliteDatabase(database) })
afterEach(async () => { await database.close() })

describe('项目方案隔离与项目报表', () => {
  it('约束默认方案、归档恢复和项目与方案的合法组合', async () => {
    const department = await new DepartmentRepository(database).save({ code: 'LIFE', name: '方案生命周期部' })
    const service = new ProjectWorkspaceService(database)
    const projectA = await service.createProject({ code: 'LIFE-A', name: '方案项目 A', departmentId: department.id, startPeriod: '2026-01', endPeriod: '2026-03' })
    const projectB = await service.createProject({ code: 'LIFE-B', name: '方案项目 B', departmentId: department.id, startPeriod: '2026-01', endPeriod: '2026-03' })
    const second = await service.createPlan(projectA.project.id, { name: '备选方案', startPeriod: '2026-01', endPeriod: '2026-03' })

    await expect(service.archivePlan(projectA.project.id, projectA.currentPlan.planId)).rejects.toThrow('默认方案不能归档')
    await service.updatePlan(projectA.project.id, second.currentPlan.planId, { isDefault: true })
    await service.archivePlan(projectA.project.id, projectA.currentPlan.planId)
    await expect(service.archivePlan(projectA.project.id, second.currentPlan.planId)).rejects.toThrow('至少保留一个有效方案')
    await service.restorePlan(projectA.project.id, projectA.currentPlan.planId)

    const activePlans = (await new ProjectPlanRepository(database).list(projectA.project.id, false))
    expect(activePlans).toHaveLength(2)
    expect(activePlans.filter((plan) => plan.isDefault).map((plan) => plan.planId)).toEqual([second.currentPlan.planId])

    await expect(database.execute(
      `INSERT INTO cfg_model_line
       (id, project_id, plan_id, code, name, line_type, category, calculation_method, start_period, end_period, unit, config_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'parameter', NULL, 'fixed', '2026-01', '2026-03', '', '{}', 1, ?, ?)`,
      ['illegal-project-plan', projectB.project.id, second.currentPlan.planId, 'PAR-ILLEGAL', '非法组合', new Date().toISOString(), new Date().toISOString()],
    )).rejects.toThrow()
  })

  it('复制方案后配置、事实和报告相互隔离', async () => {
    const department = await new DepartmentRepository(database).save({ code: 'PLAN', name: '方案验证部' })
    const service = new ProjectWorkspaceService(database)
    const created = await service.createProject({ code: 'PLAN-001', name: '方案验证项目', departmentId: department.id, startPeriod: '2026-01', endPeriod: '2026-02' })
    const baseId = created.currentPlan.planId
    const saveWithAmount = async (workspace: typeof created, amount: string) => service.saveWorkspace(created.project.id, {
      planId: workspace.currentPlan.planId, expectedRevision: workspace.draftRevision,
      draft: { project: { ...workspace.project, startPeriod: workspace.currentPlan.startPeriod, endPeriod: workspace.currentPlan.endPeriod }, plan: { name: workspace.currentPlan.name, startPeriod: workspace.currentPlan.startPeriod, endPeriod: workspace.currentPlan.endPeriod }, forecast: { parameters: [], cashRules: [], overrides: [], lines: [{ code: 'LINE-001', name: '订阅收入', category: 'revenue', forecastMethod: 'fixed_monthly', fixedMonthlyValue: amount, startPeriod: '2026-01', endPeriod: '2026-02', amountBasis: 'tax_exclusive', taxRate: '0', assumption: '', sortOrder: 1, monthlyValues: {} }] } },
    })
    const base = await saveWithAmount(created, '100')
    expect((await service.calculate(created.project.id, baseId, base.draftRevision)).success).toBe(true)
    const copied = await service.createPlan(created.project.id, { name: '增长方案', startPeriod: '2026-01', endPeriod: '2026-02', copyFromPlanId: baseId })
    const growth = await saveWithAmount(copied, '150')
    expect((await service.calculate(created.project.id, copied.currentPlan.planId, growth.draftRevision)).success).toBe(true)
    expect((await service.buildReport(created.project.id, undefined, baseId)).summary.revenue).toBe('200')
    expect((await service.buildReport(created.project.id, undefined, copied.currentPlan.planId)).summary.revenue).toBe('300')
    const facts = await database.query<{ plan_id: string }>("SELECT plan_id FROM fact_metric_value WHERE project_id = ? AND metric_code = 'revenue'", [created.project.id])
    expect(new Set(facts.map((item) => item.plan_id))).toEqual(new Set([baseId, copied.currentPlan.planId]))
  })

  it('项目报表按方案分开并在合法聚合后重算派生指标', async () => {
    const department = await new DepartmentRepository(database).save({ code: 'PVT', name: '透视验证部' })
    const service = new ProjectWorkspaceService(database)
    const workspace = await service.createProject({ code: 'PVT-001', name: '透视验证项目', departmentId: department.id, startPeriod: '2026-01', endPeriod: '2026-01' })
    const saved = await service.saveWorkspace(workspace.project.id, { planId: workspace.currentPlan.planId, expectedRevision: 0, draft: { project: { ...workspace.project, startPeriod: '2026-01', endPeriod: '2026-01' }, plan: { name: '默认方案', startPeriod: '2026-01', endPeriod: '2026-01' }, forecast: { parameters: [], cashRules: [], overrides: [], lines: [
      { code: 'LINE-001', name: '收入', category: 'revenue', forecastMethod: 'fixed_monthly', fixedMonthlyValue: '100', startPeriod: '2026-01', endPeriod: '2026-01', amountBasis: 'tax_exclusive', taxRate: '0', assumption: '', sortOrder: 1, monthlyValues: {} },
      { code: 'LINE-002', name: '成本', category: 'cost', forecastMethod: 'fixed_monthly', fixedMonthlyValue: '40', startPeriod: '2026-01', endPeriod: '2026-01', amountBasis: 'tax_exclusive', taxRate: '0', assumption: '', sortOrder: 2, monthlyValues: {} },
    ] } } })
    await service.calculate(workspace.project.id, workspace.currentPlan.planId, saved.draftRevision)
    const view = await new PivotService(database).build({ rows: [{ dimension: 'plan', memberIds: [workspace.currentPlan.planId] }, { dimension: 'metric', memberIds: ['revenue', 'gross_profit', 'gross_margin'] }], columns: [{ dimension: 'period', memberIds: ['2026-01'] }], pov: [{ dimension: 'project', memberId: workspace.project.id }, { dimension: 'department', memberId: department.id }], scenarioId: 'baseline' })
    expect(view.sourceFactCount).toBe(2)
    const value = (metric: string) => view.cells.find((cell) => view.rowTuples.find((tuple) => tuple.key === cell.rowKey)?.members.some((member) => member.memberId === metric))?.value
    expect(value('revenue')).toBe('100'); expect(value('gross_profit')).toBe('60'); expect(value('gross_margin')).toBe('0.6')
  })

  it('跨项目查询直接比较方案且不会把互斥方案合并', async () => {
    const department = await new DepartmentRepository(database).save({ code: 'CROSS', name: '跨项目验证部' })
    const service = new ProjectWorkspaceService(database)
    const buildProject = async (code: string, name: string, amount: string) => {
      const workspace = await service.createProject({ code, name, departmentId: department.id, startPeriod: '2026-01', endPeriod: '2026-01' })
      const saved = await service.saveWorkspace(workspace.project.id, {
        planId: workspace.currentPlan.planId,
        expectedRevision: 0,
        draft: {
          project: { ...workspace.project, startPeriod: '2026-01', endPeriod: '2026-01' },
          plan: { name: '推荐方案', startPeriod: '2026-01', endPeriod: '2026-01' },
          forecast: { parameters: [], cashRules: [], overrides: [], lines: [{ code: 'LINE-001', name: '收入', category: 'revenue', forecastMethod: 'fixed_monthly', fixedMonthlyValue: amount, startPeriod: '2026-01', endPeriod: '2026-01', amountBasis: 'tax_exclusive', taxRate: '0', assumption: '', sortOrder: 1, monthlyValues: {} }] },
        },
      })
      await service.calculate(workspace.project.id, workspace.currentPlan.planId, saved.draftRevision)
      return workspace
    }
    const projectA = await buildProject('CROSS-A', '跨项目 A', '100')
    const projectB = await buildProject('CROSS-B', '跨项目 B', '200')
    const view = await new PivotService(database).build({
      rows: [{ dimension: 'plan', memberIds: [projectA.currentPlan.planId, projectB.currentPlan.planId] }, { dimension: 'metric', memberIds: ['revenue'] }],
      columns: [{ dimension: 'period', memberIds: ['2026-01'] }],
      pov: [{ dimension: 'project', memberId: '__all_projects__' }, { dimension: 'department', memberId: '__all_departments__' }],
      scenarioId: 'baseline',
    })
    expect(view.sourceFactCount).toBe(2)
    expect(view.rowTuples.map((tuple) => tuple.members[0].label)).toEqual(['跨项目 A（推荐方案）', '跨项目 B（推荐方案）'])
    expect(view.cells.map((cell) => cell.value).sort()).toEqual(['100', '200'])
  })
})
