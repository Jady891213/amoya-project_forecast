import Decimal from 'decimal.js'
import type {
  BaseMetricCode,
  CalculationIssue,
  CompiledCashScheduleValue,
  CompiledLineValue,
  FactAdjustmentDraft,
  ForecastLineDraft,
  ForecastProjectDraft,
  ForecastProjectState,
  PlanCalculationState,
  Project,
} from '../../shared/domain/types'
import type { DatabaseClient, SqlStatement } from '../../shared/database'
import { ForecastLineRepository } from '../repositories/forecastLineRepository'
import { ForecastValueRepository } from '../repositories/forecastValueRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { ParameterRepository } from '../repositories/parameterRepository'
import { CashRuleRepository } from '../repositories/cashRuleRepository'
import { FactAdjustmentRepository } from '../repositories/factAdjustmentRepository'
import { ProjectPlanRepository } from '../repositories/projectPlanRepository'
import { PlanCalculationStateRepository, calculationStateUpsert } from '../repositories/planCalculationStateRepository'
import { countPeriods, generatePeriodRange, generatePeriods } from '../../shared/domain/periods'
import { buildForecastConfigHash, compileForecast } from '../../shared/calculation/forecastCompiler'
import { compileCashSchedule } from '../../shared/calculation/cashScheduleCompiler'
export { previewForecastDraft } from '../../shared/calculation/previewForecastDraft'

export interface SaveAndCalculateResult {
  success: boolean
  state: PlanCalculationState
  issues: CalculationIssue[]
}

function validateDraftCoordinates(projectPeriods: string[], cashPeriods: string[], drafts: ForecastLineDraft[]) {
  if (projectPeriods.length === 0) throw new Error('项目预测周期无效')
  drafts.forEach((draft) => {
    const allowedPeriods = draft.category === 'cash_inflow' || draft.category === 'cash_outflow' ? cashPeriods : projectPeriods
    if (!allowedPeriods.includes(draft.startPeriod) || !allowedPeriods.includes(draft.endPeriod)) {
      throw new Error(draft.category === 'cash_inflow' || draft.category === 'cash_outflow'
        ? '其他现金事项必须位于经营期开始至结束后36个月内'
        : '收入和成本行必须位于项目经营周期内')
    }
  })
}

function metricFactStatements(
  project: Project,
  planId: string,
  lineValues: Array<Pick<CompiledLineValue, 'lineId' | 'period' | 'metricCode' | 'value'>>,
  cashValues: Array<Pick<CompiledCashScheduleValue, 'settlementPeriod' | 'metricCode' | 'value'>>,
  adjustments: FactAdjustmentDraft[],
  now: string,
): SqlStatement[] {
  const adjustmentByCoordinate = new Map(adjustments.map((item) => [`${item.forecastLineId}:${item.period}`, item]))
  const aggregates = new Map<string, { period: string; metricCode: BaseMetricCode; value: Decimal }>()
  lineValues.forEach((compiled) => {
    const adjustment = adjustmentByCoordinate.get(`${compiled.lineId}:${compiled.period}`)
    const value = new Decimal(adjustment?.adjustedValue ?? compiled.value)
    const key = `${compiled.period}:${compiled.metricCode}`
    const aggregate = aggregates.get(key) ?? { period: compiled.period, metricCode: compiled.metricCode, value: new Decimal(0) }
    aggregate.value = aggregate.value.plus(value)
    aggregates.set(key, aggregate)
  })
  cashValues.forEach((compiled) => {
    const key = `${compiled.settlementPeriod}:${compiled.metricCode}`
    const aggregate = aggregates.get(key) ?? { period: compiled.settlementPeriod, metricCode: compiled.metricCode, value: new Decimal(0) }
    aggregate.value = aggregate.value.plus(compiled.value)
    aggregates.set(key, aggregate)
  })
  const statements: SqlStatement[] = [{
    sql: `DELETE FROM fact_metric_value WHERE project_id = ? AND plan_id = ? AND scenario_id = 'baseline'`,
    params: [project.id, planId],
  }]
  aggregates.forEach((aggregate) => statements.push({
    sql: `INSERT INTO fact_metric_value (
      id, project_id, department_id, period, scenario_id, plan_id,
      metric_code, value_text, source_label, origin, dataset_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'baseline', ?, ?, ?, '最新有效结果', 'user', NULL, ?, ?)`,
    params: [crypto.randomUUID(), project.id, project.departmentId, aggregate.period, planId,
      aggregate.metricCode, aggregate.value.toDecimalPlaces(6).toString(), now, now],
  }))
  return statements
}

