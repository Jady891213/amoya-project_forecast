import type {
  ForecastMonthlyValue,
} from '../../shared/domain/types'
import type { DatabaseClient } from '../../shared/database'

interface ForecastValueRow {
  line_id: string
  period: string
  value_text: string
}

export class ForecastValueRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listForProject(projectId: string, planId: string): Promise<ForecastMonthlyValue[]> {
    const rows = await this.database.query<ForecastValueRow>(
      `SELECT value.line_id, value.period, value.value_text
       FROM cfg_model_line_value value
       JOIN cfg_model_line line ON line.id = value.line_id
       WHERE line.project_id = ? AND line.plan_id = ? AND line.line_type IN ('profit', 'cash')
       ORDER BY line.sort_order, value.period`,
      [projectId, planId],
    )
    return rows.map((row) => ({
      lineId: row.line_id,
      period: row.period,
      value: row.value_text,
    }))
  }
}
