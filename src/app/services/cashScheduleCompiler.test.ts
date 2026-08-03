import { describe, expect, it } from 'vitest'
import type { CashRule, ForecastLine } from '../domain/types'
import { compileCashSchedule } from './cashScheduleCompiler'
import { compileForecast } from './forecastCompiler'
import { line, project } from './forecastCompiler.testFixtures'

function rule(
  source: ForecastLine,
  overrides: Partial<CashRule> = {},
): CashRule {
  return {
    id: `rule-${source.id}`,
    projectId: project.id,
    sourceLineId: source.id,
    sourceLineCode: source.code,
    method: 'immediate',
    delayMonths: 0,
    installments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
    monthlyValues: overrides.monthlyValues ?? {},
  }
}

describe('CashScheduleCompiler', () => {
  it('含税收入先还原未税损益，再按含税金额生成当月收款', () => {
    const revenue = line({
      fixedMonthlyValue: '106',
      amountBasis: 'tax_inclusive',
      taxRate: '0.06',
      startPeriod: '2026-01',
      endPeriod: '2026-01',
    })
    const forecast = compileForecast(project, [revenue], [])
    const cash = compileCashSchedule(
      [revenue],
      forecast.values,
      [rule(revenue)],
    )

    expect(forecast.values[0]).toEqual(
      expect.objectContaining({
        rawValue: '106',
        netValue: '100',
        taxValue: '6',
        grossValue: '106',
        value: '100',
      }),
    )
    expect(cash.issues).toHaveLength(0)
    expect(cash.values[0]).toEqual(
      expect.objectContaining({
        metricCode: 'cash_inflow',
        sourcePeriod: '2026-01',
        settlementPeriod: '2026-01',
        value: '106',
      }),
    )
  })

  it('未税成本按税率生成含税延后付款', () => {
    const cost = line({
      category: 'cost',
      metricCode: 'cost',
      fixedMonthlyValue: '100',
      amountBasis: 'tax_exclusive',
      taxRate: '0.06',
      startPeriod: '2026-04',
      endPeriod: '2026-04',
    })
    const forecast = compileForecast(project, [cost], [])
    const cash = compileCashSchedule(
      [cost],
      forecast.values,
      [rule(cost, { method: 'delayed', delayMonths: 3 })],
    )

    expect(forecast.values[0].value).toBe('100')
    expect(forecast.values[0].grossValue).toBe('106')
    expect(cash.values[0]).toEqual(
      expect.objectContaining({
        metricCode: 'cash_outflow',
        settlementPeriod: '2026-07',
        value: '106',
      }),
    )
  })

  it('分期按比例生成并由最后一期吸收尾差', () => {
    const revenue = line({
      fixedMonthlyValue: '100',
      amountBasis: 'tax_exclusive',
      taxRate: '0',
      startPeriod: '2026-01',
      endPeriod: '2026-01',
    })
    const forecast = compileForecast(project, [revenue], [])
    const installmentRule = rule(revenue, {
      method: 'installment',
      installments: [
        {
          id: 'part-1',
          cashRuleId: 'rule-line-1',
          sequence: 1,
          offsetMonths: 0,
          ratio: '0.333333',
        },
        {
          id: 'part-2',
          cashRuleId: 'rule-line-1',
          sequence: 2,
          offsetMonths: 2,
          ratio: '0.666667',
        },
      ],
    })
    const cash = compileCashSchedule(
      [revenue],
      forecast.values,
      [installmentRule],
    )

    expect(cash.issues).toHaveLength(0)
    expect(cash.values.map((item) => [item.settlementPeriod, item.value]))
      .toEqual([
        ['2026-01', '33.3333'],
        ['2026-03', '66.6667'],
      ])
  })

  it('拒绝重复偏移月份的分期', () => {
    const revenue = line()
    const forecast = compileForecast(project, [revenue], [])
    const cash = compileCashSchedule(
      [revenue],
      forecast.values,
      [
        rule(revenue, {
          method: 'installment',
          installments: [
            {
              id: 'part-1',
              cashRuleId: 'rule-line-1',
              sequence: 1,
              offsetMonths: 1,
              ratio: '0.4',
            },
            {
              id: 'part-2',
              cashRuleId: 'rule-line-1',
              sequence: 2,
              offsetMonths: 1,
              ratio: '0.5',
            },
          ],
        }),
      ],
    )

    expect(cash.values).toHaveLength(0)
    expect(cash.issues[0].message).toContain('重复')
  })

  it('拒绝比例合计不等于100%的分期', () => {
    const revenue = line()
    const forecast = compileForecast(project, [revenue], [])
    const cash = compileCashSchedule(
      [revenue],
      forecast.values,
      [
        rule(revenue, {
          method: 'installment',
          installments: [
            {
              id: 'part-1',
              cashRuleId: 'rule-line-1',
              sequence: 1,
              offsetMonths: 0,
              ratio: '0.4',
            },
            {
              id: 'part-2',
              cashRuleId: 'rule-line-1',
              sequence: 2,
              offsetMonths: 1,
              ratio: '0.5',
            },
          ],
        }),
      ],
    )

    expect(cash.values).toHaveLength(0)
    expect(cash.issues[0].message).toContain('100%')
  })

  it('拒绝超过36个月的收付款偏移', () => {
    const revenue = line()
    const forecast = compileForecast(project, [revenue], [])
    const cash = compileCashSchedule(
      [revenue],
      forecast.values,
      [rule(revenue, { method: 'delayed', delayMonths: 37 })],
    )

    expect(cash.values).toHaveLength(0)
    expect(cash.issues[0].message).toContain('0～36')
  })

  it('逐月指定收款直接生成对应期间现金并核对含税应收总额', () => {
    const revenue = line({
      fixedMonthlyValue: '100',
      amountBasis: 'tax_exclusive',
      taxRate: '0',
      startPeriod: '2026-01',
      endPeriod: '2026-02',
    })
    const forecast = compileForecast(project, [revenue], [])
    const cash = compileCashSchedule([revenue], forecast.values, [rule(revenue, {
      method: 'manual_monthly',
      monthlyValues: { '2026-02': '50', '2026-03': '150' },
    })])

    expect(cash.issues).toHaveLength(0)
    expect(cash.values.map((item) => [item.settlementPeriod, item.value, item.ruleMethod]))
      .toEqual([
        ['2026-02', '50', 'manual_monthly'],
        ['2026-03', '150', 'manual_monthly'],
      ])
  })

  it('逐月指定收付款与含税结算额不一致时保留计划并给出差额提醒', () => {
    const revenue = line({ fixedMonthlyValue: '100', startPeriod: '2026-01', endPeriod: '2026-01' })
    const forecast = compileForecast(project, [revenue], [])
    const cash = compileCashSchedule([revenue], forecast.values, [rule(revenue, {
      method: 'manual_monthly',
      monthlyValues: { '2026-02': '80' },
    })])

    expect(cash.values[0].value).toBe('80')
    expect(cash.issues).toEqual([expect.objectContaining({ severity: 'warning', message: expect.stringContaining('差额') })])
  })
})
