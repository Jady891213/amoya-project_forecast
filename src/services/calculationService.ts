import Decimal from 'decimal.js'
import type {
  BaseMetricCode,
  CalculationIssue,
  CalculationRun,
  ForecastLine,
  ForecastProjectDraft,
  ForecastLineDraft,
  ForecastProjectState,
  Project,
  ProjectModule,
  ProjectParameter,
} from '../domain/types'
import type { DatabaseClient, SqlStatement } from '../storage/types'
import {
  CalculationRunRepository,
  calculationRunInsert,
} from '../repositories/calculationRunRepository'
import { ForecastLineRepository } from '../repositories/forecastLineRepository'
import { ForecastValueRepository } from '../repositories/forecastValueRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { ParameterRepository } from '../repositories/parameterRepository'
import {
  buildForecastConfigHash,
  compileForecast,
} from './forecastCompiler'

export interface SaveAndCalculateResult {
  success: boolean
  run: CalculationRun
  issues: CalculationIssue[]
}

export function previewForecastDraft(
  project: Project,
  modules: ProjectModule[],
  draft: ForecastProjectDraft,
) {
  const now = new Date(0).toISOString()
  const lines: ForecastLine[] = draft.lines.map((line, index) => ({
    id: line.id ?? line.code ?? `preview-line-${index + 1}`,
    projectId: project.id,
    code: line.code ?? `LINE-${String(index + 1).padStart(3, '0')}`,
    name: line.name,
    category: line.category,
    metricCode: line.category,
    businessModuleId: line.businessModuleId,
    forecastMethod: line.forecastMethod,
    startPeriod: line.startPeriod,
    endPeriod: line.endPeriod,
    fixedMonthlyValue: line.fixedMonthlyValue,
    formulaExpression: line.formulaExpression,
    assumption: line.assumption,
    sortOrder: line.sortOrder,
    createdAt: now,
    updatedAt: now,
  }))
  const parameters: ProjectParameter[] = draft.parameters.map(
    (parameter, index) => ({
      id: parameter.id ?? parameter.code ?? `preview-parameter-${index + 1}`,
      projectId: project.id,
      code: parameter.code ?? `PAR-${String(index + 1).padStart(3, '0')}`,
      name: parameter.name,
      parameterType: parameter.parameterType,
      valueType: parameter.valueType,
      unit: parameter.unit,
      fixedValue:
        parameter.parameterType === 'fixed' && parameter.fixedValue?.trim()
          ? parameter.valueType === 'percentage'
            ? new Decimal(parameter.fixedValue).div(100).toString()
            : parameter.fixedValue
          : undefined,
      description: parameter.description,
      sortOrder: parameter.sortOrder,
      createdAt: now,
      updatedAt: now,
    }),
  )
  const values = draft.lines.flatMap((line, index) =>
    Object.entries(line.monthlyValues)
      .filter(([, value]) => value.trim())
      .map(([period, value]) => ({
        lineId: line.id ?? line.code ?? `preview-line-${index + 1}`,
        period,
        value,
      })),
  )
  const parameterValues = draft.parameters.flatMap((parameter, index) =>
    Object.entries(parameter.monthlyValues)
      .filter(([, value]) => value.trim())
      .map(([period, value]) => ({
        parameterId:
          parameter.id ??
          parameter.code ??
          `preview-parameter-${index + 1}`,
        period,
        value:
          parameter.valueType === 'percentage'
            ? new Decimal(value).div(100).toString()
            : value,
      })),
  )
  return compileForecast(
    project,
    modules,
    lines,
    values,
    parameters,
    parameterValues,
  )
}

function validateDraftCoordinates(
  projectStartPeriod: string,
  projectPeriods: string[],
  moduleIds: Set<string>,
  drafts: ForecastLineDraft[],
) {
  if (!projectStartPeriod || projectPeriods.length === 0) {
    throw new Error('项目预测周期无效')
  }
  drafts.forEach((draft) => {
    if (!moduleIds.has(draft.businessModuleId)) {
      throw new Error('行项目引用了不属于当前项目的业务模块')
    }
    if (
      !projectPeriods.includes(draft.startPeriod) ||
      !projectPeriods.includes(draft.endPeriod)
    ) {
      throw new Error('行项目生效期间必须位于项目预测周期内')
    }
  })
}

export class CalculationService {
  private readonly projects: ProjectRepository
  private readonly lines: ForecastLineRepository
  private readonly values: ForecastValueRepository
  private readonly runs: CalculationRunRepository
  private readonly parameters: ParameterRepository

  constructor(private readonly database: DatabaseClient) {
    this.projects = new ProjectRepository(database)
    this.lines = new ForecastLineRepository(database)
    this.values = new ForecastValueRepository(database)
    this.runs = new CalculationRunRepository(database)
    this.parameters = new ParameterRepository(database)
  }

