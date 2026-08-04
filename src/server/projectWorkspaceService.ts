import Decimal from 'decimal.js'
import type {
  BaseFact,
  CreateProjectInput,
  CreateProjectPlanRequest,
  DepartmentInput,
  ForecastProjectDraft,
  ProjectPlanInput,
  ProjectReportDto,
  ProjectWorkspace,
  SaveProjectWorkspaceRequest,
} from '../shared/domain/types'
import type { DatabaseClient } from '../app/storage/types'
import { DepartmentRepository } from './repositories/departmentRepository'
import { DimensionRepository } from './repositories/dimensionRepository'
import { FactRepository } from './repositories/factRepository'
import { MetricRepository } from './repositories/metricRepository'
import { ProjectRepository } from './repositories/projectRepository'
import { CalculationRunRepository } from './repositories/calculationRunRepository'
import { ForecastLineValueRepository } from './repositories/forecastLineValueRepository'
import { CashScheduleRepository } from './repositories/cashScheduleRepository'
import { ParameterRepository } from './repositories/parameterRepository'
import { CalculationService } from './services/calculationService'
import { ProjectReportService } from './services/projectReportService'
import { ForecastOverrideRepository } from './repositories/forecastOverrideRepository'
import { ProjectPlanRepository } from './repositories/projectPlanRepository'

const reportAmountFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatReportWan(value: string): string {
  return `${reportAmountFormatter.format(new Decimal(value).div(10_000).toNumber())} 万元`
}

export class ProjectWorkspaceService {
  private readonly projects: ProjectRepository
  private readonly departments: DepartmentRepository
  private readonly calculations: CalculationService
  private readonly projectPlans: ProjectPlanRepository

  constructor(private readonly database: DatabaseClient) {
    this.projects = new ProjectRepository(database)
    this.departments = new DepartmentRepository(database)
    this.calculations = new CalculationService(database)
    this.projectPlans = new ProjectPlanRepository(database)
  }

  async bootstrap() {
    const dimensions = new DimensionRepository(this.database)
    const [departments, projects, periods, scenarios, plans, metrics, facts] =
      await Promise.all([
        this.departments.list(),
        this.projects.list(),
        dimensions.listPeriods(),
        dimensions.listScenarios(),
        this.projectPlans.listAll(),
        new MetricRepository(this.database).list(),
        new FactRepository(this.database).list(),
      ])
    return {
      departments,
      projects,
      periods,
      scenarios,
      plans,
      metrics,
      facts,
      storage: { ...this.database.runtime },
    }
  }

  async createProject(input: CreateProjectInput): Promise<ProjectWorkspace> {
    const project = await this.projects.save(input)
    const plan = await this.projectPlans.create(project.id, {
      name: '默认方案',
      startPeriod: input.startPeriod,
      endPeriod: input.endPeriod,
    }, true)
    return this.getWorkspace(project.id, plan.planId)
  }

  async getWorkspace(projectId: string, planId?: string): Promise<ProjectWorkspace> {
    const project = await this.projects.get(projectId)
    if (!project) throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' })
    const projectPlans = await this.projectPlans.list(projectId)
    const fallback = projectPlans.find((item) => item.isDefault && item.status === 'active')
      ?? projectPlans.find((item) => item.status === 'active')
    if (!fallback) throw Object.assign(new Error('项目没有可用方案'), { code: 'NOT_FOUND' })
    const currentPlan = projectPlans.find((item) => item.planId === planId)
      ?? fallback
    const forecast = await this.calculations.getProjectState(projectId, currentPlan.planId)
    return {
      project,
      projectPlans,
      currentPlan,
      draftRevision: currentPlan.draftRevision,
      forecast,
    }
  }

  async saveWorkspace(
    projectId: string,
    request: SaveProjectWorkspaceRequest,
  ): Promise<ProjectWorkspace> {
    const backup = await this.database.exportDatabase()
    try {
      await this.projectPlans.assertRevision(projectId, request.planId, request.expectedRevision)
      const project = await this.projects.save(
        { ...request.draft.project, id: projectId },
      )
      await this.projectPlans.update(projectId, request.planId, request.draft.plan)
      await this.calculations.saveDraft(project.id, request.planId, request.draft.forecast)
      return await this.getWorkspace(project.id, request.planId)
    } catch (reason) {
      await this.database.importDatabase(backup)
      throw reason
    }
  }

