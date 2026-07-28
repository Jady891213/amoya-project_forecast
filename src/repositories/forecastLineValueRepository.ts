import Decimal from 'decimal.js'
import type {
  ForecastCategory,
  ForecastLineBreakdown,
} from '../domain/types'
import type { DatabaseClient } from '../storage/types'

interface LineValueRow {
  forecast_line_id: string
  line_code: string
  line_name: string
  line_category: ForecastCategory
  period: string
  value_text: string
}

export class ForecastLineValueRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listBreakdown(
    runId: string,
    businessModuleId?: string,
  ): Promise<ForecastLineBreakdown[]> {
    const params: unknown[] = [runId]
    const moduleFilter = businessModuleId
      ? ' AND business_module_id = ?'
      : ''
    if (businessModuleId) params.push(businessModuleId)
    const rows = await this.database.query<LineValueRow>(
      `SELECT forecast_line_id, line_code, line_name, line_category,
              period, value_text
       FROM fact_forecast_line_value
       WHERE calculation_run_id = ?${moduleFilter}
       ORDER BY line_category DESC, line_code, period`,
      params,
    )
    const byLine = new Map<string, LineValueRow[]>()
    rows.forEach((row) => {
      const values = byLine.get(row.forecast_line_id) ?? []
      values.push(row)
      byLine.set(row.forecast_line_id, values)
    })
    return Array.from(byLine.entries()).map(([lineId, values]) => {
      const snapshot = values[0]
      return {
        lineId,
        lineCode: snapshot.line_code,
        lineName: snapshot.line_name,
        category: snapshot.line_category,
        values: values.map((row) => ({
          period: row.period,
          value: row.value_text,
        })),
        total: values
          .reduce((sum, row) => sum.plus(row.value_text), new Decimal(0))
          .toString(),
      }
    })
  }
}
