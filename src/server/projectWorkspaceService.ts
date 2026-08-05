import Decimal from 'decimal.js'
import type {
  CreateProjectInput,
  CreateProjectPlanRequest,
  DepartmentInput,
  FactAdjustmentDraft,
  ForecastProjectDraft,
  ProjectPlanInput,
  ProjectReportDto,
  ProjectWorkspace,
  SaveProjectWorkspaceRequest,
} from '../shared/domain/types'
import type { DatabaseClient } from '../shared/database'
import { DepartmentRepository } from './repositories/departmentRepository'
import { DimensionRepository } from './repositories/dimensionRepository'
import { FactRepository } from './repositories/factRepository'
import { MetricRepository } from './repositories/metricRepository'
import { ProjectRepository } from './repositories/projectRepository'
import { ForecastLineValueRepository } from './repositories/forecastLineValueRepository'
import { ForecastLineRepository } from './repositories/forecastLineRepository'
import { CashScheduleRepository } from './repositories/cashScheduleRepository'
import { ParameterRepository } from './repositories/parameterRepository'
import { FactAdjustmentRepository } from './repositories/factAdjustmentRepository'
import { CalculationService } from './services/calculationService'
import { ProjectReportService } from './services/projectReportService'
import { ProjectPlanRepository } from './repositories/projectPlanRepository'
import { countPeriods, generatePeriods } from '../shared/domain/periods'
import { buildProjectReportPresentation } from './services/reportPresentationService'

const reportAmountFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatReportWan(value: string): string {
  return `${reportAmountFormatter.format(new Decimal(value).div(10_000).toNumber())} 万元`
}

