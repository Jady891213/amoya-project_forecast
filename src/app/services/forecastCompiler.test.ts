import { describe, expect, it } from 'vitest'
import type {
  ForecastMonthlyValue,
} from '../../shared/domain/types'
import { buildForecastConfigHash, compileForecast } from '../../shared/calculation/forecastCompiler'
import { line, project } from './forecastCompiler.testFixtures'

describe('ForecastCompiler', () => {
  it('固定月金额只在生效期间展开并保持十进制精度', () => {
    const result = compileForecast(
      project,
      [line({ startPeriod: '2026-02', endPeriod: '2026-03' })],
      [],
    )

    expect(result.issues).toHaveLength(0)
    expect(result.values.map((item) => [item.period, item.value])).toEqual([
      ['2026-02', '100.25'],
      ['2026-03', '100.25'],
    ])
  })

  it('逐月填写将空白月份按0展开，并保留负数调整提醒', () => {
    const monthlyLine = line({
      category: 'cost',
      metricCode: 'cost_marketing_channel',
      forecastMethod: 'monthly_input',
      fixedMonthlyValue: undefined,
      startPeriod: '2026-01',
      endPeriod: '2026-03',
    })
    const values: ForecastMonthlyValue[] = [
      { lineId: monthlyLine.id, period: '2026-01', value: '20' },
      { lineId: monthlyLine.id, period: '2026-03', value: '-5' },
    ]

    const result = compileForecast(project, [monthlyLine], values)

    expect(result.values.map((item) => item.value)).toEqual(['20', '0', '-5'])
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'warning', period: '2026-03' }),
        expect.objectContaining({
          severity: 'warning',
          message: '1个月未填写，已按0计算',
        }),
      ]),
    )
  })

  it('相同配置摘要稳定，配置值变化后摘要变化', () => {
    const lines = [line()]
    const values: ForecastMonthlyValue[] = []
    const first = buildForecastConfigHash(lines, values)
    const second = buildForecastConfigHash([...lines], [...values])
    const changed = buildForecastConfigHash(
      [line({ fixedMonthlyValue: '100.26' })],
      values,
    )

    expect(second).toBe(first)
    expect(changed).not.toBe(first)
  })

  it('公式引用读取上游标准化后的未税金额', () => {
    const revenue = line({
      id: 'line-revenue',
      code: 'LINE-001',
      fixedMonthlyValue: '106',
      amountBasis: 'tax_inclusive',
      taxRate: '0.06',
      startPeriod: '2026-01',
      endPeriod: '2026-01',
    })
    const cost = line({
      id: 'line-cost',
      code: 'LINE-002',
      name: '渠道分成',
      category: 'cost',
      metricCode: 'cost_marketing_channel',
      forecastMethod: 'formula',
      formulaExpression: 'LINE("LINE-001") * 20%',
      fixedMonthlyValue: undefined,
      amountBasis: 'tax_exclusive',
      taxRate: '0.06',
      startPeriod: '2026-01',
      endPeriod: '2026-01',
    })

    const result = compileForecast(project, [revenue, cost], [])
    const costValue = result.values.find((item) => item.lineId === cost.id)
    expect(result.issues).toHaveLength(0)
    expect(costValue).toEqual(
      expect.objectContaining({
        rawValue: '20',
        netValue: '20',
        grossValue: '21.2',
      }),
    )
  })

  it('拒绝非法税率', () => {
    const result = compileForecast(
      project,
      [line({ taxRate: '1' })],
      [],
    )
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'taxRate', severity: 'error' }),
      ]),
    )
    expect(result.values).toHaveLength(0)
  })

  it('人工调整不进入预测公式编译链路', () => {
    const revenue = line({
      id: 'line-revenue',
      code: 'LINE-001',
      fixedMonthlyValue: '106',
      amountBasis: 'tax_inclusive',
      taxRate: '0.06',
      startPeriod: '2026-01',
      endPeriod: '2026-01',
    })
    const cost = line({
      id: 'line-cost',
      code: 'LINE-002',
      category: 'cost',
      metricCode: 'cost_marketing_channel',
      forecastMethod: 'formula',
      formulaExpression: 'LINE("LINE-001") * 20%',
      fixedMonthlyValue: undefined,
      startPeriod: '2026-01',
      endPeriod: '2026-01',
    })
    const result = compileForecast(project, [revenue, cost], [], [], [])

    expect(result.values.find((item) => item.lineId === revenue.id)).toEqual(
      expect.objectContaining({ netValue: '100', grossValue: '106' }),
    )
    expect(result.values.find((item) => item.lineId === cost.id)).toEqual(
      expect.objectContaining({ netValue: '20' }),
    )
  })

  it('收入成本预测行只能落在合法末级指标', () => {
    const result = compileForecast(project, [line({ metricCode: 'revenue' })], [])
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'metricCode', severity: 'error' }),
    ]))
    expect(result.values).toHaveLength(0)
  })

  it('项目计算坐标变化会改变完整输入摘要', () => {
    const lines = [line()]
    const base = buildForecastConfigHash(lines, [], [], [], [], project)
    const changedCoordinate = buildForecastConfigHash(
      lines,
      [],
      [],
      [],
      [],
      { ...project, departmentId: 'department-other' },
    )
    expect(changedCoordinate).not.toBe(base)
  })

  it('期间覆盖不能掩盖原公式错误', () => {
    const formulaLine = line({
      id: 'line-formula-error',
      forecastMethod: 'formula',
      formulaExpression: 'PARAM("PAR-NOT-FOUND") * 10',
      fixedMonthlyValue: undefined,
      startPeriod: '2026-01',
      endPeriod: '2026-01',
    })
    const result = compileForecast(project, [formulaLine], [], [], [])
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', lineId: formulaLine.id }),
    ]))
    expect(result.values).toHaveLength(0)
  })
})
