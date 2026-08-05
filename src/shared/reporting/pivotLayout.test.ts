import { describe, expect, it } from 'vitest'
import type { PivotTuple } from '../domain/types'
import type { PivotMetadata } from '../domain/types'
import { buildPivotHeaderRows, displayPivotTuples } from './pivotLayout'

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

  it('按期间再方案生成期间优先的多级合并表头', () => {
    const tuples: PivotTuple[] = [
      ['2026', '方案A'], ['2026', '方案B'], ['2027', '方案A'], ['2027', '方案B'],
    ].map(([period, plan]) => ({
      key: `${period}:${plan}`,
      members: [
        { dimension: 'period', memberId: period, label: period },
        { dimension: 'plan', memberId: plan, label: plan },
      ],
    }))
    const rows = buildPivotHeaderRows(tuples, 2)
    expect(rows[0].map((item) => [item.label, item.span])).toEqual([['2026', 2], ['2027', 2]])
    expect(rows[1].map((item) => [item.label, item.span])).toEqual([['方案A', 1], ['方案B', 1], ['方案A', 1], ['方案B', 1]])
  })

  it('方案名称可在项目加方案和仅方案之间切换', () => {
    const metadata: PivotMetadata = {
      scenario: { id: 'baseline', label: '基准场景' },
      dimensions: [
        { dimension: 'project', label: '项目', members: [{ id: 'project-a', label: '项目A', sortKey: 1 }] },
        { dimension: 'plan', label: '方案', members: [{ id: 'plan-a', label: '方案1', parentId: 'project-a', sortKey: 1 }] },
        { dimension: 'department', label: '申报部门', members: [] },
        { dimension: 'period', label: '期间', members: [] },
        { dimension: 'metric', label: '指标', members: [] },
      ],
    }
    const tuples: PivotTuple[] = [{ key: 'plan-a', members: [{ dimension: 'plan', memberId: 'plan-a', label: '项目A（方案1）', parentId: 'project-a' }] }]
    expect(displayPivotTuples(tuples, metadata, 'project_plan')[0].members[0].label).toBe('项目A（方案1）')
    expect(displayPivotTuples(tuples, metadata, 'plan')[0].members[0].label).toBe('方案1')
  })
})