function cloneForecastDraft(source: ProjectWorkspace): ForecastProjectDraft {
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
  return {
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
  }
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
    const [departments, projects, periods, scenarios, plans, metrics, facts] = await Promise.all([
      this.departments.list(), this.projects.list(), dimensions.listPeriods(),
      dimensions.listScenarios(), this.projectPlans.listAll(),
      new MetricRepository(this.database).list(), new FactRepository(this.database).list(),
    ])
    return { departments, projects, periods, scenarios, plans, metrics, facts, storage: { ...this.database.runtime } }
  }

  async createProject(input: CreateProjectInput): Promise<ProjectWorkspace> {
    const project = await this.projects.save(input)
    const plan = await this.projectPlans.create(project.id, {
      name: '方案 1', startPeriod: input.startPeriod, endPeriod: input.endPeriod,
    })
    return this.getWorkspace(project.id, plan.planId)
  }

  async getWorkspace(projectId: string, planId?: string): Promise<ProjectWorkspace> {
    const project = await this.projects.get(projectId)
    if (!project) throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' })
    const projectPlans = await this.projectPlans.list(projectId)
    const fallback = projectPlans.find((item) => item.status === 'active')
    if (!fallback) throw Object.assign(new Error('项目没有可用方案'), { code: 'NOT_FOUND' })
    const requested = projectPlans.find((item) => item.planId === planId && item.status === 'active')
    const currentPlan = requested ?? fallback
    return {
      project, projectPlans, currentPlan, draftRevision: currentPlan.draftRevision,
      forecast: await this.calculations.getProjectState(projectId, currentPlan.planId),
    }
  }

  async saveWorkspace(projectId: string, request: SaveProjectWorkspaceRequest): Promise<ProjectWorkspace> {
    const backup = await this.database.exportDatabase()
    try {
      await this.projectPlans.assertRevision(projectId, request.planId, request.expectedRevision)
      const projectPeriodCount = countPeriods(request.draft.plan.startPeriod, request.draft.plan.endPeriod)
      if (projectPeriodCount < 1) throw Object.assign(new Error('结束期间不能早于开始期间'), { code: 'INVALID_REQUEST' })
      const cashEndPeriod = generatePeriods(request.draft.plan.startPeriod, projectPeriodCount + 36).at(-1)
      if (!cashEndPeriod) throw Object.assign(new Error('方案期间无效'), { code: 'INVALID_REQUEST' })
      const adjustmentRepository = new FactAdjustmentRepository(this.database)
      const invalidAdjustments = await adjustmentRepository.listOutsidePeriod(
        projectId, request.planId, request.draft.plan.startPeriod, request.draft.plan.endPeriod, cashEndPeriod,
      )
      if (invalidAdjustments.length && !request.clearInvalidAdjustments) {
        throw Object.assign(new Error(`新的方案期间会使 ${invalidAdjustments.length} 个人工调整失效，确认后可清理并继续保存`), {
          code: 'ADJUSTMENTS_OUTSIDE_PERIOD',
          fieldErrors: invalidAdjustments.map((item) => ({
            section: 'adjustments', itemId: item.forecastLineId, period: item.period,
            message: '人工调整超出新的有效期间',
          })),
        })
      }
      if (invalidAdjustments.length) await this.database.batch(adjustmentRepository.deleteStatements(invalidAdjustments.map((item) => item.id)))
      const project = await this.projects.save({ ...request.draft.project, id: projectId })
      await this.projectPlans.update(projectId, request.planId, request.draft.plan)
      await this.calculations.saveDraft(project.id, request.planId, request.draft.forecast)
      return this.getWorkspace(project.id, request.planId)
    } catch (reason) {
      await this.database.importDatabase(backup)
      throw reason
    }
  }

  async calculate(projectId: string, planId: string, expectedRevision: number) {
    return this.calculations.calculateSaved(projectId, planId, expectedRevision)
  }

  async saveAdjustments(projectId: string, planId: string, expectedResultRevision: number, adjustments: FactAdjustmentDraft[]) {
    return this.calculations.saveAdjustments(projectId, planId, expectedResultRevision, adjustments)
  }

  async archive(projectId: string) { return this.projects.archive(projectId) }
  async restore(projectId: string) { return this.projects.restore(projectId) }

  async copy(projectId: string): Promise<ProjectWorkspace> {
    const backup = await this.database.exportDatabase()
    try {
      const source = await this.getWorkspace(projectId)
      const existingCodes = new Set((await this.projects.list()).flatMap((project) => project.code ? [project.code] : []))
      const baseCode = source.project.code ? `${source.project.code}-COPY` : undefined
      let code = baseCode
      let suffix = 2
      while (code && existingCodes.has(code)) code = `${baseCode}-${suffix++}`
      const copiedProject = await this.projects.save({ code, name: `${source.project.name} 副本`, departmentId: source.project.departmentId })
      const copiedPlan = await this.projectPlans.create(copiedProject.id, {
        name: source.currentPlan.name, startPeriod: source.currentPlan.startPeriod, endPeriod: source.currentPlan.endPeriod,
      })
      await this.calculations.saveDraft(copiedProject.id, copiedPlan.planId, cloneForecastDraft(source))
      return this.getWorkspace(copiedProject.id, copiedPlan.planId)
    } catch (reason) {
      await this.database.importDatabase(backup)
      throw reason
    }
  }

  async delete(projectId: string): Promise<void> { await this.projects.delete(projectId) }

  async createPlan(projectId: string, request: CreateProjectPlanRequest): Promise<ProjectWorkspace> {
    const backup = await this.database.exportDatabase()
    try {
      const created = await this.projectPlans.create(projectId, request)
      if (request.copyFromPlanId) {
        const source = await this.getWorkspace(projectId, request.copyFromPlanId)
        await this.calculations.saveDraft(projectId, created.planId, cloneForecastDraft(source))
      }
      return this.getWorkspace(projectId, created.planId)
    } catch (reason) {
      await this.database.importDatabase(backup)
      throw reason
    }
  }

  async updatePlan(projectId: string, planId: string, input: Partial<ProjectPlanInput>) {
    const current = await this.projectPlans.get(projectId, planId)
    if (!current) throw Object.assign(new Error('项目方案不存在'), { code: 'NOT_FOUND' })
    return this.projectPlans.update(projectId, planId, {
      name: input.name ?? current.name,
      startPeriod: input.startPeriod ?? current.startPeriod,
      endPeriod: input.endPeriod ?? current.endPeriod,
    })
  }

  async archivePlan(projectId: string, planId: string) { return this.projectPlans.archive(projectId, planId) }
  async restorePlan(projectId: string, planId: string) { return this.projectPlans.restore(projectId, planId) }
  async saveDepartment(input: DepartmentInput) { return this.departments.save(input) }
  async setDepartmentStatus(id: string, status: 'active' | 'inactive') { return this.departments.setStatus(id, status) }

  async buildReport(projectId: string, planId?: string): Promise<ProjectReportDto> {
    const [project, scenarios, projectPlans] = await Promise.all([
      this.projects.get(projectId), new DimensionRepository(this.database).listScenarios(), this.projectPlans.list(projectId),
    ])
    if (!project) throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' })
    const requestedPlan = projectPlans.find((item) => item.planId === planId && item.status === 'active')
      ?? projectPlans.find((item) => item.status === 'active')
    if (!requestedPlan) throw Object.assign(new Error('项目没有可用方案'), { code: 'NOT_FOUND' })
    const scenario = scenarios.find((item) => item.isDefault)
    if (!scenario) throw new Error('缺少基准场景')
    const reportQuery = { projectId, scenarioId: scenario.id, planId: requestedPlan.planId }
    const [state, report, lines, lineBreakdown, cashSchedule, parameters, parameterValues, adjustments] = await Promise.all([
      this.calculations.getProjectState(projectId, requestedPlan.planId),
      new ProjectReportService(this.database).build(reportQuery),
      new ForecastLineRepository(this.database).list(projectId, requestedPlan.planId),
      new ForecastLineValueRepository(this.database).listBreakdown(projectId, requestedPlan.planId),
      new CashScheduleRepository(this.database).list(projectId, requestedPlan.planId),
      new ParameterRepository(this.database).list(projectId, requestedPlan.planId),
      new ParameterRepository(this.database).listValues(projectId, requestedPlan.planId),
      new FactAdjustmentRepository(this.database).list(projectId, requestedPlan.planId),
    ])
    const grossMargin = report.summary.grossMargin
    const measurementSummary = [
      `方案经营期为 ${report.plan.startPeriod} 至 ${report.operationEndPeriod}。`,
      report.hasFacts
        ? `当前结果收入 ${formatReportWan(report.summary.revenue)}、成本 ${formatReportWan(report.summary.cost)}。`
        : '当前方案尚无可展示事实。',
      grossMargin === null ? '收入为零，毛利率不适用。' : `汇总毛利率为 ${(Number(grossMargin) * 100).toFixed(1)}%。`,
    ]
    const riskNotes = [
      ...(!state.isResultCurrent && state.calculationState?.lastSuccessAt ? ['当前配置已变更，报告仍基于最近一次成功计算结果。'] : []),
      ...(adjustments.length ? [`存在 ${adjustments.length} 个人工底稿调整，请重点复核。`] : []),
      ...(report.hasCashFacts && report.summary.maximumFunding !== '0' ? [`预测期内最大垫资为 ${formatReportWan(report.summary.maximumFunding)}。`] : []),
    ]
    return {
      ...report,
      calculationState: state.calculationState,
      lineBreakdown,
      cashSchedule,
      adjustments,
      keyAssumptions: parameters.map((item) => ({
        code: item.code, name: item.name,
        value: item.fixedValue === undefined ? '逐月维护' : item.valueType === 'percentage' ? new Decimal(item.fixedValue).times(100).toString() : item.fixedValue,
        unit: item.unit,
      })),
      measurementSummary,
      riskNotes,
      isBehindDraft: !state.isResultCurrent,
      presentation: buildProjectReportPresentation({
        report,
        lines,
        breakdown: lineBreakdown,
        parameters,
        parameterValues,
        adjustments,
      }),
    }
  }
}
