import { describe, expect, it } from 'vitest'
import type { PivotMetadata, PivotRequest } from '../../shared/domain/types'
import { movePivotDimension } from './MultidimensionalViewPage'

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
