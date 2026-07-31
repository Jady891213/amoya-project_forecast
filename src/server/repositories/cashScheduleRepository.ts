import type {
  CashScheduleBreakdown,
  CashRuleMethod,
  TaxAmountBasis,
} from '../../shared/domain/types'
import type { DatabaseClient } from '../../app/storage/types'

interface CashScheduleRow {
  source_line_id: string
  source_line_code: string
  source_line_name: string
  source_period: string
  settlement_period: string
  metric_code: 'cash_inflow' | 'cash_outflow'
  amount_basis: TaxAmountBasis
  tax_rate_text: string
  net_value_text: string
  tax_value_text: string
  gross_value_text: string
  settlement_ratio_text: string
  value_text: string
  rule_method: CashRuleMethod
}

export class CashScheduleRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listByRun(
    runId: string,
    businessModuleId?: string,
  ): Promise<CashScheduleBreakdown[]> {
    const params: unknown[] = [runId]
    const moduleFilter = businessModuleId
      ? ' AND business_module_id = ?'
      : ''
    if (businessModuleId) params.push(businessModuleId)
    const rows = await this.database.query<CashScheduleRow>(
      `SELECT source_line_id, source_line_code, source_line_name,
              source_period, settlement_period, metric_code,
              amount_basis, tax_rate_text, net_value_text,
              tax_value_text, gross_value_text, settlement_ratio_text,
              value_text, rule_method
       FROM fact_cash_schedule_value
       WHERE calculation_run_id = ?${moduleFilter}
       ORDER BY settlement_period, source_line_code, source_period`,
      params,
    )
    return rows.map((row) => ({
      sourceLineId: row.source_line_id,
      sourceLineCode: row.source_line_code,
      sourceLineName: row.source_line_name,
      sourcePeriod: row.source_period,
      settlementPeriod: row.settlement_period,
      metricCode: row.metric_code,
      amountBasis: row.amount_basis,
      taxRate: row.tax_rate_text,
      netValue: row.net_value_text,
      taxValue: row.tax_value_text,
      grossValue: row.gross_value_text,
      settlementRatio: row.settlement_ratio_text,
      value: row.value_text,
      ruleMethod: row.rule_method,
    }))
  }
}
