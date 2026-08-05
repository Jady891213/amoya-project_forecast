import Decimal from 'decimal.js'
import type {
  ForecastCategory,
  ForecastLineBreakdown,
} from '../../shared/domain/types'
import type { DatabaseClient } from '../../shared/database'
import { humanizeFormula, parseFormula } from '../../shared/calculation/formulaEngine'
import { ForecastLineRepository } from './forecastLineRepository'
import { ParameterRepository } from './parameterRepository'

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

  async listBreakdown(projectId: string, planId: string): Promise<ForecastLineBreakdown[]> {
    const [rows, lines, parameters] = await Promise.all([
      this.database.query<LineValueRow>(
      `SELECT forecast_line_id, line_code, line_name, line_category,
              period, value_text
       FROM fact_forecast_line_value
       WHERE project_id = ? AND plan_id = ?
       ORDER BY line_category DESC, line_code, period`,
      [projectId, planId],
      ),
      new ForecastLineRepository(this.database).list(projectId, planId),
      new ParameterRepository(this.database).list(projectId, planId),
    ])
    const lineSnapshotById = new Map(
      lines.map((line) => [line.id, line]),
    )
    const lineNames = new Map(
      lines.map((line) => [line.code, line.name]),
    )
    const parameterNames = new Map(
      parameters.map((parameter) => [parameter.code, parameter.name]),
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
      if (
        lineSnapshot &&
        (lineSnapshot.category === 'revenue' ||
          lineSnapshot.category === 'cost')
      ) {
        const taxLabel =
          lineSnapshot.amountBasis === 'tax_inclusive'
            ? `含税录入 ${new Decimal(lineSnapshot.taxRate || 0).times(100).toString()}%`
            : lineSnapshot.amountBasis === 'non_taxable'
              ? '免税/不计税'
              : `未税录入 ${new Decimal(lineSnapshot.taxRate || 0).times(100).toString()}%`
        sourceSummary = sourceSummary
          ? `${sourceSummary} · ${taxLabel}`
          : taxLabel
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