  async calculate(projectId: string, planId: string, expectedRevision: number) {
    return this.calculations.calculateSaved(projectId, planId, expectedRevision)
  }

  async archive(projectId: string) {
    return this.projects.archive(projectId)
  }

  async restore(projectId: string) {
    return this.projects.restore(projectId)
  }

  async copy(projectId: string): Promise<ProjectWorkspace> {
    const backup = await this.database.exportDatabase()
    try {
      const source = await this.getWorkspace(projectId)
      const existingCodes = new Set(
        (await this.projects.list()).flatMap((project) => project.code ? [project.code] : []),
      )
      const baseCode = source.project.code ? `${source.project.code}-COPY` : undefined
      let code = baseCode
      let suffix = 2
      while (code && existingCodes.has(code)) code = `${baseCode}-${suffix++}`

      const copiedProject = await this.projects.save({
        code,
        name: `${source.project.name} 副本`,
        departmentId: source.project.departmentId,
      })
      const copiedPlan = await this.projectPlans.create(copiedProject.id, {
        name: source.currentPlan.name,
        startPeriod: source.currentPlan.startPeriod,
        endPeriod: source.currentPlan.endPeriod,
      }, true)
      const lineValues = new Map<string, Record<string, string>>()
      source.forecast.values.forEach((item) => {
        const values = lineValues.get(item.lineId) ?? {}
        values[item.period] = item.value
        lineValues.set(item.lineId, values)
      })
      const parameterValues = new Map<string, Record<string, string>>()
      source.forecast.parameterValues.forEach((item) => {
        const values = parameterValues.get(item.parameterId) ?? {}
        const parameter = source.forecast.parameters.find((candidate) => candidate.id === item.parameterId)
        values[item.period] = parameter?.valueType === 'percentage'
          ? new Decimal(item.value).times(100).toString()
          : item.value
        parameterValues.set(item.parameterId, values)
      })
      const draft: ForecastProjectDraft = {
        lines: source.forecast.lines.map((line) => ({
          code: line.code,
          name: line.name,
          category: line.category,
          forecastMethod: line.forecastMethod,
          startPeriod: line.startPeriod,
          endPeriod: line.endPeriod,
          fixedMonthlyValue: line.fixedMonthlyValue,
          formulaExpression: line.formulaExpression,
          calculationPreset: line.calculationPreset,
          calculationConfig: line.calculationConfig,
          amountBasis: line.amountBasis,
          taxRate: line.taxRate,
          assumption: line.assumption,
          sortOrder: line.sortOrder,
          monthlyValues: lineValues.get(line.id) ?? {},
        })),
        parameters: source.forecast.parameters.map((parameter) => ({
          code: parameter.code,
          name: parameter.name,
          parameterType: parameter.parameterType,
          valueType: parameter.valueType,
          unit: parameter.unit,
          fixedValue: parameter.valueType === 'percentage' && parameter.fixedValue
            ? new Decimal(parameter.fixedValue).times(100).toString()
            : parameter.fixedValue,
          description: parameter.description,
          sortOrder: parameter.sortOrder,
          monthlyValues: parameterValues.get(parameter.id) ?? {},
        })),
        cashRules: source.forecast.cashRules.map((rule) => ({
          sourceLineCode: rule.sourceLineCode,
          method: rule.method,
          delayMonths: rule.delayMonths,
          monthlyValues: rule.monthlyValues,
          installments: rule.installments.map((item) => ({
            sequence: item.sequence,
            offsetMonths: item.offsetMonths,
            ratio: item.ratio,
          })),
        })),
        overrides: [],
      }
      const copiedState = await this.calculations.saveDraft(copiedProject.id, copiedPlan.planId, draft)
      const sourceLineCodeById = new Map(source.forecast.lines.map((line) => [line.id, line.code]))
      const copiedLineIdByCode = new Map(copiedState.lines.map((line) => [line.code, line.id]))
      await new ForecastOverrideRepository(this.database).saveProjectDraft(
        copiedProject.id,
        copiedPlan.planId,
        source.forecast.overrides.flatMap((override) => {
          const copiedLineId = copiedLineIdByCode.get(sourceLineCodeById.get(override.forecastLineId) ?? '')
          return copiedLineId ? [{
            forecastLineId: copiedLineId,
            period: override.period,
            originalValue: override.originalValue,
            overrideValue: override.overrideValue,
            reason: override.reason,
          }] : []
        }),
      )
      return this.getWorkspace(copiedProject.id, copiedPlan.planId)
    } catch (reason) {
      await this.database.importDatabase(backup)
      throw reason
    }
  }

