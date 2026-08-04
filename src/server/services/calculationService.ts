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
import { ProjectVersionRepository } from '../repositories/projectVersionRepository'
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
  private readonly projectVersions: ProjectVersionRepository

  constructor(private readonly database: DatabaseClient) {
    this.projects = new ProjectRepository(database)
    this.lines = new ForecastLineRepository(database)
    this.values = new ForecastValueRepository(database)
    this.runs = new CalculationRunRepository(database)
    this.parameters = new ParameterRepository(database)
    this.cashRules = new CashRuleRepository(database)
    this.overrides = new ForecastOverrideRepository(database)
    this.projectVersions = new ProjectVersionRepository(database)
  }

  async getProjectState(projectId: string, versionId = 'working'): Promise<ForecastProjectState> {
    const [project, lines, values, parameters, parameterValues, cashRules, overrides, latestRun] =
      await Promise.all([
      this.projects.get(projectId),
      this.lines.list(projectId, versionId),
      this.values.listForProject(projectId, versionId),
      this.parameters.list(projectId, versionId),
      this.parameters.listValues(projectId, versionId),
      this.cashRules.list(projectId, versionId),
      this.overrides.list(projectId, versionId),
      this.runs.latestSuccess(projectId, versionId),
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
    versionId: string,
    draft: ForecastProjectDraft | ForecastLineDraft[],
  ): Promise<ForecastProjectState> {
    const project = await this.projects.get(projectId)
    if (!project) throw new Error('项目不存在')
    if (project.status !== 'calculating') {
      throw new Error('已归档项目不能修改预测配置')
    }
    if (!await this.projectVersions.get(projectId, versionId)) {
      if (versionId !== 'working') throw new Error('项目版本不存在')
      await this.projectVersions.ensureDefault(projectId)
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
    const savedLines = await this.lines.saveProjectDraft(projectId, versionId, lineDrafts)
    if (!Array.isArray(draft)) {
      await this.parameters.saveProjectDraft(projectId, versionId, draft.parameters)
      await this.cashRules.saveProjectDraft(
        projectId,
        versionId,
        savedLines,
        draft.cashRules ?? [],
      )
      await this.overrides.saveProjectDraft(projectId, versionId, draft.overrides ?? [])
    }
    const revisionStatement = this.projectVersions.incrementRevisionStatement(projectId, versionId)
    await this.database.execute(revisionStatement.sql, revisionStatement.params)
    return this.getProjectState(projectId, versionId)
  }

  async saveAndCalculate(
    projectId: string,
    draft: ForecastProjectDraft | ForecastLineDraft[],
    versionId = 'working',
  ): Promise<SaveAndCalculateResult> {
    await this.saveDraft(projectId, versionId, draft)
    return this.calculateSaved(projectId, versionId)
  }

  async calculateSaved(
    projectId: string,
    versionId = 'working',
    expectedRevision?: number,
  ): Promise<SaveAndCalculateResult> {
    const project = await this.projects.get(projectId)
    if (!project) throw new Error('项目不存在')
    const projectVersion = await this.projectVersions.get(projectId, versionId)
    if (!projectVersion) throw Object.assign(new Error('项目版本不存在'), { code: 'NOT_FOUND' })
    if (expectedRevision !== undefined) {
      await this.projectVersions.assertRevision(projectId, versionId, expectedRevision)
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
      this.lines.list(projectId, versionId),
      this.values.listForProject(projectId, versionId),
      this.parameters.list(projectId, versionId),
      this.parameters.listValues(projectId, versionId),
      this.cashRules.list(projectId, versionId),
      this.overrides.list(projectId, versionId),
      this.runs.nextRunNumber(projectId, versionId),
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
      versionId,
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
      versionId,
      runNumber,
      status: errors.length > 0 ? 'failed' : 'success',
      configHash,
      issueCount: allIssues.length,
      issues: allIssues,
      configSnapshotJson,
      draftRevision: projectVersion.draftRevision,
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
                AND version_id = ?`,
        params: [projectId, versionId],
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
        ) VALUES (?, ?, ?, ?, 'baseline', ?, ?, ?,
          '预测配置计算', 'user', NULL, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          project.id,
          project.departmentId,
          aggregate.period,
          versionId,
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
