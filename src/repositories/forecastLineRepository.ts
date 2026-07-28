import type {
  ForecastLine,
  ForecastLineDraft,
} from '../domain/types'
import type { DatabaseClient, SqlStatement } from '../storage/types'

interface ForecastLineRow {
  id: string
  project_id: string
  code: string
  name: string
  category: ForecastLine['category']
  metric_code: ForecastLine['metricCode']
  business_module_id: string
  forecast_method: ForecastLine['forecastMethod']
  start_period: string
  end_period: string
  fixed_monthly_value_text: string | null
  formula_expression_text: string | null
  amount_basis: ForecastLine['amountBasis']
  tax_rate_text: string
  assumption: string
  sort_order: number
  created_at: string
  updated_at: string
}

function fromRow(row: ForecastLineRow): ForecastLine {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    category: row.category,
    metricCode: row.metric_code,
    businessModuleId: row.business_module_id,
    forecastMethod: row.forecast_method,
    startPeriod: row.start_period,
    endPeriod: row.end_period,
    fixedMonthlyValue: row.fixed_monthly_value_text ?? undefined,
    formulaExpression: row.formula_expression_text ?? undefined,
    amountBasis: row.amount_basis,
    taxRate: row.tax_rate_text,
    assumption: row.assumption,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function nextLineCode(usedCodes: Set<string>, seed: number): [string, number] {
  let sequence = seed
  let code = ''
  do {
    sequence += 1
    code = `LINE-${String(sequence).padStart(3, '0')}`
  } while (usedCodes.has(code))
  usedCodes.add(code)
  return [code, sequence]
}

export class ForecastLineRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(projectId: string): Promise<ForecastLine[]> {
    const rows = await this.database.query<ForecastLineRow>(
      `SELECT * FROM cfg_forecast_line
       WHERE project_id = ?
       ORDER BY sort_order, code`,
      [projectId],
    )
    return rows.map(fromRow)
  }

  async saveProjectDraft(
    projectId: string,
    drafts: ForecastLineDraft[],
  ): Promise<ForecastLine[]> {
    const existing = await this.list(projectId)
    const existingById = new Map(existing.map((line) => [line.id, line]))
    const existingByCode = new Map(existing.map((line) => [line.code, line]))
    const usedCodes = new Set(existing.map((line) => line.code))
    let sequence = existing.reduce((max, line) => {
      const matched = /^LINE-(\d+)$/.exec(line.code)
      return matched ? Math.max(max, Number(matched[1])) : max
    }, 0)
    const now = new Date().toISOString()
    const resolved = drafts.map((draft, index) => {
      const previous =
        (draft.id ? existingById.get(draft.id) : undefined) ??
        (draft.code
          ? existingByCode.get(draft.code.trim().toUpperCase())
          : undefined)
      let code = previous?.code ?? draft.code?.trim().toUpperCase() ?? ''
      if (!code || (!previous && usedCodes.has(code))) {
        ;[code, sequence] = nextLineCode(usedCodes, sequence)
      } else {
        usedCodes.add(code)
      }
      return {
        draft,
        id: previous?.id ?? crypto.randomUUID(),
        code,
        createdAt: previous?.createdAt ?? now,
        sortOrder: index + 1,
      }
    })

    const statements: SqlStatement[] = []
    const retainedIds = new Set(resolved.map((item) => item.id))
    const removed = existing.filter((line) => !retainedIds.has(line.id))
    for (const line of removed) {
      const escaped = line.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const referencedBy = resolved.find(({ draft }) =>
        new RegExp(`LINE\\(\\s*"${escaped}"\\s*\\)`, 'i').test(
          draft.formulaExpression ?? '',
        ),
      )
      if (referencedBy) {
        throw new Error(
          `行项目“${line.name}”正在被“${referencedBy.draft.name || referencedBy.code}”引用，不能删除`,
        )
      }
    }
    removed
      .forEach((line) =>
        statements.push({
          sql: 'DELETE FROM cfg_forecast_line WHERE id = ? AND project_id = ?',
          params: [line.id, projectId],
        }),
      )

    resolved.forEach(({ draft, id, code, createdAt, sortOrder }) => {
      statements.push({
        sql: `INSERT INTO cfg_forecast_line (
          id, project_id, code, name, category, metric_code,
          business_module_id, forecast_method, start_period, end_period,
          fixed_monthly_value_text, formula_expression_text,
          amount_basis, tax_rate_text, assumption,
          sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          category = excluded.category,
          metric_code = excluded.metric_code,
          business_module_id = excluded.business_module_id,
          forecast_method = excluded.forecast_method,
          start_period = excluded.start_period,
          end_period = excluded.end_period,
          fixed_monthly_value_text = excluded.fixed_monthly_value_text,
          formula_expression_text = excluded.formula_expression_text,
          amount_basis = excluded.amount_basis,
          tax_rate_text = excluded.tax_rate_text,
          assumption = excluded.assumption,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at`,
        params: [
          id,
          projectId,
          code,
          draft.name.trim(),
          draft.category,
          draft.category,
          draft.businessModuleId,
          draft.forecastMethod,
          draft.startPeriod,
          draft.endPeriod,
          draft.forecastMethod === 'fixed_monthly'
            ? draft.fixedMonthlyValue?.trim() || null
            : null,
          draft.forecastMethod === 'formula'
            ? draft.formulaExpression?.trim() || null
            : null,
          draft.category === 'revenue' || draft.category === 'cost'
            ? draft.amountBasis ?? 'tax_exclusive'
            : 'non_taxable',
          draft.category === 'revenue' || draft.category === 'cost'
            ? draft.taxRate?.trim() || '0'
            : '0',
          draft.assumption.trim(),
          sortOrder,
          createdAt,
          now,
        ],
      })
      statements.push({
        sql: 'DELETE FROM cfg_forecast_value WHERE line_id = ?',
        params: [id],
      })
      if (draft.forecastMethod === 'monthly_input') {
        Object.entries(draft.monthlyValues).forEach(([period, rawValue]) => {
          const value = rawValue.trim()
          if (!value) return
          statements.push({
            sql: `INSERT INTO cfg_forecast_value (line_id, period, value_text)
                  VALUES (?, ?, ?)`,
            params: [id, period, value],
          })
        })
      }
    })
    await this.database.batch(statements)
    return this.list(projectId)
  }
}
