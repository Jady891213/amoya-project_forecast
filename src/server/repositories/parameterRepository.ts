import Decimal from 'decimal.js'
import type {
  ProjectParameter,
  ProjectParameterDraft,
  ProjectParameterValue,
} from '../../shared/domain/types'
import type { DatabaseClient, SqlStatement } from '../../app/storage/types'

interface ModelLineRow {
  id: string
  project_id: string
  code: string
  name: string
  calculation_method: 'fixed' | 'monthly_input'
  unit: string
  config_json: string
  sort_order: number
  created_at: string
  updated_at: string
}

interface ParameterConfig {
  valueType?: ProjectParameter['valueType']
  fixedValueText?: string
  description?: string
}

function parseConfig(value: string): ParameterConfig {
  try { return JSON.parse(value) as ParameterConfig }
  catch { return {} }
}

function fromRow(row: ModelLineRow): ProjectParameter {
  const config = parseConfig(row.config_json)
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    parameterType: row.calculation_method === 'fixed' ? 'fixed' : 'monthly',
    valueType: config.valueType ?? 'number',
    unit: row.unit,
    fixedValue: config.fixedValueText,
    description: config.description ?? '',
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function nextCode(used: Set<string>, seed: number): [string, number] {
  let sequence = seed
  let code = ''
  do { code = `PAR-${String(++sequence).padStart(3, '0')}` }
  while (used.has(code))
  used.add(code)
  return [code, sequence]
}

function normalizeValue(raw: string | undefined, valueType: ProjectParameterDraft['valueType']) {
  const value = raw?.trim()
  if (!value) return null
  if (valueType !== 'percentage') return value
  try { return new Decimal(value).div(100).toString() }
  catch { return value }
}

export class ParameterRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(projectId: string): Promise<ProjectParameter[]> {
    const rows = await this.database.query<ModelLineRow>(
      `SELECT id, project_id, code, name, calculation_method, unit,
              config_json, sort_order, created_at, updated_at
       FROM cfg_model_line
       WHERE project_id = ? AND line_type = 'parameter'
       ORDER BY sort_order, code`,
      [projectId],
    )
    return rows.map(fromRow)
  }

  async listValues(projectId: string): Promise<ProjectParameterValue[]> {
    const rows = await this.database.query<{
      line_id: string; period: string; value_text: string
    }>(
      `SELECT value.line_id, value.period, value.value_text
       FROM cfg_model_line_value value
       JOIN cfg_model_line line ON line.id = value.line_id
       WHERE line.project_id = ? AND line.line_type = 'parameter'
       ORDER BY line.sort_order, value.period`,
      [projectId],
    )
    return rows.map((row) => ({
      parameterId: row.line_id,
      period: row.period,
      value: row.value_text,
    }))
  }

  async saveProjectDraft(projectId: string, drafts: ProjectParameterDraft[]) {
    const [existing, project] = await Promise.all([
      this.list(projectId),
      this.database.query<{ start_period: string; end_period: string }>(
        'SELECT start_period, end_period FROM dim_project WHERE id = ?',
        [projectId],
      ),
    ])
    if (!project[0]) throw new Error('项目不存在')
    const existingById = new Map(existing.map((item) => [item.id, item]))
    const existingByCode = new Map(existing.map((item) => [item.code, item]))
    const used = new Set(existing.map((item) => item.code))
    let sequence = existing.reduce((max, item) => {
      const match = /^PAR-(\d+)$/.exec(item.code)
      return match ? Math.max(max, Number(match[1])) : max
    }, 0)
    const now = new Date().toISOString()
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
    if (removed.length) {
      const rows = await this.database.query<{ name: string; config_json: string }>(
        `SELECT name, config_json FROM cfg_model_line
         WHERE project_id = ? AND line_type IN ('profit', 'cash')
           AND calculation_method = 'formula'`,
        [projectId],
      )
      for (const parameter of removed) {
        const escaped = parameter.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const referenced = rows.find((row) => {
          const formula = (parseConfig(row.config_json) as { formulaExpressionText?: string }).formulaExpressionText ?? ''
          return new RegExp(`PARAM\\(\\s*"${escaped}"\\s*\\)`, 'i').test(formula)
        })
        if (referenced) throw new Error(`参数“${parameter.name}”正在被行项目“${referenced.name}”引用，不能删除`)
      }
    }

    const statements: SqlStatement[] = removed.map((item) => ({
      sql: 'DELETE FROM cfg_model_line WHERE id = ? AND project_id = ?',
      params: [item.id, projectId],
    }))
    for (const item of resolved) {
      const { draft, previous, id, code, sortOrder } = item
      const config: ParameterConfig = {
        valueType: draft.valueType,
        fixedValueText: draft.parameterType === 'fixed'
          ? normalizeValue(draft.fixedValue, draft.valueType) ?? undefined
          : undefined,
        description: draft.description.trim(),
      }
      statements.push({
        sql: `INSERT INTO cfg_model_line (
          id, project_id, code, name, line_type, category,
          business_module_id, calculation_method, start_period, end_period,
          unit, config_json, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'parameter', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, calculation_method = excluded.calculation_method,
          start_period = excluded.start_period, end_period = excluded.end_period,
          unit = excluded.unit, config_json = excluded.config_json,
          sort_order = excluded.sort_order, updated_at = excluded.updated_at`,
        params: [
          id, projectId, code, draft.name.trim(),
          draft.parameterType === 'fixed' ? 'fixed' : 'monthly_input',
          project[0].start_period, project[0].end_period, draft.unit.trim(),
          JSON.stringify(config), sortOrder, previous?.createdAt ?? now, now,
        ],
      })
      statements.push({ sql: 'DELETE FROM cfg_model_line_value WHERE line_id = ?', params: [id] })
      if (draft.parameterType === 'monthly') {
        for (const [period, raw] of Object.entries(draft.monthlyValues)) {
          const value = normalizeValue(raw, draft.valueType)
          if (!value) continue
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
