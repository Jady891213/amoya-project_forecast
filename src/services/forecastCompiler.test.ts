import { describe, expect, it } from 'vitest'
import type {
  ForecastLine,
  ForecastMonthlyValue,
  Project,
  ProjectModule,
} from '../domain/types'
import { buildForecastConfigHash, compileForecast } from './forecastCompiler'

const project: Project = {
  id: 'project-forecast',
  code: 'P-FORECAST',
  name: '预测编译测试',
  customer: '',
  departmentId: 'department-finance',
  owner: '',
  startPeriod: '2026-01',
  durationMonths: 4,
  status: 'calculating',
  remark: '',
  origin: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const module: ProjectModule = {
  id: 'module-public',
  projectId: project.id,
  code: 'PUBLIC',
  name: '公共',
  isCommon: true,
  origin: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function line(
  overrides: Partial<ForecastLine> = {},
): ForecastLine {
  return {
    id: 'line-1',
    projectId: project.id,
    code: 'LINE-001',
    name: '基础收入',
    category: 'revenue',
    metricCode: 'revenue',
    businessModuleId: module.id,
    forecastMethod: 'fixed_monthly',
    startPeriod: '2026-01',
    endPeriod: '2026-04',
    fixedMonthlyValue: '100.25',
    assumption: '',
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('ForecastCompiler', () => {
  it('固定月金额只在生效期间展开并保持十进制精度', () => {
    const result = compileForecast(
      project,
      [module],
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
      metricCode: 'cost',
      forecastMethod: 'monthly_input',
      fixedMonthlyValue: undefined,
      startPeriod: '2026-01',
      endPeriod: '2026-03',
    })
    const values: ForecastMonthlyValue[] = [
      { lineId: monthlyLine.id, period: '2026-01', value: '20' },
      { lineId: monthlyLine.id, period: '2026-03', value: '-5' },
    ]

    const result = compileForecast(project, [module], [monthlyLine], values)

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
})