  async getProjectState(projectId: string): Promise<ForecastProjectState> {
    const [lines, values, parameters, parameterValues, latestRun] =
      await Promise.all([
      this.lines.list(projectId),
      this.values.listForProject(projectId),
      this.parameters.list(projectId),
      this.parameters.listValues(projectId),
      this.runs.latestSuccess(projectId),
    ])
    const currentHash = buildForecastConfigHash(
      lines,
      values,
      parameters,
      parameterValues,
    )
    return {
      lines,
      values,
      parameters,
      parameterValues,
      latestRun,
      isResultCurrent: Boolean(latestRun && latestRun.configHash === currentHash),
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
    const modules = await this.projects.listModules(projectId)
    const projectPeriods = await this.database.query<{ period: string }>(
      `SELECT period FROM dim_period
       WHERE sort_key BETWEEN
         (SELECT sort_key FROM dim_period WHERE period = ?)
         AND
         (SELECT sort_key FROM dim_period WHERE period = ?)
       ORDER BY sort_key`,
      [
        project.startPeriod,
        (() => {
          const [year, month] = project.startPeriod.split('-').map(Number)
          const date = new Date(year, month - 1 + project.durationMonths - 1, 1)
          return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        })(),
      ],
    )
    const lineDrafts = Array.isArray(draft) ? draft : draft.lines
    validateDraftCoordinates(
      project.startPeriod,
      projectPeriods.map((item) => item.period),
      new Set(modules.map((module) => module.id)),
      lineDrafts,
    )
    await this.lines.saveProjectDraft(projectId, lineDrafts)
    if (!Array.isArray(draft)) {
      await this.parameters.saveProjectDraft(projectId, draft.parameters)
    }
    return this.getProjectState(projectId)
  }

  async saveAndCalculate(
    projectId: string,
    draft: ForecastProjectDraft | ForecastLineDraft[],
  ): Promise<SaveAndCalculateResult> {
    await this.saveDraft(projectId, draft)
    const project = await this.projects.get(projectId)
    if (!project) throw new Error('项目不存在')
    const [modules, lines, values, parameters, parameterValues, runNumber] =
      await Promise.all([
      this.projects.listModules(projectId),
      this.lines.list(projectId),
      this.values.listForProject(projectId),
      this.parameters.list(projectId),
      this.parameters.listValues(projectId),
      this.runs.nextRunNumber(projectId),
    ])
    const configHash = buildForecastConfigHash(
      lines,
      values,
      parameters,
      parameterValues,
    )
    const configSnapshotJson = JSON.stringify({
      projectId,
      parameters,
      parameterValues,
      lines,
      values,
    })
    const compilation = compileForecast(
      project,
      modules,
      lines,
      values,
      parameters,
      parameterValues,
    )
    const now = new Date().toISOString()
    const errors = compilation.issues.filter((issue) => issue.severity === 'error')
    const run: CalculationRun = {
      id: crypto.randomUUID(),
      projectId,
      scenarioId: 'baseline',
      versionId: 'working',
      runNumber,
      status: errors.length > 0 ? 'failed' : 'success',
      configHash,
      issueCount: compilation.issues.length,
      issues: compilation.issues,
      configSnapshotJson,
      startedAt: now,
      completedAt: new Date().toISOString(),
    }
    if (errors.length > 0) {
      await this.runs.save(run)
      return { success: false, run, issues: compilation.issues }
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
          department_id, business_module_id, period, scenario_id,
          version_id, metric_code, value_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          run.id,
          compiled.projectId,
          compiled.lineId,
          line.code,
          line.name,
          line.category,
          compiled.departmentId,
          compiled.businessModuleId,
          compiled.period,
          compiled.scenarioId,
          compiled.versionId,
          compiled.metricCode,
          compiled.value,
          now,
        ],
      })
    })

    const aggregates = new Map<
      string,
      {
        moduleId: string
        period: string
        metricCode: BaseMetricCode
        value: Decimal
      }
    >()
    compilation.values.forEach((compiled) => {
      const key = [
        compiled.businessModuleId,
        compiled.period,
        compiled.metricCode,
      ].join(':')
      const aggregate = aggregates.get(key) ?? {
        moduleId: compiled.businessModuleId,
        period: compiled.period,
        metricCode: compiled.metricCode,
        value: new Decimal(0),
      }
      aggregate.value = aggregate.value.plus(compiled.value)
      aggregates.set(key, aggregate)
    })
    aggregates.forEach((aggregate) => {
      statements.push({
        sql: `INSERT INTO fact_metric_value (
          id, project_id, department_id, business_module_id, period,
          scenario_id, version_id, metric_code, value_text, source_label,
          origin, dataset_id, created_at, updated_at, calculation_run_id
        ) VALUES (?, ?, ?, ?, ?, 'baseline', 'working', ?, ?,
          '预测配置计算', 'user', NULL, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          project.id,
          project.departmentId,
          aggregate.moduleId,
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
    return { success: true, run, issues: compilation.issues }
  }
}
