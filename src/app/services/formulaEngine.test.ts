import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type {
  ForecastLine,
  ProjectParameter,
  ProjectParameterValue,
} from '../../shared/domain/types'
import {
  evaluateFormula,
  humanizeFormula,
  parseFormula,
} from '../../shared/calculation/formulaEngine'
import { resolveFormulaDependencies } from '../../shared/calculation/formulaDependencyGraph'
import { compileForecast } from '../../shared/calculation/forecastCompiler'
import { project, line } from './forecastCompiler.testFixtures'

function parameter(
  overrides: Partial<ProjectParameter> = {},
): ProjectParameter {
  return {
    id: 'parameter-1',
    projectId: project.id,
    code: 'PAR-001',
    name: '用户数',
    parameterType: 'fixed',
    valueType: 'quantity',
    unit: '户',
    fixedValue: '100',
    description: '',
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('FormulaEngine', () => {
  it('按四则运算优先级、括号、负数和百分数计算', () => {
    const parsed = parseFormula('-(2 + 3) * 20% + 4 / 2')
    expect(evaluateFormula(parsed, () => undefined).toString()).toBe('1')
  })

  it('解析参数和行项目引用并生成中文说明', () => {
    const expression = 'LINE("LINE-001") * PARAM("PAR-001")'
    const parsed = parseFormula(expression)
    expect(parsed.references).toEqual([
      { type: 'line', code: 'LINE-001' },
      { type: 'parameter', code: 'PAR-001' },
    ])
    expect(
      humanizeFormula(
        expression,
        new Map([['PAR-001', '分成比例']]),
        new Map([['LINE-001', '业务收入']]),
      ),
    ).toBe('业务收入 × 分成比例')
  })

  it('检测公式行循环引用', () => {
    const lines: ForecastLine[] = [
      line({
        id: 'line-a',
        code: 'LINE-001',
        forecastMethod: 'formula',
        formulaExpression: 'LINE("LINE-002")',
      }),
      line({
        id: 'line-b',
        code: 'LINE-002',
        forecastMethod: 'formula',
        formulaExpression: 'LINE("LINE-001")',
      }),
    ]
    const result = resolveFormulaDependencies(lines)
    expect(result.errors.get('line-a')).toContain('循环引用')
    expect(result.errors.get('line-b')).toContain('循环引用')
  })

  it('按期间组合逐月参数和上游行项目', () => {
    const parameters = [
      parameter(),
      parameter({
        id: 'parameter-2',
        code: 'PAR-002',
        name: '月单价',
        parameterType: 'monthly',
        valueType: 'currency',
        fixedValue: undefined,
      }),
      parameter({
        id: 'parameter-3',
        code: 'PAR-003',
        name: '分成比例',
        valueType: 'percentage',
        fixedValue: '0.2',
      }),
    ]
    const parameterValues: ProjectParameterValue[] = [
      { parameterId: 'parameter-2', period: '2026-01', value: '10' },
      { parameterId: 'parameter-2', period: '2026-02', value: '12' },
    ]
    const revenue = line({
      id: 'line-revenue',
      code: 'LINE-001',
      forecastMethod: 'formula',
      formulaExpression: 'PARAM("PAR-001") * PARAM("PAR-002")',
      startPeriod: '2026-01',
      endPeriod: '2026-02',
    })
    const cost = line({
      id: 'line-cost',
      code: 'LINE-002',
      name: '渠道分成',
      category: 'cost',
      metricCode: 'cost',
      forecastMethod: 'formula',
      formulaExpression: 'LINE("LINE-001") * PARAM("PAR-003")',
      startPeriod: '2026-01',
      endPeriod: '2026-02',
    })
    const result = compileForecast(
      project,
      [revenue, cost],
      [],
      parameters,
      parameterValues,
    )
    expect(result.issues).toHaveLength(0)
    expect(
      result.values.map((value) => [
        value.lineId,
        value.period,
        value.value,
      ]),
    ).toEqual([
      ['line-revenue', '2026-01', '1000'],
      ['line-revenue', '2026-02', '1200'],
      ['line-cost', '2026-01', '200'],
      ['line-cost', '2026-02', '240'],
    ])
  })

  it('逐月参数缺失和除零会阻止公式结果', () => {
    const missing = parameter({
      parameterType: 'monthly',
      fixedValue: undefined,
    })
    const divisor = parameter({
      id: 'parameter-2',
      code: 'PAR-002',
      name: '除数',
      fixedValue: '0',
    })
    const formula = line({
      forecastMethod: 'formula',
      formulaExpression: 'PARAM("PAR-001") / PARAM("PAR-002")',
      startPeriod: '2026-01',
      endPeriod: '2026-01',
    })
    const result = compileForecast(
      project,
      [formula],
      [],
      [missing, divisor],
      [],
    )
    expect(result.values).toHaveLength(0)
    expect(result.issues.map((issue) => issue.message).join('；')).toContain(
      '没有可用值',
    )
  })

  it('直接除零返回明确错误', () => {
    const parsed = parseFormula('10 / 0')
    expect(() => evaluateFormula(parsed, () => new Decimal(0))).toThrow(
      '除零',
    )
  })
})