export class CalculationService {
  private readonly projects: ProjectRepository
  private readonly lines: ForecastLineRepository
  private readonly values: ForecastValueRepository
  private readonly parameters: ParameterRepository
  private readonly cashRules: CashRuleRepository
  private readonly adjustments: FactAdjustmentRepository
  private readonly states: PlanCalculationStateRepository
  private readonly projectPlans: ProjectPlanRepository

  constructor(private readonly database: DatabaseClient) {
    this.projects = new ProjectRepository(database)
    this.lines = new ForecastLineRepository(database)
    this.values = new ForecastValueRepository(database)
    this.parameters = new ParameterRepository(database)
    this.cashRules = new CashRuleRepository(database)
    this.adjustments = new FactAdjustmentRepository(database)
    this.states = new PlanCalculationStateRepository(database)
    this.projectPlans = new ProjectPlanRepository(database)
  }

  private async resolvePlanId(projectId: string, planId?: string): Promise<string> {
    if (planId) return planId
    const selected = (await this.projectPlans.list(projectId, false))[0]
    if (!selected) throw Object.assign(new Error('项目没有可用方案'), { code: 'NOT_FOUND' })
    return selected.planId
  }

  async getProjectState(projectId: string, requestedPlanId?: string): Promise<ForecastProjectState> {
    const planId = await this.resolvePlanId(projectId, requestedPlanId)
    const [project, plan, lines, values, parameters, parameterValues, cashRules, calculationState] = await Promise.all([
      this.projects.get(projectId), this.projectPlans.get(projectId, planId), this.lines.list(projectId, planId),
      this.values.listForProject(projectId, planId), this.parameters.list(projectId, planId),
      this.parameters.listValues(projectId, planId), this.cashRules.list(projectId, planId), this.states.get(projectId, planId),
    ])
    if (!project || !plan) throw Object.assign(new Error('项目或方案不存在'), { code: 'NOT_FOUND' })
    const currentHash = buildForecastConfigHash(lines, values, parameters, parameterValues, cashRules,
      { ...project, startPeriod: plan.startPeriod, endPeriod: plan.endPeriod })
    return {
      lines, values, parameters, parameterValues, cashRules, calculationState,
      isResultCurrent: Boolean(calculationState?.lastSuccessConfigHash === currentHash),
      currentConfigHash: currentHash,
    }
  }

  async saveDraft(projectId: string, planIdOrDraft: string | ForecastProjectDraft | ForecastLineDraft[], maybeDraft?: ForecastProjectDraft | ForecastLineDraft[]): Promise<ForecastProjectState> {
    const planId = typeof planIdOrDraft === 'string' ? planIdOrDraft : await this.resolvePlanId(projectId)
    const draft = typeof planIdOrDraft === 'string' ? maybeDraft : planIdOrDraft
    if (!draft) throw new Error('预测配置不能为空')
    const project = await this.projects.get(projectId)
    if (!project) throw new Error('项目不存在')
    if (project.status !== 'calculating') throw new Error('已归档项目不能修改预测配置')
    const plan = await this.projectPlans.get(projectId, planId)
    if (!plan) throw Object.assign(new Error('项目方案不存在'), { code: 'NOT_FOUND' })
    const projectPeriods = generatePeriodRange(plan.startPeriod, plan.endPeriod)
    const cashPeriods = generatePeriods(plan.startPeriod, countPeriods(plan.startPeriod, plan.endPeriod) + 36)
    const lineDrafts = Array.isArray(draft) ? draft : draft.lines
    validateDraftCoordinates(projectPeriods, cashPeriods, lineDrafts)
    const savedLines = await this.lines.saveProjectDraft(projectId, planId, lineDrafts)
    if (!Array.isArray(draft)) {
      await this.parameters.saveProjectDraft(projectId, planId, draft.parameters)
      await this.cashRules.saveProjectDraft(projectId, planId, savedLines, draft.cashRules ?? [])
    }
    const revisionStatement = this.projectPlans.incrementRevisionStatement(projectId, planId)
    await this.database.execute(revisionStatement.sql, revisionStatement.params)
    return this.getProjectState(projectId, planId)
  }

