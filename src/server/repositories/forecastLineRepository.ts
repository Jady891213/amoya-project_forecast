import type { ForecastLine, ForecastLineDraft } from '../../shared/domain/types'
import type { DatabaseClient, SqlStatement } from '../../app/storage/types'

export interface ForecastConfig {
  fixedMonthlyValueText?: string
  formulaExpressionText?: string
  calculationPreset?: ForecastLine['calculationPreset']
  calculationConfig?: ForecastLine['calculationConfig']
  amountBasis?: ForecastLine['amountBasis']
  taxRateText?: string
  assumption?: string
  cashRule?: {
    id?: string
    method: 'disabled' | 'immediate' | 'delayed' | 'installment'
    delayMonths: number
    installments: Array<{ id?: string; sequence: number; offsetMonths: number; ratio: string }>
  }
}

interface ModelLineRow {
  id: string; project_id: string; code: string; name: string
  category: ForecastLine['category']
  calculation_method: ForecastLine['forecastMethod']; start_period: string
  end_period: string; config_json: string; sort_order: number
  created_at: string; updated_at: string
}

export function parseForecastConfig(value: string): ForecastConfig {
  try { return JSON.parse(value) as ForecastConfig }
  catch { return {} }
}

function fromRow(row: ModelLineRow): ForecastLine {
  const config = parseForecastConfig(row.config_json)
  return {
    id: row.id, projectId: row.project_id, code: row.code, name: row.name,
    category: row.category, metricCode: row.category,
    forecastMethod: row.calculation_method,
    startPeriod: row.start_period, endPeriod: row.end_period,
    fixedMonthlyValue: config.fixedMonthlyValueText,
    formulaExpression: config.formulaExpressionText,
    calculationPreset: config.calculationPreset,
    calculationConfig: config.calculationConfig,
    amountBasis: config.amountBasis ?? (row.category === 'revenue' || row.category === 'cost' ? 'tax_exclusive' : 'non_taxable'),
    taxRate: config.taxRateText ?? '0',
    assumption: config.assumption ?? '', sortOrder: row.sort_order,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function nextCode(used: Set<string>, seed: number): [string, number] {
  let sequence = seed; let code = ''
  do { code = `LINE-${String(++sequence).padStart(3, '0')}` } while (used.has(code))
  used.add(code); return [code, sequence]
}

export class ForecastLineRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(projectId: string): Promise<ForecastLine[]> {
    const rows = await this.database.query<ModelLineRow>(
      `SELECT id, project_id, code, name, category,
              calculation_method, start_period, end_period, config_json,
              sort_order, created_at, updated_at
       FROM cfg_model_line
       WHERE project_id = ? AND line_type IN ('profit', 'cash')
       ORDER BY line_type, sort_order, code`,
      [projectId],
    )
    return rows.map(fromRow)
  }

  async saveProjectDraft(projectId: string, drafts: ForecastLineDraft[]) {
    const existing = await this.list(projectId)
    const existingById = new Map(existing.map((item) => [item.id, item]))
    const existingByCode = new Map(existing.map((item) => [item.code, item]))
    const used = new Set(existing.map((item) => item.code))
    let sequence = existing.reduce((max, item) => {
      const match = /^LINE-(\d+)$/.exec(item.code)
      return match ? Math.max(max, Number(match[1])) : max
    }, 0)
    const now = new Date().toISOString()
    const configRows = await this.database.query<{ id: string; config_json: string }>(
      `SELECT id, config_json FROM cfg_model_line
       WHERE project_id = ? AND line_type IN ('profit', 'cash')`,
      [projectId],
    )
    const existingConfig = new Map(configRows.map((item) => [item.id, parseForecastConfig(item.config_json)]))
    const resolved = drafts.map((draft, index) => {
      const previous = (draft.id ? existingById.get(draft.id) : undefined)
        ?? (draft.code ? existingByCode.get(draft.code.trim().toUpperCase()) : undefined)
      let code = previous?.code ?? draft.code?.trim().toUpperCase() ?? ''
      if (!code || (!previous && used.has(code))) [code, sequence] = nextCode(used, sequence)
      else used.add(code)
      return { draft, previous, id: previous?.id ?? crypto.randomUUID(), code, sortOrder: index + 1 }
    })
    const retained = new Set(resolved.map((item) => item.id))
    const removed = existing.filter((item) => !retained.has(item.id))
    for (const line of removed) {
      const escaped = line.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const referenced = resolved.find(({ draft }) =>
        new RegExp(`LINE\\(\\s*"${escaped}"\\s*\\)`, 'i').test(draft.formulaExpression ?? ''),
      )
      if (referenced) throw new Error(`行项目“${line.name}”正在被“${referenced.draft.name || referenced.code}”引用，不能删除`)
    }
    const statements: SqlStatement[] = removed.map((item) => ({
      sql: 'DELETE FROM cfg_model_line WHERE id = ? AND project_id = ?', params: [item.id, projectId],
    }))
    for (const item of resolved) {
      const { draft, previous, id, code, sortOrder } = item
      const oldConfig = existingConfig.get(id)
      const config: ForecastConfig = {
        fixedMonthlyValueText: draft.forecastMethod === 'fixed_monthly' ? draft.fixedMonthlyValue?.trim() || undefined : undefined,
        formulaExpressionText: draft.forecastMethod === 'formula' ? draft.formulaExpression?.trim() || undefined : undefined,
        calculationPreset: draft.forecastMethod === 'formula' ? draft.calculationPreset : undefined,
        calculationConfig: draft.forecastMethod === 'formula' ? draft.calculationConfig : undefined,
        amountBasis: draft.category === 'revenue' || draft.category === 'cost' ? draft.amountBasis ?? 'tax_exclusive' : 'non_taxable',
        taxRateText: draft.category === 'revenue' || draft.category === 'cost' ? draft.taxRate?.trim() || '0' : '0',
        assumption: draft.assumption.trim(),
        cashRule: oldConfig?.cashRule,
      }
      statements.push({
        sql: `INSERT INTO cfg_model_line (
          id, project_id, code, name, line_type, category,
          calculation_method, start_period, end_period,
          unit, config_json, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '元', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, line_type = excluded.line_type,
          category = excluded.category,
          calculation_method = excluded.calculation_method,
          start_period = excluded.start_period, end_period = excluded.end_period,
          config_json = excluded.config_json, sort_order = excluded.sort_order,
          updated_at = excluded.updated_at`,
        params: [id, projectId, code, draft.name.trim(),
          draft.category === 'revenue' || draft.category === 'cost' ? 'profit' : 'cash',
          draft.category, draft.forecastMethod,
          draft.startPeriod, draft.endPeriod, JSON.stringify(config), sortOrder,
          previous?.createdAt ?? now, now],
      })
      statements.push({ sql: 'DELETE FROM cfg_model_line_value WHERE line_id = ?', params: [id] })
      if (draft.forecastMethod === 'monthly_input') {
        for (const [period, raw] of Object.entries(draft.monthlyValues)) {
          const value = raw.trim(); if (!value) continue
          statements.push({
            sql: 'INSERT INTO cfg_model_line_value (line_id, period, value_text) VALUES (?, ?, ?)',
            params: [id, period, value],
          })
        }
      }
    }
    await this.database.batch(statements)
    return this.list(projectId)
  }
}
