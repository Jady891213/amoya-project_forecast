import Decimal from 'decimal.js'
import type {
  BaseMetricCode,
  CalculationIssue,
  CalculationRun,
  ForecastProjectDraft,
  ForecastLineDraft,
  ForecastProjectState,
  Project,
} from '../../shared/domain/types'
import type { DatabaseClient, SqlStatement } from '../../app/storage/types'
import {
  CalculationRunRepository,
  calculationRunInsert,
} from '../repositories/calculationRunRepository'
import { ForecastLineRepository } from '../repositories/forecastLineRepository'
import { ForecastValueRepository } from '../repositories/forecastValueRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { ParameterRepository } from '../repositories/parameterRepository'
import { CashRuleRepository } from '../repositories/cashRuleRepository'
import { ForecastOverrideRepository } from '../repositories/forecastOverrideRepository'
import { countPeriods, generatePeriodRange, generatePeriods } from '../../app/domain/periods'
import {
  buildForecastConfigHash,
  compileForecast,
} from '../../shared/calculation/forecastCompiler'
import { compileCashSchedule } from '../../shared/calculation/cashScheduleCompiler'
export { previewForecastDraft } from '../../shared/calculation/previewForecastDraft'

export interface SaveAndCalculateResult {
  success: boolean
  run: CalculationRun
  issues: CalculationIssue[]
}

function validateDraftCoordinates(
  projectPeriods: string[],
  cashPeriods: string[],
  drafts: ForecastLineDraft[],
) {
  if (projectPeriods.length === 0) {
    throw new Error('项目预测周期无效')
  }
  drafts.forEach((draft) => {
    const allowedPeriods =
      draft.category === 'cash_inflow' || draft.category === 'cash_outflow'
        ? cashPeriods
        : projectPeriods
    if (
      !allowedPeriods.includes(draft.startPeriod) ||
      !allowedPeriods.includes(draft.endPeriod)
    ) {
      throw new Error(
        draft.category === 'cash_inflow' || draft.category === 'cash_outflow'
          ? '其他现金事项必须位于经营期开始至结束后36个月内'
          : '收入和成本行必须位于项目经营周期内',
      )
    }
  })
}

export class CalculationService {
  private readonly projects: ProjectRepository
  private readonly lines: ForecastLineRepository
  private readonly values: ForecastValueRepository
  private readonly runs: CalculationRunRepository
  private readonly parameters: ParameterRepository
  private readonly cashRules: CashRuleRepository
  private readonly overrides: ForecastOverrideRepository

  constructor(private readonly database: DatabaseClient) {
    this.projects = new ProjectRepository(database)
    this.lines = new ForecastLineRepository(database)
    this.values = new ForecastValueRepository(database)
    this.runs = new CalculationRunRepository(database)
    this.parameters = new ParameterRepository(database)
    this.cashRules = new CashRuleRepository(database)
    this.overrides = new ForecastOverrideRepository(database)
  }

  async getProjectState(projectId: string): Promise<ForecastProjectState> {
    const [project, lines, values, parameters, parameterValues, cashRules, overrides, latestRun] =
      await Promise.all([
      this.projects.get(projectId),
      this.lines.list(projectId),
      this.values.listForProject(projectId),
      this.parameters.list(projectId),
      this.parameters.listValues(projectId),
      this.cashRules.list(projectId),
      this.overrides.list(projectId),
      this.runs.latestSuccess(projectId),
    ])
    const currentHash = buildForecastConfigHash(
      lines,
      values,
      parameters,
      parameterValues,
      cashRules,
      project,
      overrides,
    )
    return {
      lines,
      values,
      parameters,
      parameterValues,
      cashRules,
      overrides,
      latestRun,
      isResultCurrent: Boolean(latestRun && latestRun.configHash === currentHash),
      currentConfigHash: currentHash,
    }
  }

  async saveDraft(
    projectId: string,
    draft: ForecastProjectDraft | ForecastLineDraft[],
  ): Promise<ForecastProjectState> {
    const project = await this.projects.get(projectId)
    if (!project) throw new Error('项目不存在')
    if (project.status !== 'calculating') {
      throw new Error('已归档项目不能修改预测配置')
    }
    const projectPeriods = generatePeriodRange(project.startPeriod, project.endPeriod)
    const cashPeriods = generatePeriods(
      project.startPeriod,
      countPeriods(project.startPeriod, project.endPeriod) + 36,
    )
    const lineDrafts = Array.isArray(draft) ? draft : draft.lines
    validateDraftCoordinates(
      projectPeriods,
      cashPeriods,
      lineDrafts,
    )
    const savedLines = await this.lines.saveProjectDraft(projectId, lineDrafts)
    if (!Array.isArray(draft)) {
      await this.parameters.saveProjectDraft(projectId, draft.parameters)
      await this.cashRules.saveProjectDraft(
        projectId,
        savedLines,
        draft.cashRules ?? [],
      )
      await this.overrides.saveProjectDraft(projectId, draft.overrides ?? [])
    }
    return this.getProjectState(projectId)
  }

  async saveAndCalculate(
    projectId: string,
    draft: ForecastProjectDraft | ForecastLineDraft[],
  ): Promise<SaveAndCalculateResult> {
    await this.saveDraft(projectId, draft)
    return this.calculateSaved(projectId)
  }

