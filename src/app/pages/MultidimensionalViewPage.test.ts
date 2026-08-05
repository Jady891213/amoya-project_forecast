import { describe, expect, it } from 'vitest'
import type { PivotMetadata, PivotRequest } from '../../shared/domain/types'
import type { AppSnapshot } from '../state/types'
import { movePivotDimension, projectPlanComparisonRequest } from './MultidimensionalViewPage'

const metadata: PivotMetadata = {
  scenario: { id: 'baseline', label: '基准场景' },
  dimensions: [
    { dimension: 'project', label: '项目', members: [{ id: '__all_projects__', label: '全部项目', sortKey: 0 }] },
    { dimension: 'plan', label: '方案', members: [{ id: 'plan-a', label: '方案A', parentId: 'project-a', sortKey: 1 }] },
    { dimension: 'department', label: '申报部门', members: [{ id: '__all_departments__', label: '全部部门', sortKey: 0 }] },
    { dimension: 'period', label: '期间', members: [{ id: '2026-01', label: '2026-01', sortKey: 1 }] },
    { dimension: 'metric', label: '指标', members: [{ id: 'revenue', label: '收入', sortKey: 1 }] },
  ],
}

const request: PivotRequest = {
  rows: [
    { dimension: 'plan', memberIds: ['plan-a'] },
    { dimension: 'metric', memberIds: ['revenue'] },
  ],
  columns: [{ dimension: 'period', memberIds: ['2026-01'] }],
  pov: [
    { dimension: 'project', memberId: '__all_projects__' },
    { dimension: 'department', memberId: '__all_departments__' },
  ],
  periodLevel: 'month',
  scenarioId: 'baseline',
}

describe('项目报表维度拖拽', () => {
  it('允许从列轴拖入行轴，即使列轴暂时为空', () => {
    const next = movePivotDimension(request, metadata, 'period', 'rows', 1)
    expect(next.rows.map((item) => item.dimension)).toEqual(['plan', 'period', 'metric'])
    expect(next.columns).toEqual([])
  })

  it('允许在同一区域内调整维度顺序', () => {
    const next = movePivotDimension(request, metadata, 'metric', 'rows', 0)
    expect(next.rows.map((item) => item.dimension)).toEqual(['metric', 'plan'])
  })

  it('允许行轴维度拖入背景，并保留成员选择', () => {
    const next = movePivotDimension(request, metadata, 'plan', 'pov', 1)
    expect(next.rows.map((item) => item.dimension)).toEqual(['metric'])
    expect(next.pov).toEqual([
      { dimension: 'project', memberId: '__all_projects__' },
      { dimension: 'department', memberId: '__all_departments__' },
      { dimension: 'plan', memberId: 'plan-a' },
    ])
  })
})

describe('项目方案对比预置', () => {
  it('使用完整指标树，并按期间再方案组织列轴', () => {
    const comparisonMetadata: PivotMetadata = {
      ...metadata,
      dimensions: metadata.dimensions.map((dimension) => {
        if (dimension.dimension === 'project') return { ...dimension, members: [{ id: 'project-a', label: '项目A', sortKey: 1 }] }
        if (dimension.dimension === 'plan') return { ...dimension, members: [
          { id: 'plan-a', label: '方案A', parentId: 'project-a', sortKey: 1, status: 'active' },
          { id: 'plan-b', label: '方案B', parentId: 'project-a', sortKey: 2, status: 'active' },
        ] }
        if (dimension.dimension === 'period') return { ...dimension, members: [
          { id: '2026-01', label: '2026-01', sortKey: 1 },
          { id: '2027-01', label: '2027-01', sortKey: 2 },
        ] }
        if (dimension.dimension === 'metric') return { ...dimension, members: [
          { id: 'revenue', label: '收入', sortKey: 1, hierarchyLevel: 0, isLeaf: false },
          { id: 'revenue_subscription', label: '年度订阅费', parentId: 'revenue', sortKey: 2, hierarchyLevel: 1, isLeaf: true },
          { id: 'cost', label: '成本', sortKey: 3, hierarchyLevel: 0, isLeaf: false },
        ] }
        return dimension
      }),
    }
    const snapshot = {
      plans: [
        { projectId: 'project-a', planId: 'plan-a', name: '方案A', startPeriod: '2026-01', endPeriod: '2026-12', status: 'active' },
        { projectId: 'project-a', planId: 'plan-b', name: '方案B', startPeriod: '2027-01', endPeriod: '2027-12', status: 'active' },
      ],
    } as AppSnapshot
    const next = projectPlanComparisonRequest(comparisonMetadata, snapshot, 'project-a')!
    expect(next.rows).toEqual([{ dimension: 'metric', memberIds: ['revenue', 'revenue_subscription', 'cost'] }])
    expect(next.columns.map((item) => item.dimension)).toEqual(['period', 'plan'])
    expect(next.columns[0].memberIds).toEqual(['2026', '2027'])
    expect(next.columns[1].memberIds).toEqual(['plan-a', 'plan-b'])
  })
})
