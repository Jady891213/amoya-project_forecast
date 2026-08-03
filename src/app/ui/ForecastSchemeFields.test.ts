import { describe, expect, it } from 'vitest'
import type { ForecastLineDraft } from '../../shared/domain/types'
import { patchForForecastScheme } from './ForecastSchemeFields'

function line(category: ForecastLineDraft['category']): ForecastLineDraft {
  return {
    id: 'draft-line',
    code: 'LINE-002',
    name: '测试预测项',
    category,
    forecastMethod: 'fixed_monthly',
    startPeriod: '2026-01',
    endPeriod: '2026-12',
    assumption: '',
    sortOrder: 1,
    monthlyValues: {},
  }
}

describe('财务常用测算方案', () => {
  it('单价乘数量直接保存行内数值并生成确定性公式', () => {
    const source = line('revenue')
    const initial = patchForForecastScheme(source, 'price_quantity', [], [])
    const configured: ForecastLineDraft = {
      ...source,
      ...initial,
      calculationConfig: { priceValue: '24', quantityValue: '2642' },
    }
    const result = patchForForecastScheme(configured, 'price_quantity', [], [])
    expect(result.calculationConfig).toEqual({ priceValue: '24', quantityValue: '2642' })
    expect(result.formulaExpression).toBe('24 * 2642')
  })

  it('按收入比例直接保存比例并引用收入行', () => {
    const revenue = { ...line('revenue'), id: 'revenue', code: 'LINE-001', name: '会员收入' }
    const cost = line('cost')
    const initial = patchForForecastScheme(cost, 'revenue_ratio', [], [revenue, cost])
    const configured: ForecastLineDraft = {
      ...cost,
      ...initial,
      calculationConfig: { revenueLineCode: 'LINE-001', ratioValue: '30' },
    }
    const result = patchForForecastScheme(configured, 'revenue_ratio', [], [revenue, cost])
    expect(result.formulaExpression).toBe('LINE("LINE-001") * 30%')
  })
})