  async delete(projectId: string): Promise<void> {
    const project = await this.projects.get(projectId)
    if (!project) throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' })
    await this.database.execute('DELETE FROM dim_project WHERE id = ?', [projectId])
  }

  async createPlan(projectId: string, request: CreateProjectPlanRequest): Promise<ProjectWorkspace> {
    const backup = await this.database.exportDatabase()
    try {
      const created = await this.projectPlans.create(projectId, request)
      if (request.copyFromPlanId) {
        const source = await this.getWorkspace(projectId, request.copyFromPlanId)
        const lineValues = new Map<string, Record<string, string>>()
        source.forecast.values.forEach((item) => {
          const values = lineValues.get(item.lineId) ?? {}
          values[item.period] = item.value
          lineValues.set(item.lineId, values)
        })
        const parameterValues = new Map<string, Record<string, string>>()
        source.forecast.parameterValues.forEach((item) => {
          const values = parameterValues.get(item.parameterId) ?? {}
          const parameter = source.forecast.parameters.find((candidate) => candidate.id === item.parameterId)
          values[item.period] = parameter?.valueType === 'percentage'
            ? new Decimal(item.value).times(100).toString()
            : item.value
          parameterValues.set(item.parameterId, values)
        })
        const draft: ForecastProjectDraft = {
          lines: source.forecast.lines.map((line) => ({
            code: line.code,
            name: line.name,
            category: line.category,
            forecastMethod: line.forecastMethod,
            startPeriod: line.startPeriod,
            endPeriod: line.endPeriod,
            fixedMonthlyValue: line.fixedMonthlyValue,
            formulaExpression: line.formulaExpression,
            calculationPreset: line.calculationPreset,
            calculationConfig: line.calculationConfig,
            amountBasis: line.amountBasis,
            taxRate: line.taxRate,
            assumption: line.assumption,
            sortOrder: line.sortOrder,
            monthlyValues: lineValues.get(line.id) ?? {},
          })),
          parameters: source.forecast.parameters.map((parameter) => ({
            code: parameter.code,
            name: parameter.name,
            parameterType: parameter.parameterType,
            valueType: parameter.valueType,
            unit: parameter.unit,
            fixedValue: parameter.valueType === 'percentage' && parameter.fixedValue
              ? new Decimal(parameter.fixedValue).times(100).toString()
              : parameter.fixedValue,
            description: parameter.description,
            sortOrder: parameter.sortOrder,
            monthlyValues: parameterValues.get(parameter.id) ?? {},
          })),
          cashRules: source.forecast.cashRules.map((rule) => ({
            sourceLineCode: rule.sourceLineCode,
            method: rule.method,
            delayMonths: rule.delayMonths,
            monthlyValues: { ...rule.monthlyValues },
            installments: rule.installments.map((item) => ({
              sequence: item.sequence,
              offsetMonths: item.offsetMonths,
              ratio: item.ratio,
            })),
          })),
          overrides: [],
        }
        const copiedState = await this.calculations.saveDraft(projectId, created.planId, draft)
        const sourceLineCodeById = new Map(source.forecast.lines.map((line) => [line.id, line.code]))
        const copiedLineIdByCode = new Map(copiedState.lines.map((line) => [line.code, line.id]))
        await new ForecastOverrideRepository(this.database).saveProjectDraft(
          projectId,
          created.planId,
          source.forecast.overrides.flatMap((override) => {
            const lineId = copiedLineIdByCode.get(sourceLineCodeById.get(override.forecastLineId) ?? '')
            return lineId ? [{
              forecastLineId: lineId,
              period: override.period,
              originalValue: override.originalValue,
              overrideValue: override.overrideValue,
              reason: override.reason,
            }] : []
          }),
        )
      }
      return this.getWorkspace(projectId, created.planId)
    } catch (reason) {
      await this.database.importDatabase(backup)
      throw reason
    }
  }

