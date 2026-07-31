import { describe, expect, it } from 'vitest'
import { SYSTEM_METRICS } from '../domain/metrics'
import {
  BASELINE_SCENARIO_CODE,
  WORKING_VERSION_CODE,
  type BaseFact,
  type BaseMetricCode,
  type Project,
} from '../domain/types'
import { calculateMetrics } from './metricEngine'

const project: Project = {
  id: 'project-test',
  name: '测试项目',
  customer: '',
  departmentId: 'dept-test',
  owner: '',
  startPeriod: '2026-01',
  durationMonths: 3,
  status: 'calculating',
  remark: '',
  draftRevision: 0,
  origin: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function fact(
  period: string,
  metricCode: BaseMetricCode,
  value: number,
  moduleId = 'module-a',
): BaseFact {
  return {
    id: `${period}:${metricCode}:${moduleId}`,
    projectId: project.id,
    departmentId: project.departmentId,
    period,
    scenarioId: `${project.id}:${BASELINE_SCENARIO_CODE}`,
    versionId: `${project.id}:${WORKING_VERSION_CODE}`,
    businessModuleId: moduleId,
    metricCode,
    value: String(value),
    sourceLabel: '测试',
    origin: 'user',
  }
}

describe('MetricEngine', () => {
  it('计算分月损益、现金流、最大垫资和现金转正月份', () => {
    const facts = [
      fact('2026-01', 'revenue', 100),
      fact('2026-01', 'cost', 70),
      fact('2026-01', 'cash_inflow', 0),
      fact('2026-01', 'cash_outflow', 90),
      fact('2026-02', 'revenue', 120),
      fact('2026-02', 'cost', 80),
      fact('2026-02', 'cash_inflow', 100),
      fact('2026-02', 'cash_outflow', 80),
      fact('2026-03', 'revenue', 140),
      fact('2026-03', 'cost', 90),
      fact('2026-03', 'cash_inflow', 180),
      fact('2026-03', 'cash_outflow', 60),
    ]

    const result = calculateMetrics(project, facts, SYSTEM_METRICS)

    expect(result.monthly[0]).toMatchObject({
      grossProfit: '30',
      grossMargin: '0.3',
      netCashFlow: '-90',
      cumulativeCashFlow: '-90',
    })
    expect(result.monthly[2].cumulativeCashFlow).toBe('50')
    expect(result.summary.grossProfit).toBe('120')
    expect(result.summary.grossMargin).toBe('0.333333')
    expect(result.summary.maximumFunding).toBe('90')
    expect(result.summary.cashPositiveLabel).toBe('2026-03')
  })

  it('收入为零时毛利率为空，不产生无穷值', () => {
    const result = calculateMetrics(
      { ...project, durationMonths: 1 },
      [
        fact('2026-01', 'revenue', 0),
        fact('2026-01', 'cost', 50),
      ],
      SYSTEM_METRICS,
    )

    expect(result.monthly[0].grossMargin).toBeNull()
    expect(result.summary.grossMargin).toBeNull()
    expect(
      result.calculatedFacts.find((item) => item.metricCode === 'gross_margin')
        ?.value,
    ).toBeNull()
  })

  it('缺少月份事实时以零补齐项目周期', () => {
    const result = calculateMetrics(
      project,
      [
        fact('2026-01', 'revenue', 100),
        fact('2026-03', 'revenue', 200),
      ],
      SYSTEM_METRICS,
    )

    expect(result.monthly).toHaveLength(3)
    expect(result.monthly[1].revenue).toBe('0')
    expect(result.summary.revenue).toBe('300')
  })

  it('按业务模块过滤且毛利率使用汇总值重新计算', () => {
    const facts = [
      fact('2026-01', 'revenue', 100, 'module-a'),
      fact('2026-01', 'cost', 60, 'module-a'),
      fact('2026-01', 'revenue', 300, 'module-b'),
      fact('2026-01', 'cost', 270, 'module-b'),
    ]

    const all = calculateMetrics(
      { ...project, durationMonths: 1 },
      facts,
      SYSTEM_METRICS,
    )
    const moduleA = calculateMetrics(
      { ...project, durationMonths: 1 },
      facts,
      SYSTEM_METRICS,
      'module-a',
    )

    expect(all.summary.grossMargin).toBe('0.175')
    expect(moduleA.summary.grossMargin).toBe('0.4')
  })

  it('区分无需垫资与预测期内未转正', () => {
    const noFunding = calculateMetrics(
      { ...project, durationMonths: 1 },
      [
        fact('2026-01', 'cash_inflow', 100),
        fact('2026-01', 'cash_outflow', 30),
      ],
      SYSTEM_METRICS,
    )
    const notPositive = calculateMetrics(
      { ...project, durationMonths: 1 },
      [
        fact('2026-01', 'cash_inflow', 0),
        fact('2026-01', 'cash_outflow', 30),
      ],
      SYSTEM_METRICS,
    )

    expect(noFunding.summary.cashPositiveLabel).toBe('无需垫资')
    expect(notPositive.summary.cashPositiveLabel).toBe('预测期内未转正')
  })
})
