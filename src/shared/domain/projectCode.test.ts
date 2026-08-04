import { describe, expect, it } from 'vitest'
import { nextProjectCode } from './projectCode'

describe('nextProjectCode', () => {
  it('按当前年度最大项目编号生成下一编号', () => {
    expect(nextProjectCode(['PRJ-2026-001', 'PRJ-2026-005', 'OTHER-999'], 2026)).toBe('PRJ-2026-006')
  })

  it('忽略其他年度并从001开始补齐', () => {
    expect(nextProjectCode(['PRJ-2025-009'], 2026)).toBe('PRJ-2026-001')
  })
})
