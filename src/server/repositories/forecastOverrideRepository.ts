import Decimal from 'decimal.js'
import type {
  ForecastOverride,
  ForecastOverrideDraft,
} from '../../shared/domain/types'
import type { DatabaseClient, SqlStatement } from '../../app/storage/types'

interface OverrideRow {
  id: string
  project_id: string
  version_id: string
  forecast_line_id: string
  period: string
  original_value_text: string
  override_value_text: string
  reason: string
  updated_at: string
}

function fromRow(row: OverrideRow): ForecastOverride {
  return {
    id: row.id,
    projectId: row.project_id,
    versionId: row.version_id,
    forecastLineId: row.forecast_line_id,
    period: row.period,
    originalValue: row.original_value_text,
    overrideValue: row.override_value_text,
    reason: row.reason,
    updatedAt: row.updated_at,
  }
}

export class ForecastOverrideRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(projectId: string, versionId: string): Promise<ForecastOverride[]> {
    const rows = await this.database.query<OverrideRow>(
      `SELECT * FROM cfg_forecast_override
       WHERE project_id = ? AND version_id = ?
       ORDER BY forecast_line_id, period`,
      [projectId, versionId],
    )
    return rows.map(fromRow)
  }

  async saveProjectDraft(
    projectId: string,
    versionId: string,
    drafts: ForecastOverrideDraft[],
  ): Promise<ForecastOverride[]> {
    const lineRows = await this.database.query<{ id: string }>(
      `SELECT id FROM cfg_model_line
       WHERE project_id = ? AND version_id = ? AND line_type IN ('profit', 'cash')`,
      [projectId, versionId],
    )
    const lineIds = new Set(lineRows.map((row) => row.id))
    const existing = await this.list(projectId, versionId)
    const existingByCoordinate = new Map(
      existing.map((item) => [`${item.forecastLineId}:${item.period}`, item]),
    )
    const statements: SqlStatement[] = [
      {
        sql: 'DELETE FROM cfg_forecast_override WHERE project_id = ? AND version_id = ?',
        params: [projectId, versionId],
      },
    ]
    const now = new Date().toISOString()
    drafts.forEach((draft) => {
      if (!lineIds.has(draft.forecastLineId)) {
        throw new Error('期间覆盖引用了不属于当前项目的预测行')
      }
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.period)) {
        throw new Error(`期间覆盖的期间无效：${draft.period}`)
      }
      const original = new Decimal(draft.originalValue)
      const override = new Decimal(draft.overrideValue)
      if (!original.isFinite() || !override.isFinite()) {
        throw new Error('期间覆盖必须是有效数值')
      }
      const previous = existingByCoordinate.get(
        `${draft.forecastLineId}:${draft.period}`,
      )
      statements.push({
        sql: `INSERT INTO cfg_forecast_override (
          id, project_id, version_id, forecast_line_id, period,
          original_value_text, override_value_text, reason, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          previous?.id ?? draft.id ?? crypto.randomUUID(),
          projectId,
          versionId,
          draft.forecastLineId,
          draft.period,
          original.toDecimalPlaces(6).toString(),
          override.toDecimalPlaces(6).toString(),
          draft.reason.trim(),
          now,
        ],
      })
    })
    await this.database.batch(statements)
    return this.list(projectId, versionId)
  }
}
