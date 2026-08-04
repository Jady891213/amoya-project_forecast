import type { CashRule, CashRuleDraft, ForecastLine } from '../../shared/domain/types'
import type { DatabaseClient, SqlStatement } from '../../app/storage/types'
import { parseForecastConfig } from './forecastLineRepository'

interface RuleLineRow {
  id: string
  project_id: string
  code: string
  config_json: string
  created_at: string
  updated_at: string
}

export class CashRuleRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(projectId: string, planId: string): Promise<CashRule[]> {
    const rows = await this.database.query<RuleLineRow>(
      `SELECT id, project_id, code, config_json, created_at, updated_at
       FROM cfg_model_line
       WHERE project_id = ? AND plan_id = ? AND line_type = 'profit'
       ORDER BY sort_order`,
      [projectId, planId],
    )
    return rows.flatMap((row) => {
      const rule = parseForecastConfig(row.config_json).cashRule
      if (!rule) return []
      const ruleId = rule.id ?? `cash-rule-${row.id}`
      return [{
        id: ruleId,
        projectId: row.project_id,
        sourceLineId: row.id,
        sourceLineCode: row.code,
        method: rule.method,
        delayMonths: rule.delayMonths,
        monthlyValues: rule.monthlyValues ?? {},
        installments: rule.installments.map((item, index) => ({
          id: item.id ?? `${ruleId}-${index + 1}`,
          cashRuleId: ruleId,
          sequence: item.sequence,
          offsetMonths: item.offsetMonths,
          ratio: item.ratio,
        })),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }]
    })
  }

  async saveProjectDraft(projectId: string, planId: string, lines: ForecastLine[], drafts: CashRuleDraft[]) {
    const lineByCode = new Map(lines.map((line) => [line.code, line]))
    const draftByLineId = new Map<string, CashRuleDraft>()
    for (const draft of drafts) {
      const line = lineByCode.get(draft.sourceLineCode)
      if (!line) throw new Error(`收付款规则引用的损益行不存在：${draft.sourceLineCode}`)
      if (line.category !== 'revenue' && line.category !== 'cost') {
        throw new Error('只有收入或成本行可以配置自动收付款规则')
      }
      draftByLineId.set(line.id, draft)
    }
    const rows = await this.database.query<RuleLineRow>(
      `SELECT id, project_id, code, config_json, created_at, updated_at
       FROM cfg_model_line
       WHERE project_id = ? AND plan_id = ? AND line_type = 'profit'`,
      [projectId, planId],
    )
    const now = new Date().toISOString()
    const statements: SqlStatement[] = rows.map((row) => {
      const config = parseForecastConfig(row.config_json)
      const draft = draftByLineId.get(row.id)
      config.cashRule = draft ? {
        id: draft.id ?? config.cashRule?.id ?? crypto.randomUUID(),
        method: draft.method,
        delayMonths: draft.method === 'delayed' ? draft.delayMonths : 0,
        installments: draft.method === 'installment'
          ? draft.installments.map((item, index) => ({
              id: item.id ?? crypto.randomUUID(),
              sequence: index + 1,
              offsetMonths: item.offsetMonths,
              ratio: item.ratio.trim(),
            }))
          : [],
        monthlyValues: draft.method === 'manual_monthly'
          ? Object.fromEntries(Object.entries(draft.monthlyValues ?? {}).flatMap(([period, value]) => value.trim() ? [[period, value.trim()]] : []))
          : {},
      } : undefined
      return {
        sql: 'UPDATE cfg_model_line SET config_json = ?, updated_at = ? WHERE id = ? AND project_id = ?',
        params: [JSON.stringify(config), now, row.id, projectId],
      }
    })
    await this.database.batch(statements)
    return this.list(projectId, planId)
  }
}
