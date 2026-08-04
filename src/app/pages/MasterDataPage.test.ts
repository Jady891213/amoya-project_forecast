import { describe, expect, it } from 'vitest'
import { MASTER_DATA_TABS } from './MasterDataPage'

describe('MasterDataPage', () => {
  it('固定展示五类主数据', () => {
    expect(MASTER_DATA_TABS.map((tab) => tab.key)).toEqual([
      'projects',
      'plans',
      'departments',
      'periods',
      'scenarios',
    ])
  })
})
