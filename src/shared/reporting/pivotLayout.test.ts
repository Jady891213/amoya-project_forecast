import { describe, expect, it } from 'vitest'
import type { PivotTuple } from '../domain/types'
import { buildPivotHeaderRows } from './pivotLayout'

function tuple(plan: string, period: string): PivotTuple {
  return {
    key: `${plan}:${period}`,
    members: [
      { dimension: 'plan', memberId: plan, label: plan },
      { dimension: 'period', memberId: period, label: period },
    ],
  }
}

describe('buildPivotHeaderRows', () => {
  it('按方案再期间生成连续的多级合并表头', () => {
    const rows = buildPivotHeaderRows([
      tuple('方案A', '2026'), tuple('方案A', '2027'),
      tuple('方案B', '2026'), tuple('方案B', '2027'),
    ], 2)
    expect(rows[0].map((item) => [item.label, item.span])).toEqual([['方案A', 2], ['方案B', 2]])
    expect(rows[1].map((item) => [item.label, item.span])).toEqual([['2026', 1], ['2027', 1], ['2026', 1], ['2027', 1]])
  })

  it('相同名称但不同成员ID不会错误合并', () => {
    const tuples: PivotTuple[] = [
      { key: 'a', members: [{ dimension: 'plan', memberId: 'project-a-plan', label: '方案1' }] },
      { key: 'b', members: [{ dimension: 'plan', memberId: 'project-b-plan', label: '方案1' }] },
    ]
    expect(buildPivotHeaderRows(tuples, 1)[0].map((item) => item.span)).toEqual([1, 1])
  })
})
