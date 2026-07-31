import type { DatabaseClient } from '../../app/storage/types'
import type { BaseFact, Project, ProjectReport, ReportQuery } from '../../shared/domain/types'
import { DepartmentRepository } from '../repositories/departmentRepository'
import { FactRepository } from '../repositories/factRepository'
import { MetricRepository } from '../repositories/metricRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { calculateMetrics } from '../../shared/calculation/metricEngine'

export class ProjectReportService {
  private readonly projects: ProjectRepository
  private readonly departments: DepartmentRepository
  private readonly metrics: MetricRepository
  private readonly facts: FactRepository

  constructor(database: DatabaseClient) {
    this.projects = new ProjectRepository(database)
    this.departments = new DepartmentRepository(database)
    this.metrics = new MetricRepository(database)
    this.facts = new FactRepository(database)
  }

  async build(query: ReportQuery): Promise<ProjectReport> {
    const project = await this.projects.get(query.projectId)
    if (!project) throw new Error('项目不存在')

    const facts = await this.facts.query(query)
    return this.buildFromFacts(query, facts, project)
  }

  async buildFromFacts(
    query: ReportQuery,
    facts: BaseFact[],
    projectOverride?: Project,
  ): Promise<ProjectReport> {
    const project = projectOverride ?? await this.projects.get(query.projectId)
    if (!project) throw new Error('项目不存在')

    const [department, modules, scenarios, versions, metricDefinitions] =
      await Promise.all([
        this.departments.get(project.departmentId),
        this.projects.listModules(project.id),
        this.projects.listScenarios(),
        this.projects.listVersions(),
        this.metrics.list(),
      ])
    const scenario = scenarios.find((item) => item.id === query.scenarioId)
    const version = versions.find((item) => item.id === query.versionId)
    if (!scenario) throw new Error('场景不存在')
    if (!version) throw new Error('版本不存在')

    const selectedModule = query.businessModuleId
      ? modules.find((module) => module.id === query.businessModuleId)
      : undefined
    const calculation = calculateMetrics(
      project,
      facts,
      metricDefinitions,
      query.businessModuleId,
    )
    return {
      project,
      department,
      query,
      scenario,
      version,
      modules,
      selectedModule,
      hasFacts: facts.length > 0,
      factCount: facts.length,
      monthly: calculation.monthly,
      summary: calculation.summary,
      metricDefinitions,
      calculatedFacts: calculation.calculatedFacts,
      hasCashFacts: facts.some(
        (fact) =>
          fact.metricCode === 'cash_inflow' ||
          fact.metricCode === 'cash_outflow',
      ),
      operationEndPeriod: calculation.operationEndPeriod,
      reportEndPeriod: calculation.reportEndPeriod,
    }
  }
}