  async updatePlan(projectId: string, planId: string, input: Partial<ProjectPlanInput> & { isDefault?: boolean }) {
    const current = await this.projectPlans.get(projectId, planId)
    if (!current) throw Object.assign(new Error('项目方案不存在'), { code: 'NOT_FOUND' })
    return this.projectPlans.update(projectId, planId, {
      name: input.name ?? current.name,
      startPeriod: input.startPeriod ?? current.startPeriod,
      endPeriod: input.endPeriod ?? current.endPeriod,
      isDefault: input.isDefault,
    })
  }

  async archivePlan(projectId: string, planId: string) {
    return this.projectPlans.archive(projectId, planId)
  }

  async restorePlan(projectId: string, planId: string) {
    return this.projectPlans.restore(projectId, planId)
  }

  async saveDepartment(input: DepartmentInput) {
    return this.departments.save(input)
  }

  async setDepartmentStatus(id: string, status: 'active' | 'inactive') {
    return this.departments.setStatus(id, status)
  }

  async buildReport(projectId: string, runId?: string, planId?: string): Promise<ProjectReportDto> {
    const runRepository = new CalculationRunRepository(this.database)
    const [project, scenarios, projectPlans] = await Promise.all([
      this.projects.get(projectId),
      new DimensionRepository(this.database).listScenarios(),
      this.projectPlans.list(projectId),
    ])
    if (!project) throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' })
    const requestedPlan = projectPlans.find((item) => item.planId === planId)
      ?? projectPlans.find((item) => item.isDefault && item.status === 'active')
      ?? projectPlans.find((item) => item.status === 'active')
    if (!requestedPlan) throw Object.assign(new Error('项目没有可用方案'), { code: 'NOT_FOUND' })
    const [availableRuns, state] = await Promise.all([
      runRepository.listSuccess(projectId, requestedPlan.planId),
      this.calculations.getProjectState(projectId, requestedPlan.planId),
    ])
    const selectedRun = runId
      ? availableRuns.find((item) => item.id === runId)
      : availableRuns[0]
    if (runId && !selectedRun) {
      throw Object.assign(new Error('所选成功计算批次不存在'), { code: 'NOT_FOUND' })
    }
    const scenario = scenarios.find((item) => item.isDefault)
    if (!scenario) throw new Error('缺少基准场景')
    const reportQuery = {
      projectId,
      scenarioId: selectedRun?.scenarioId ?? scenario.id,
      planId: selectedRun?.planId ?? requestedPlan.planId,
    }
    let projectSnapshot = project
    let planSnapshot = requestedPlan
    if (selectedRun?.projectSnapshotJson) {
      try {
        const parsed = JSON.parse(selectedRun.projectSnapshotJson)
        projectSnapshot = { ...project, id: parsed.id ?? project.id, code: parsed.code ?? project.code, name: parsed.name ?? project.name, departmentId: parsed.departmentId ?? project.departmentId, status: parsed.status ?? project.status }
        planSnapshot = { ...requestedPlan, name: parsed.planName ?? requestedPlan.name, startPeriod: parsed.startPeriod ?? requestedPlan.startPeriod, endPeriod: parsed.endPeriod ?? requestedPlan.endPeriod }
      }
      catch { projectSnapshot = project }
    }
    const reportService = new ProjectReportService(this.database)
    const report = selectedRun
      ? await reportService.buildFromFacts(
          reportQuery,
          await this.buildFactsForRun(projectId, selectedRun.id),
          projectSnapshot,
          planSnapshot,
        )
      : await reportService.build(reportQuery)
    const [lineBreakdown, cashSchedule] = await Promise.all([
      selectedRun
        ? new ForecastLineValueRepository(this.database).listBreakdown(selectedRun.id)
        : Promise.resolve([]),
      selectedRun
        ? new CashScheduleRepository(this.database).listByRun(selectedRun.id)
        : Promise.resolve([]),
    ])
    let snapshotParameters = await new ParameterRepository(this.database).list(projectId, requestedPlan.planId)
    let snapshotOverrides = state.overrides
    if (selectedRun?.configSnapshotJson) {
      try {
        const parsed = JSON.parse(selectedRun.configSnapshotJson)
        snapshotParameters = parsed.parameters ?? snapshotParameters
        snapshotOverrides = parsed.overrides ?? snapshotOverrides
      } catch { /* keep current values */ }
    }
    const grossMargin = report.summary.grossMargin
    const measurementSummary = [
      `方案经营期为 ${report.plan.startPeriod} 至 ${report.operationEndPeriod}。`,
      report.hasFacts
        ? `本批次收入 ${formatReportWan(report.summary.revenue)}、成本 ${formatReportWan(report.summary.cost)}。`
        : '当前批次尚无可展示事实。',
      grossMargin === null
        ? '收入为零，毛利率不适用。'
        : `汇总毛利率为 ${(Number(grossMargin) * 100).toFixed(1)}%。`,
    ]
    const riskNotes = [
      ...(selectedRun && selectedRun.configHash !== state.currentConfigHash ? ['当前计算配置已变更，报告仍基于所选成功批次。'] : []),
      ...(snapshotOverrides.length > 0 ? [`存在 ${snapshotOverrides.length} 个人工期间覆盖，请重点复核。`] : []),
      ...(report.hasCashFacts && report.summary.maximumFunding !== '0'
        ? [`预测期内最大垫资为 ${formatReportWan(report.summary.maximumFunding)}。`]
        : []),
    ]
    return {
      ...report,
      calculationRun: selectedRun,
      availableRuns,
      projectSnapshot,
      planSnapshot,
      lineBreakdown,
      cashSchedule,
      overrides: snapshotOverrides,
      keyAssumptions: snapshotParameters.map((item: { code: string; name: string; fixedValue?: string; unit: string; valueType?: string }) => ({
        code: item.code,
        name: item.name,
        value: item.fixedValue === undefined
          ? '逐月维护'
          : item.valueType === 'percentage'
            ? new Decimal(item.fixedValue).times(100).toString()
            : item.fixedValue,
        unit: item.unit,
      })),
      measurementSummary,
      riskNotes,
      isBehindDraft: Boolean(selectedRun && selectedRun.configHash !== state.currentConfigHash),
    }
  }

