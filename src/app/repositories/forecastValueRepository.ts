import type {
  ForecastMonthlyValue,
} from '../domain/types'
import type { DatabaseClient } from '../storage/types'

interface ForecastValueRow {
  line_id: string
  period: string
  value_text: string
}

export class ForecastValueRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listForProject(projectId: string): Promise<ForecastMonthlyValue[]> {
    const rows = await this.database.query<ForecastValueRow>(
      `SELECT value.line_id, value.period, value.value_text
       FROM cfg_forecast_value value
       JOIN cfg_forecast_line line ON line.id = value.line_id
       WHERE line.project_id = ?
       ORDER BY line.sort_order, value.period`,
      [projectId],
    )
    return rows.map((row) => ({
      lineId: row.line_id,
      period: row.period,
      value: row.value_text,
    }))
  }
}
