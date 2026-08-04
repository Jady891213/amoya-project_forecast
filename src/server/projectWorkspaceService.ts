import Decimal from 'decimal.js'
import type {
  BaseFact,
  CreateProjectVersionRequest,
  DepartmentInput,
  ForecastProjectDraft,
  ProjectInput,
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
import { ProjectVersionRepository } from './repositories/projectVersionRepository'

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
  private readonly projectVersions: ProjectVersionRepository

  constructor(private readonly database: DatabaseClient) {
    this.projects = new ProjectRepository(database)
    this.departments = new DepartmentRepository(database)
    this.calculations = new CalculationService(database)
    this.projectVersions = new ProjectVersionRepository(database)
  }

  async bootstrap() {
    const dimensions = new DimensionRepository(this.database)
    const [departments, projects, periods, scenarios, versions, metrics, facts] =
      await Promise.all([
        this.departments.list(),
        this.projects.list(),
        dimensions.listPeriods(),
        dimensions.listScenarios(),
        dimensions.listVersions(),
        new MetricRepository(this.database).list(),
        new FactRepository(this.database).list(),
      ])
    return {
      departments,
      projects,
      periods,
      scenarios,
      versions,
      metrics,
      facts,
      storage: { ...this.database.runtime },
    }
  }

  async createProject(input: ProjectInput): Promise<ProjectWorkspace> {
    const project = await this.projects.save(input, 0)
    await this.projectVersions.ensureDefault(project.id)
    return this.getWorkspace(project.id, 'working')
  }

  async getWorkspace(projectId: string, versionId?: string): Promise<ProjectWorkspace> {
    const project = await this.projects.get(projectId)
    if (!project) throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' })
    const projectVersions = await this.projectVersions.list(projectId)
    const fallback = projectVersions.find((item) => item.isDefault)
      ?? await this.projectVersions.ensureDefault(projectId)
    const currentVersion = projectVersions.find((item) => item.versionId === versionId)
      ?? fallback
    const versions = projectVersions.length ? projectVersions : [currentVersion]
    const forecast = await this.calculations.getProjectState(projectId, currentVersion.versionId)
    return {
      project,
      projectVersions: versions,
      currentVersion,
      draftRevision: currentVersion.draftRevision,
      forecast,
    }
  }

  async saveWorkspace(
    projectId: string,
    request: SaveProjectWorkspaceRequest,
  ): Promise<ProjectWorkspace> {
    const backup = await this.database.exportDatabase()
    try {
      await this.projectVersions.assertRevision(projectId, request.versionId, request.expectedRevision)
      const project = await this.projects.save(
        { ...request.draft.project, id: projectId },
      )
      await this.calculations.saveDraft(project.id, request.versionId, request.draft.forecast)
      return await this.getWorkspace(project.id, request.versionId)
    } catch (reason) {
      await this.database.importDatabase(backup)
      throw reason
    }
  }

  async calculate(projectId: string, versionId: string, expectedRevision: number) {
    return this.calculations.calculateSaved(projectId, versionId, expectedRevision)
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
        startPeriod: source.project.startPeriod,
        endPeriod: source.project.endPeriod,
      })
      await this.projectVersions.ensureDefault(copiedProject.id)
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
      const copiedState = await this.calculations.saveDraft(copiedProject.id, 'working', draft)
      const sourceLineCodeById = new Map(source.forecast.lines.map((line) => [line.id, line.code]))
      const copiedLineIdByCode = new Map(copiedState.lines.map((line) => [line.code, line.id]))
      await new ForecastOverrideRepository(this.database).saveProjectDraft(
        copiedProject.id,
        'working',
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
      return this.getWorkspace(copiedProject.id, 'working')
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

  async createVersion(projectId: string, request: CreateProjectVersionRequest): Promise<ProjectWorkspace> {
    const backup = await this.database.exportDatabase()
    try {
      const created = await this.projectVersions.enable(projectId, request.versionId)
      if (request.copyFromVersionId) {
        const source = await this.getWorkspace(projectId, request.copyFromVersionId)
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
        const copiedState = await this.calculations.saveDraft(projectId, created.versionId, draft)
        const sourceLineCodeById = new Map(source.forecast.lines.map((line) => [line.id, line.code]))
        const copiedLineIdByCode = new Map(copiedState.lines.map((line) => [line.code, line.id]))
        await new ForecastOverrideRepository(this.database).saveProjectDraft(
          projectId,
          created.versionId,
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
      return this.getWorkspace(projectId, created.versionId)
    } catch (reason) {
      await this.database.importDatabase(backup)
      throw reason
    }
  }

  async setVersionStatus(projectId: string, versionId: string, status: 'active' | 'inactive') {
    return this.projectVersions.setStatus(projectId, versionId, status)
  }

  async saveDepartment(input: DepartmentInput) {
    return this.departments.save(input)
  }

  async setDepartmentStatus(id: string, status: 'active' | 'inactive') {
    return this.departments.setStatus(id, status)
  }

  async buildReport(projectId: string, runId?: string, versionId?: string): Promise<ProjectReportDto> {
    const runRepository = new CalculationRunRepository(this.database)
    const [project, scenarios, versions, projectVersions, availableRuns, state] =
      await Promise.all([
        this.projects.get(projectId),
        new DimensionRepository(this.database).listScenarios(),
        new DimensionRepository(this.database).listVersions(),
        this.projectVersions.list(projectId),
        runRepository.listSuccess(projectId, versionId ?? 'working'),
        this.calculations.getProjectState(projectId, versionId ?? 'working'),
      ])
    if (!project) throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' })
    const selectedRun = runId
      ? availableRuns.find((item) => item.id === runId)
      : availableRuns[0]
    if (runId && !selectedRun) {
      throw Object.assign(new Error('所选成功计算批次不存在'), { code: 'NOT_FOUND' })
    }
    const scenario = scenarios.find((item) => item.isDefault)
    const selectedVersionId = selectedRun?.versionId ?? versionId ?? 'working'
    const versionDimension = versions.find((item) => item.id === selectedVersionId)
    const projectVersion = projectVersions.find((item) => item.versionId === selectedVersionId)
    const version = versionDimension && projectVersion
      ? { ...versionDimension, name: projectVersion.name }
      : versionDimension
    if (!scenario || !version) throw new Error('缺少基准场景或项目版本')
    const reportQuery = {
      projectId,
      scenarioId: selectedRun?.scenarioId ?? scenario.id,
      versionId: selectedRun?.versionId ?? version.id,
    }
    let projectSnapshot = project
    if (selectedRun?.projectSnapshotJson) {
      try { projectSnapshot = { ...project, ...JSON.parse(selectedRun.projectSnapshotJson) } }
      catch { projectSnapshot = project }
    }
    const reportService = new ProjectReportService(this.database)
    const report = selectedRun
      ? await reportService.buildFromFacts(
          reportQuery,
          await this.buildFactsForRun(projectId, selectedRun.id),
          projectSnapshot,
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
    let snapshotParameters = await new ParameterRepository(this.database).list(projectId, version.id)
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
      `项目经营期为 ${report.project.startPeriod} 至 ${report.operationEndPeriod}。`,
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
      version,
      calculationRun: selectedRun,
      availableRuns,
      projectSnapshot,
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
      version_id: string
      metric_code: BaseFact['metricCode']
      value_text: string
    }>(
      `SELECT department_id, period, scenario_id,
              version_id, metric_code, value_text
       FROM fact_forecast_line_value
       WHERE project_id = ? AND calculation_run_id = ?
       UNION ALL
       SELECT department_id, settlement_period AS period,
              scenario_id, version_id, metric_code, value_text
       FROM fact_cash_schedule_value
       WHERE project_id = ? AND calculation_run_id = ?`,
      [projectId, runId, projectId, runId],
    )
    const aggregates = new Map<string, typeof rows[number] & { value: Decimal }>()
    rows.forEach((row) => {
      const key = [row.department_id, row.period, row.scenario_id, row.version_id, row.metric_code].join(':')
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
      versionId: row.version_id,
      metricCode: row.metric_code,
      value: row.value.toDecimalPlaces(6).toString(),
      sourceLabel: '计算批次重建',
      calculationRunId: runId,
      origin: 'user',
    }))
  }
}
