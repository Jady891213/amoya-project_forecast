import type {
  ProjectParameter,
  ProjectParameterDraft,
  ProjectParameterValue,
} from '../../shared/domain/types'
import type { DatabaseClient, SqlStatement } from '../../app/storage/types'
import Decimal from 'decimal.js'

interface ParameterRow {
  id: string
  project_id: string
  code: string
  name: string
  parameter_type: ProjectParameter['parameterType']
  value_type: ProjectParameter['valueType']
  unit: string
  fixed_value_text: string | null
  description: string
  sort_order: number
  created_at: string
  updated_at: string
}

interface ParameterValueRow {
  parameter_id: string
  period: string
  value_text: string
}

function fromRow(row: ParameterRow): ProjectParameter {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    parameterType: row.parameter_type,
    valueType: row.value_type,
    unit: row.unit,
    fixedValue: row.fixed_value_text ?? undefined,
    description: row.description,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function nextParameterCode(
  usedCodes: Set<string>,
  seed: number,
): [string, number] {
  let sequence = seed
  let code = ''
  do {
    sequence += 1
    code = `PAR-${String(sequence).padStart(3, '0')}`
  } while (usedCodes.has(code))
  usedCodes.add(code)
  return [code, sequence]
}

function formulaReferencesParameter(expression: string, code: string): boolean {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`PARAM\\(\\s*"${escaped}"\\s*\\)`, 'i').test(expression)
}

function normalizeDraftValue(
  rawValue: string | undefined,
  valueType: ProjectParameterDraft['valueType'],
): string | null {
  const value = rawValue?.trim()
  if (!value) return null
  if (valueType !== 'percentage') return value
  try {
    return new Decimal(value).div(100).toString()
  } catch {
    return value
  }
}

export class ParameterRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(projectId: string): Promise<ProjectParameter[]> {
    const rows = await this.database.query<ParameterRow>(
      `SELECT * FROM cfg_parameter
       WHERE project_id = ?
       ORDER BY sort_order, code`,
      [projectId],
    )
    return rows.map(fromRow)
  }

  async listValues(projectId: string): Promise<ProjectParameterValue[]> {
    const rows = await this.database.query<ParameterValueRow>(
      `SELECT value.parameter_id, value.period, value.value_text
       FROM cfg_parameter_value value
       JOIN cfg_parameter parameter ON parameter.id = value.parameter_id
       WHERE parameter.project_id = ?
       ORDER BY parameter.sort_order, value.period`,
      [projectId],
    )
    return rows.map((row) => ({
      parameterId: row.parameter_id,
      period: row.period,
      value: row.value_text,
    }))
  }

  async saveProjectDraft(
    projectId: string,
    drafts: ProjectParameterDraft[],
  ): Promise<ProjectParameter[]> {
    const existing = await this.list(projectId)
    const existingById = new Map(
      existing.map((parameter) => [parameter.id, parameter]),
    )
    const existingByCode = new Map(
      existing.map((parameter) => [parameter.code, parameter]),
    )
    const usedCodes = new Set(existing.map((parameter) => parameter.code))
    let sequence = existing.reduce((max, parameter) => {
      const matched = /^PAR-(\d+)$/.exec(parameter.code)
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
        ;[code, sequence] = nextParameterCode(usedCodes, sequence)
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

    const retainedIds = new Set(resolved.map((item) => item.id))
    const removed = existing.filter(
      (parameter) => !retainedIds.has(parameter.id),
    )
    if (removed.length > 0) {
      const formulaRows = await this.database.query<{
        name: string
        formula_expression_text: string | null
      }>(
        `SELECT name, formula_expression_text
         FROM cfg_forecast_line
         WHERE project_id = ? AND forecast_method = 'formula'`,
        [projectId],
      )
      for (const parameter of removed) {
        const referencedBy = formulaRows.find((line) =>
          formulaReferencesParameter(
            line.formula_expression_text ?? '',
            parameter.code,
          ),
        )
        if (referencedBy) {
          throw new Error(
            `参数“${parameter.name}”正在被行项目“${referencedBy.name}”引用，不能删除`,
          )
        }
      }
    }

    const statements: SqlStatement[] = removed.map((parameter) => ({
      sql: 'DELETE FROM cfg_parameter WHERE id = ? AND project_id = ?',
      params: [parameter.id, projectId],
    }))

    resolved.forEach(({ draft, id, code, createdAt, sortOrder }) => {
      statements.push({
        sql: `INSERT INTO cfg_parameter (
          id, project_id, code, name, parameter_type, value_type, unit,
          fixed_value_text, description, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          parameter_type = excluded.parameter_type,
          value_type = excluded.value_type,
          unit = excluded.unit,
          fixed_value_text = excluded.fixed_value_text,
          description = excluded.description,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at`,
        params: [
          id,
          projectId,
          code,
          draft.name.trim(),
          draft.parameterType,
          draft.valueType,
          draft.unit.trim(),
          draft.parameterType === 'fixed'
            ? normalizeDraftValue(draft.fixedValue, draft.valueType)
            : null,
          draft.description.trim(),
          sortOrder,
          createdAt,
          now,
        ],
      })
      statements.push({
        sql: 'DELETE FROM cfg_parameter_value WHERE parameter_id = ?',
        params: [id],
      })
      if (draft.parameterType === 'monthly') {
        Object.entries(draft.monthlyValues).forEach(([period, rawValue]) => {
          const value = normalizeDraftValue(rawValue, draft.valueType)
          if (!value) return
          statements.push({
            sql: `INSERT INTO cfg_parameter_value
                  (parameter_id, period, value_text)
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