  private async buildFactsForRun(projectId: string, runId: string): Promise<BaseFact[]> {
    const rows = await this.database.query<{
      department_id: string
      period: string
      scenario_id: string
      plan_id: string
      metric_code: BaseFact['metricCode']
      value_text: string
    }>(
      `SELECT department_id, period, scenario_id,
              plan_id, metric_code, value_text
       FROM fact_forecast_line_value
       WHERE project_id = ? AND calculation_run_id = ?
       UNION ALL
       SELECT department_id, settlement_period AS period,
              scenario_id, plan_id, metric_code, value_text
       FROM fact_cash_schedule_value
       WHERE project_id = ? AND calculation_run_id = ?`,
      [projectId, runId, projectId, runId],
    )
    const aggregates = new Map<string, typeof rows[number] & { value: Decimal }>()
    rows.forEach((row) => {
      const key = [row.department_id, row.period, row.scenario_id, row.plan_id, row.metric_code].join(':')
      const aggregate = aggregates.get(key) ?? { ...row, value: new Decimal(0) }
      aggregate.value = aggregate.value.plus(row.value_text)
      aggregates.set(key, aggregate)
    })
    return Array.from(aggregates.values()).map((row, index) => ({
      id: `${runId}:${index}`,
      projectId,
      departmentId: row.department_id,
      period: row.period,
      scenarioId: row.scenario_id,
      planId: row.plan_id,
      metricCode: row.metric_code,
      value: row.value.toDecimalPlaces(6).toString(),
      sourceLabel: '计算批次重建',
      calculationRunId: runId,
      origin: 'user',
    }))
  }
}
