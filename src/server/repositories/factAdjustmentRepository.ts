import Decimal from 'decimal.js'
import type { BaseMetricCode, FactAdjustment, FactAdjustmentDraft } from '../../shared/domain/types'
import type { DatabaseClient, SqlStatement } from '../../app/storage/types'

interface AdjustmentRow {
  id: string
  project_id: string
  plan_id: string
  forecast_line_id: string
  period: string
  metric_code: BaseMetricCode
  adjusted_value_text: string
  reason: string
  created_at: string
  updated_at: string
}

function fromRow(row: AdjustmentRow): FactAdjustment {
  return {
    id: row.id,
    projectId: row.project_id,
    planId: row.plan_id,
    forecastLineId: row.forecast_line_id,
    period: row.period,
    metricCode: row.metric_code,
    adjustedValue: row.adjusted_value_text,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class FactAdjustmentRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(projectId: string, planId: string): Promise<FactAdjustment[]> {
    const rows = await this.database.query<AdjustmentRow>(
      `SELECT * FROM fact_metric_adjustment
       WHERE project_id = ? AND plan_id = ?
       ORDER BY forecast_line_id, period`,
      [projectId, planId],
    )
    return rows.map(fromRow)
  }

  async listOutsidePeriod(projectId: string, planId: string, startPeriod: string, endPeriod: string, cashEndPeriod: string): Promise<FactAdjustment[]> {
    const rows = await this.database.query<AdjustmentRow>(
      `SELECT adjustment.* FROM fact_metric_adjustment adjustment
       JOIN cfg_model_line line ON line.id = adjustment.forecast_line_id
       WHERE adjustment.project_id = ? AND adjustment.plan_id = ?
         AND (adjustment.period < ? OR adjustment.period > CASE
           WHEN line.line_type IN ('cash_inflow', 'cash_outflow') THEN ? ELSE ? END)
       ORDER BY adjustment.period, adjustment.forecast_line_id`,
      [projectId, planId, startPeriod, cashEndPeriod, endPeriod],
    )
    return rows.map(fromRow)
  }

  deleteStatements(ids: string[]): SqlStatement[] {
    return ids.map((id) => ({ sql: 'DELETE FROM fact_metric_adjustment WHERE id = ?', params: [id] }))
  }

  async saveStatements(projectId: string, planId: string, drafts: FactAdjustmentDraft[]): Promise<SqlStatement[]> {
    const facts = await this.database.query<{ forecast_line_id: string; period: string; metric_code: BaseMetricCode }>(
      `SELECT forecast_line_id, period, metric_code FROM fact_forecast_line_value
       WHERE project_id = ? AND plan_id = ?`,
      [projectId, planId],
    )
    const factByCoordinate = new Map(facts.map((item) => [`${item.forecast_line_id}:${item.period}`, item]))
    const existing = await this.list(projectId, planId)
    const existingByCoordinate = new Map(existing.map((item) => [`${item.forecastLineId}:${item.period}`, item]))
    const statements: SqlStatement[] = [{
      sql: 'DELETE FROM fact_metric_adjustment WHERE project_id = ? AND plan_id = ?',
      params: [projectId, planId],
    }]
    const now = new Date().toISOString()
    drafts.forEach((draft) => {
      const coordinate = `${draft.forecastLineId}:${draft.period}`
      const fact = factByCoordinate.get(coordinate)
      if (!fact || fact.metric_code !== draft.metricCode) throw Object.assign(new Error('人工调整目标已变化，请刷新计算底稿后重试'), { code: 'REVISION_CONFLICT' })
      const adjusted = new Decimal(draft.adjustedValue)
      if (!adjusted.isFinite()) throw Object.assign(new Error('人工调整必须是有效数值'), { code: 'INVALID_REQUEST' })
      const previous = existingByCoordinate.get(coordinate)
      statements.push({
        sql: `INSERT INTO fact_metric_adjustment (
          id, project_id, plan_id, forecast_line_id, period, metric_code,
          adjusted_value_text, reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          previous?.id ?? draft.id ?? crypto.randomUUID(), projectId, planId,
          draft.forecastLineId, draft.period, draft.metricCode,
          adjusted.toDecimalPlaces(6).toString(), draft.reason.trim(),
          previous?.createdAt ?? now, now,
        ],
      })
    })
    return statements
  }
}
