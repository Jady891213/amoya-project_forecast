import { describe, expect, it } from 'vitest'
import { validateProjectDraft } from './ProjectWorkspacePage'

const validProject = {
  name: '测试项目',
  departmentId: 'department-1',
  startPeriod: '2026-01',
  endPeriod: '2026-12',
  modules: [],
}

describe('项目工作区保存前校验', () => {
  it('接受完整且期间有效的项目', () => {
    expect(validateProjectDraft(validProject)).toBeUndefined()
  })

  it('在结束期间早于开始期间时阻止保存', () => {
    expect(validateProjectDraft({ ...validProject, endPeriod: '2025-12' }))
      .toBe('结束期间不能早于开始期间')
  })

  it('校验名称、申报部门和期间格式', () => {
    expect(validateProjectDraft({ ...validProject, name: ' ' })).toBe('项目名称不能为空')
    expect(validateProjectDraft({ ...validProject, departmentId: ' ' })).toBe('申报部门不能为空')
    expect(validateProjectDraft({ ...validProject, startPeriod: '2026-13' })).toBe('开始期间格式不正确')
  })
})
