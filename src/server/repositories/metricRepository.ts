import type { DatabaseClient } from '../../app/storage/types'
import type { MetricDefinition } from '../../shared/domain/types'

interface MetricRow {
  code: MetricDefinition['code']
  name: string
  metric_type: MetricDefinition['metricType']
  category: MetricDefinition['category']
  expression: string | null
  unit: string
  value_type: MetricDefinition['valueType']
  period_aggregation: MetricDefinition['periodAggregation']
  description: string
  dependencies_json: string
  sort_order: number
  system_managed: number
}

export class MetricRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(): Promise<MetricDefinition[]> {
    const rows = await this.database.query<MetricRow>(
      'SELECT * FROM dim_metric ORDER BY sort_order',
    )
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      metricType: row.metric_type,
      category: row.category,
      expression: row.expression ?? undefined,
      unit: row.unit,
      valueType: row.value_type,
      periodAggregation: row.period_aggregation,
      description: row.description,
      dependencies: JSON.parse(row.dependencies_json) as MetricDefinition['dependencies'],
      sortOrder: row.sort_order,
      systemManaged: Boolean(row.system_managed),
      origin: 'system',
    }))
  }
}
