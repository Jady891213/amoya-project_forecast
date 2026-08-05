import type { DatabaseClient } from '../../shared/database'
import type { BaseFact, Project, ProjectPlan, ProjectReport, ReportQuery } from '../../shared/domain/types'
import { DepartmentRepository } from '../repositories/departmentRepository'
import { FactRepository } from '../repositories/factRepository'
import { MetricRepository } from '../repositories/metricRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { calculateMetrics } from '../../shared/calculation/metricEngine'
import { ProjectPlanRepository } from '../repositories/projectPlanRepository'

export class ProjectReportService {
  private readonly projects: ProjectRepository
  private readonly departments: DepartmentRepository
  private readonly metrics: MetricRepository
  private readonly facts: FactRepository
  private readonly plans: ProjectPlanRepository

  constructor(database: DatabaseClient) {
    this.projects = new ProjectRepository(database)
    this.departments = new DepartmentRepository(database)
    this.metrics = new MetricRepository(database)
    this.facts = new FactRepository(database)
    this.plans = new ProjectPlanRepository(database)
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
    planOverride?: ProjectPlan,
  ): Promise<ProjectReport> {
    const project = projectOverride ?? await this.projects.get(query.projectId)
    if (!project) throw new Error('项目不存在')

    const [department, scenarios, plan, metricDefinitions] =
      await Promise.all([
        this.departments.get(project.departmentId),
        this.projects.listScenarios(),
        planOverride ?? this.plans.get(project.id, query.planId),
        this.metrics.list(),
      ])
    const scenario = scenarios.find((item) => item.id === query.scenarioId)
    if (!scenario) throw new Error('场景不存在')
    if (!plan) throw new Error('方案不存在')

    const calculation = calculateMetrics({ ...project, startPeriod: plan.startPeriod, endPeriod: plan.endPeriod }, facts, metricDefinitions)
    return {
      project,
      department,
      query,
      scenario,
      plan,
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
