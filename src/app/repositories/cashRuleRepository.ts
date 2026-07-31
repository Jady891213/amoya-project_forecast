import type {
  CashRule,
  CashRuleDraft,
  ForecastLine,
} from '../domain/types'
import type { DatabaseClient, SqlStatement } from '../storage/types'

interface CashRuleRow {
  id: string
  project_id: string
  source_line_id: string
  source_line_code: string
  method: CashRule['method']
  delay_months: number
  created_at: string
  updated_at: string
}

interface InstallmentRow {
  id: string
  cash_rule_id: string
  sequence: number
  offset_months: number
  ratio_text: string
}

export class CashRuleRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(projectId: string): Promise<CashRule[]> {
    const [rows, installments] = await Promise.all([
      this.database.query<CashRuleRow>(
        `SELECT rule.*, line.code AS source_line_code
         FROM cfg_cash_rule rule
         JOIN cfg_forecast_line line ON line.id = rule.source_line_id
         WHERE rule.project_id = ?
         ORDER BY line.sort_order`,
        [projectId],
      ),
      this.database.query<InstallmentRow>(
        `SELECT item.*
         FROM cfg_cash_rule_installment item
         JOIN cfg_cash_rule rule ON rule.id = item.cash_rule_id
         WHERE rule.project_id = ?
         ORDER BY item.cash_rule_id, item.sequence`,
        [projectId],
      ),
    ])
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      sourceLineId: row.source_line_id,
      sourceLineCode: row.source_line_code,
      method: row.method,
      delayMonths: row.delay_months,
      installments: installments
        .filter((item) => item.cash_rule_id === row.id)
        .map((item) => ({
          id: item.id,
          cashRuleId: item.cash_rule_id,
          sequence: item.sequence,
          offsetMonths: item.offset_months,
          ratio: item.ratio_text,
        })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  async saveProjectDraft(
    projectId: string,
    lines: ForecastLine[],
    drafts: CashRuleDraft[],
  ): Promise<CashRule[]> {
    const existing = await this.list(projectId)
    const existingByLineId = new Map(
      existing.map((rule) => [rule.sourceLineId, rule]),
    )
    const lineByCode = new Map(lines.map((line) => [line.code, line]))
    const now = new Date().toISOString()
    const validDrafts = drafts.map((draft) => {
      const line = lineByCode.get(draft.sourceLineCode)
      if (!line) {
        throw new Error(`收付款规则引用的损益行不存在：${draft.sourceLineCode}`)
      }
      if (line.category !== 'revenue' && line.category !== 'cost') {
        throw new Error('只有收入或成本行可以配置自动收付款规则')
      }
      return { draft, line }
    })
    const retainedLineIds = new Set(validDrafts.map(({ line }) => line.id))
    const statements: SqlStatement[] = []
    existing
      .filter((rule) => !retainedLineIds.has(rule.sourceLineId))
      .forEach((rule) => {
        statements.push({
          sql: 'DELETE FROM cfg_cash_rule WHERE id = ?',
          params: [rule.id],
        })
      })
    validDrafts.forEach(({ draft, line }) => {
      const previous = existingByLineId.get(line.id)
      const id = previous?.id ?? crypto.randomUUID()
      statements.push({
        sql: `INSERT INTO cfg_cash_rule (
          id, project_id, source_line_id, method, delay_months,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          method = excluded.method,
          delay_months = excluded.delay_months,
          updated_at = excluded.updated_at`,
        params: [
          id,
          projectId,
          line.id,
          draft.method,
          draft.method === 'delayed' ? draft.delayMonths : 0,
          previous?.createdAt ?? now,
          now,
        ],
      })
      statements.push({
        sql: 'DELETE FROM cfg_cash_rule_installment WHERE cash_rule_id = ?',
        params: [id],
      })
      if (draft.method === 'installment') {
        draft.installments.forEach((item, index) => {
          statements.push({
            sql: `INSERT INTO cfg_cash_rule_installment (
              id, cash_rule_id, sequence, offset_months, ratio_text
            ) VALUES (?, ?, ?, ?, ?)`,
            params: [
              item.id ?? crypto.randomUUID(),
              id,
              index + 1,
              item.offsetMonths,
              item.ratio.trim(),
            ],
          })
        })
      }
    })
    await this.database.batch(statements)
    return this.list(projectId)
  }
}
