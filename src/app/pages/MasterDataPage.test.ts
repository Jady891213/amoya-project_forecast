import { describe, expect, it } from 'vitest'
import { MASTER_DATA_TABS } from './MasterDataPage'

describe('MasterDataPage', () => {
  it('固定展示六类主数据，避免语义接口重构时只保留部门', () => {
    expect(MASTER_DATA_TABS.map((tab) => tab.key)).toEqual([
      'projects',
      'departments',
      'modules',
      'periods',
      'scenarios',
      'versions',
    ])
  })
})
