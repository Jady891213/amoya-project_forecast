import type { DatabaseClient } from '../storage/types'
import type { BaseFact, ReportQuery } from '../domain/types'

interface FactRow {
  id: string
  project_id: string
  department_id: string
  business_module_id: string
  period: string
  scenario_id: string
  version_id: string
  metric_code: BaseFact['metricCode']
  value_text: string
  source_label: string
  calculation_run_id: string | null
  origin: BaseFact['origin']
  dataset_id: string | null
  created_at: string
  updated_at: string
}

function fromRow(row: FactRow): BaseFact {
  return {
    id: row.id,
    projectId: row.project_id,
    departmentId: row.department_id,
    businessModuleId: row.business_module_id,
    period: row.period,
    scenarioId: row.scenario_id,
    versionId: row.version_id,
    metricCode: row.metric_code,
    value: row.value_text,
    sourceLabel: row.source_label,
    calculationRunId: row.calculation_run_id ?? undefined,
    origin: row.origin,
    datasetId: row.dataset_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class FactRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(projectId?: string): Promise<BaseFact[]> {
    const rows = await this.database.query<FactRow>(
      `SELECT * FROM fact_metric_value
       ${projectId ? 'WHERE project_id = ?' : ''}
       ORDER BY project_id, period, metric_code`,
      projectId ? [projectId] : [],
    )
    return rows.map(fromRow)
  }

  async query(query: ReportQuery): Promise<BaseFact[]> {
    const params: unknown[] = [
      query.projectId,
      query.scenarioId,
      query.versionId,
    ]
    let moduleFilter = ''
    if (query.businessModuleId) {
      moduleFilter = ' AND business_module_id = ?'
      params.push(query.businessModuleId)
    }
    const rows = await this.database.query<FactRow>(
      `SELECT * FROM fact_metric_value
       WHERE project_id = ? AND scenario_id = ? AND version_id = ?
       ${moduleFilter}
       ORDER BY period, metric_code`,
      params,
    )
    return rows.map(fromRow)
  }
}
