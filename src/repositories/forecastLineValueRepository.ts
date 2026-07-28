import Decimal from 'decimal.js'
import type {
  ForecastLine,
  ForecastCategory,
  ForecastLineBreakdown,
  ProjectParameter,
} from '../domain/types'
import type { DatabaseClient } from '../storage/types'
import { humanizeFormula, parseFormula } from '../services/formulaEngine'

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
    const runRows = await this.database.query<{
      config_snapshot_json: string
    }>(
      `SELECT config_snapshot_json FROM sys_calculation_run WHERE id = ?`,
      [runId],
    )
    let snapshotLines: ForecastLine[] = []
    let snapshotParameters: ProjectParameter[] = []
    try {
      const snapshot = JSON.parse(
        runRows[0]?.config_snapshot_json ?? '{}',
      ) as {
        lines?: ForecastLine[]
        parameters?: ProjectParameter[]
      }
      snapshotLines = snapshot.lines ?? []
      snapshotParameters = snapshot.parameters ?? []
    } catch {
      snapshotLines = []
      snapshotParameters = []
    }
    const lineSnapshotById = new Map(
      snapshotLines.map((line) => [line.id, line]),
    )
    const lineNames = new Map(
      snapshotLines.map((line) => [line.code, line.name]),
    )
    const parameterNames = new Map(
      snapshotParameters.map((parameter) => [parameter.code, parameter.name]),
    )
    const byLine = new Map<string, LineValueRow[]>()
    rows.forEach((row) => {
      const values = byLine.get(row.forecast_line_id) ?? []
      values.push(row)
      byLine.set(row.forecast_line_id, values)
    })
    return Array.from(byLine.entries()).map(([lineId, values]) => {
      const snapshot = values[0]
      const lineSnapshot = lineSnapshotById.get(lineId)
      let sourceSummary: string | undefined
      let dependencies: string[] | undefined
      if (lineSnapshot?.forecastMethod === 'formula') {
        const expression = lineSnapshot.formulaExpression ?? ''
        sourceSummary = humanizeFormula(
          expression,
          parameterNames,
          lineNames,
        )
        try {
          dependencies = parseFormula(expression).references.map((reference) =>
            reference.type === 'parameter'
              ? parameterNames.get(reference.code) ?? reference.code
              : lineNames.get(reference.code) ?? reference.code,
          )
        } catch {
          dependencies = []
        }
      } else if (lineSnapshot?.forecastMethod === 'fixed_monthly') {
        sourceSummary = '固定月金额'
      } else if (lineSnapshot?.forecastMethod === 'monthly_input') {
        sourceSummary = '逐月填写'
      }
      return {
        lineId,
        lineCode: snapshot.line_code,
        lineName: snapshot.line_name,
        category: snapshot.line_category,
        forecastMethod: lineSnapshot?.forecastMethod,
        sourceSummary,
        dependencies,
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