  async saveAndCalculate(projectId: string, draft: ForecastProjectDraft | ForecastLineDraft[], requestedPlanId?: string): Promise<SaveAndCalculateResult> {
    const planId = await this.resolvePlanId(projectId, requestedPlanId)
    await this.saveDraft(projectId, planId, draft)
    return this.calculateSaved(projectId, planId)
  }

  async calculateSaved(projectId: string, requestedPlanId?: string, expectedRevision?: number): Promise<SaveAndCalculateResult> {
    const planId = await this.resolvePlanId(projectId, requestedPlanId)
    const project = await this.projects.get(projectId)
    const plan = await this.projectPlans.get(projectId, planId)
    if (!project || !plan) throw Object.assign(new Error('项目或方案不存在'), { code: 'NOT_FOUND' })
    if (expectedRevision !== undefined) await this.projectPlans.assertRevision(projectId, planId, expectedRevision)
    const [lines, values, parameters, parameterValues, cashRules, adjustments, previousState] = await Promise.all([
      this.lines.list(projectId, planId), this.values.listForProject(projectId, planId), this.parameters.list(projectId, planId),
      this.parameters.listValues(projectId, planId), this.cashRules.list(projectId, planId),
      this.adjustments.list(projectId, planId), this.states.get(projectId, planId),
    ])
    const calculationProject = { ...project, startPeriod: plan.startPeriod, endPeriod: plan.endPeriod }
    const configHash = buildForecastConfigHash(lines, values, parameters, parameterValues, cashRules, calculationProject)
    const compilation = compileForecast(calculationProject, lines, values, parameters, parameterValues, planId)
    const cashCompilation = compileCashSchedule(lines, compilation.values, cashRules)
    const now = new Date().toISOString()
    const allIssues = [...compilation.issues, ...cashCompilation.issues]
    const rawCoordinates = new Set(compilation.values.map((item) => `${item.lineId}:${item.period}`))
    adjustments.forEach((item) => {
      if (!rawCoordinates.has(`${item.forecastLineId}:${item.period}`)) allIssues.push({
        severity: 'error', lineId: item.forecastLineId, period: item.period,
        message: '人工调整对应的预测项或期间已失效，请先在计算底稿中清除该调整',
      })
    })
    const errors = allIssues.filter((issue) => issue.severity === 'error')
    const state: PlanCalculationState = {
      projectId, planId, lastStatus: errors.length ? 'failed' : 'success', lastAttemptAt: now,
      lastSuccessAt: errors.length ? previousState?.lastSuccessAt : now,
      lastSuccessConfigHash: errors.length ? previousState?.lastSuccessConfigHash : configHash,
      calculatedDraftRevision: errors.length ? previousState?.calculatedDraftRevision ?? 0 : plan.draftRevision,
      resultRevision: previousState?.resultRevision ?? 0,
      issues: allIssues,
    }
    if (errors.length) {
      await this.states.save(state)
      return { success: false, state, issues: allIssues }
    }
    state.resultRevision += 1
    const statements: SqlStatement[] = [
      { sql: 'DELETE FROM fact_forecast_line_value WHERE project_id = ? AND plan_id = ?', params: [projectId, planId] },
      { sql: 'DELETE FROM fact_cash_schedule_value WHERE project_id = ? AND plan_id = ?', params: [projectId, planId] },
      ...metricFactStatements(project, planId, compilation.values, cashCompilation.values,
        adjustments.map((item) => ({ ...item, adjustedValue: item.adjustedValue })), now),
    ]
    const lineById = new Map(lines.map((line) => [line.id, line]))
    compilation.values.forEach((compiled) => {
      const line = lineById.get(compiled.lineId)
      if (!line) throw new Error(`预测行项目不存在：${compiled.lineId}`)
      statements.push({
        sql: `INSERT INTO fact_forecast_line_value (
          id, project_id, forecast_line_id, line_code, line_name, line_category,
          department_id, period, scenario_id, plan_id, metric_code, value_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [crypto.randomUUID(), compiled.projectId, compiled.lineId, line.code, line.name, line.category,
          compiled.departmentId, compiled.period, compiled.scenarioId, compiled.planId, compiled.metricCode, compiled.value, now],
      })
    })
    cashCompilation.values.forEach((compiled) => statements.push({
      sql: `INSERT INTO fact_cash_schedule_value (
        id, project_id, source_line_id, source_line_code, source_line_name, department_id,
        source_period, settlement_period, scenario_id, plan_id, metric_code, amount_basis,
        tax_rate_text, net_value_text, tax_value_text, gross_value_text,
        settlement_ratio_text, value_text, rule_method, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [crypto.randomUUID(), compiled.projectId, compiled.sourceLineId, compiled.sourceLineCode,
        compiled.sourceLineName, compiled.departmentId, compiled.sourcePeriod, compiled.settlementPeriod,
        compiled.scenarioId, compiled.planId, compiled.metricCode, compiled.amountBasis, compiled.taxRate,
        compiled.netValue, compiled.taxValue, compiled.grossValue, compiled.settlementRatio,
        compiled.value, compiled.ruleMethod, now],
    }))
    statements.push(calculationStateUpsert(state))
    await this.database.batch(statements)
    return { success: true, state, issues: allIssues }
  }

  async saveAdjustments(projectId: string, planId: string, expectedResultRevision: number, drafts: FactAdjustmentDraft[]) {
    const [project, state] = await Promise.all([this.projects.get(projectId), this.states.get(projectId, planId)])
    if (!project || !state?.lastSuccessAt) throw Object.assign(new Error('当前方案尚无成功计算结果'), { code: 'INVALID_REQUEST' })
    if (state.resultRevision !== expectedResultRevision) throw Object.assign(new Error('计算底稿已在其他页面更新，请刷新后重试'), { code: 'REVISION_CONFLICT', currentRevision: state.resultRevision })
    const [lineValues, cashValues, adjustmentStatements] = await Promise.all([
      this.database.query<{ lineId: string; period: string; metricCode: BaseMetricCode; value: string }>(
        `SELECT forecast_line_id AS lineId, period, metric_code AS metricCode, value_text AS value
         FROM fact_forecast_line_value WHERE project_id = ? AND plan_id = ?`, [projectId, planId]),
      this.database.query<{ settlementPeriod: string; metricCode: 'cash_inflow' | 'cash_outflow'; value: string }>(
        `SELECT settlement_period AS settlementPeriod, metric_code AS metricCode, value_text AS value
         FROM fact_cash_schedule_value WHERE project_id = ? AND plan_id = ?`, [projectId, planId]),
      this.adjustments.saveStatements(projectId, planId, drafts),
    ])
    const nextState = { ...state, resultRevision: state.resultRevision + 1 }
    const now = new Date().toISOString()
    await this.database.batch([
      ...adjustmentStatements,
      ...metricFactStatements(project, planId, lineValues, cashValues, drafts, now),
      calculationStateUpsert(nextState),
    ])
    return { state: nextState, adjustments: await this.adjustments.list(projectId, planId) }
  }
}