  async calculateSaved(
    projectId: string,
    expectedRevision?: number,
  ): Promise<SaveAndCalculateResult> {
    const project = await this.projects.get(projectId)
    if (!project) throw new Error('项目不存在')
    if (
      expectedRevision !== undefined &&
      project.draftRevision !== expectedRevision
    ) {
      const error = new Error('计算请求的项目修订号已过期') as Error & {
        code?: string
        currentRevision?: number
      }
      error.code = 'REVISION_CONFLICT'
      error.currentRevision = project.draftRevision
      throw error
    }
    const [
      lines,
      values,
      parameters,
      parameterValues,
      cashRules,
      overrides,
      runNumber,
    ] =
      await Promise.all([
      this.lines.list(projectId),
      this.values.listForProject(projectId),
      this.parameters.list(projectId),
      this.parameters.listValues(projectId),
      this.cashRules.list(projectId),
      this.overrides.list(projectId),
      this.runs.nextRunNumber(projectId),
    ])
    const configHash = buildForecastConfigHash(
      lines,
      values,
      parameters,
      parameterValues,
      cashRules,
      project,
      overrides,
    )
    const configSnapshotJson = JSON.stringify({
      projectId,
      parameters,
      parameterValues,
      lines,
      values,
      cashRules,
      overrides,
    })
    const compilation = compileForecast(
      project,
      lines,
      values,
      parameters,
      parameterValues,
      overrides,
    )
    const cashCompilation = compileCashSchedule(
      lines,
      compilation.values,
      cashRules,
    )
    const now = new Date().toISOString()
    const allIssues = [...compilation.issues, ...cashCompilation.issues]
    const errors = allIssues.filter((issue) => issue.severity === 'error')
    const run: CalculationRun = {
      id: crypto.randomUUID(),
      projectId,
      scenarioId: 'baseline',
      versionId: 'working',
      runNumber,
      status: errors.length > 0 ? 'failed' : 'success',
      configHash,
      issueCount: allIssues.length,
      issues: allIssues,
      configSnapshotJson,
      draftRevision: project.draftRevision,
      projectSnapshotJson: JSON.stringify({
        id: project.id,
        code: project.code,
        name: project.name,
        departmentId: project.departmentId,
        startPeriod: project.startPeriod,
        endPeriod: project.endPeriod,
        status: project.status,
      }),
      startedAt: now,
      completedAt: new Date().toISOString(),
    }
    if (errors.length > 0) {
      await this.runs.save(run)
      return { success: false, run, issues: allIssues }
    }

    const statements: SqlStatement[] = [
      calculationRunInsert(run),
      {
        sql: `DELETE FROM fact_metric_value
              WHERE project_id = ? AND scenario_id = 'baseline'
                AND version_id = 'working'`,
        params: [projectId],
      },
    ]
    const lineById = new Map(lines.map((line) => [line.id, line]))
    compilation.values.forEach((compiled) => {
      const line = lineById.get(compiled.lineId)
      if (!line) throw new Error(`预测行项目不存在：${compiled.lineId}`)
      statements.push({
        sql: `INSERT INTO fact_forecast_line_value (
          id, calculation_run_id, project_id, forecast_line_id,
          line_code, line_name, line_category,
          department_id, period, scenario_id,
          version_id, metric_code, value_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          run.id,
          compiled.projectId,
          compiled.lineId,
          line.code,
          line.name,
          line.category,
          compiled.departmentId,
          compiled.period,
          compiled.scenarioId,
          compiled.versionId,
          compiled.metricCode,
          compiled.value,
          now,
        ],
      })
    })
    cashCompilation.values.forEach((compiled) => {
      statements.push({
        sql: `INSERT INTO fact_cash_schedule_value (
          id, calculation_run_id, project_id, source_line_id,
          source_line_code, source_line_name, department_id,
          source_period, settlement_period,
          scenario_id, version_id, metric_code, amount_basis,
          tax_rate_text, net_value_text, tax_value_text, gross_value_text,
          settlement_ratio_text, value_text, rule_method, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          run.id,
          compiled.projectId,
          compiled.sourceLineId,
          compiled.sourceLineCode,
          compiled.sourceLineName,
          compiled.departmentId,
          compiled.sourcePeriod,
          compiled.settlementPeriod,
          compiled.scenarioId,
          compiled.versionId,
          compiled.metricCode,
          compiled.amountBasis,
          compiled.taxRate,
          compiled.netValue,
          compiled.taxValue,
          compiled.grossValue,
          compiled.settlementRatio,
          compiled.value,
          compiled.ruleMethod,
          now,
        ],
      })
    })

    const aggregates = new Map<
      string,
      {
        period: string
        metricCode: BaseMetricCode
        value: Decimal
      }
    >()
    compilation.values.forEach((compiled) => {
      const key = [compiled.period, compiled.metricCode].join(':')
      const aggregate = aggregates.get(key) ?? {
        period: compiled.period,
        metricCode: compiled.metricCode,
        value: new Decimal(0),
      }
      aggregate.value = aggregate.value.plus(compiled.value)
      aggregates.set(key, aggregate)
    })
    cashCompilation.values.forEach((compiled) => {
      const key = [compiled.settlementPeriod, compiled.metricCode].join(':')
      const aggregate = aggregates.get(key) ?? {
        period: compiled.settlementPeriod,
        metricCode: compiled.metricCode,
        value: new Decimal(0),
      }
      aggregate.value = aggregate.value.plus(compiled.value)
      aggregates.set(key, aggregate)
    })
    aggregates.forEach((aggregate) => {
      statements.push({
        sql: `INSERT INTO fact_metric_value (
          id, project_id, department_id, period,
          scenario_id, version_id, metric_code, value_text, source_label,
          origin, dataset_id, created_at, updated_at, calculation_run_id
        ) VALUES (?, ?, ?, ?, 'baseline', 'working', ?, ?,
          '预测配置计算', 'user', NULL, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          project.id,
          project.departmentId,
          aggregate.period,
          aggregate.metricCode,
          aggregate.value.toDecimalPlaces(6).toString(),
          now,
          now,
          run.id,
        ],
      })
    })
    await this.database.batch(statements)
    return { success: true, run, issues: allIssues }
  }
}
