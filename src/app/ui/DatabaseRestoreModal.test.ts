import { describe, expect, it } from 'vitest'
import { validateDatabaseFileName } from './DatabaseRestoreModal'

describe('本地数据恢复文件名', () => {
  it('只接受统一的数据文件名称', () => {
    expect(validateDatabaseFileName('amoya_project_forecast.db')).toBe('')
    expect(validateDatabaseFileName('amoya_project_forecast (1).db')).toContain('文件名称不正确')
    expect(validateDatabaseFileName('其他项目.db')).toContain('amoya_project_forecast.db')
  })
})
