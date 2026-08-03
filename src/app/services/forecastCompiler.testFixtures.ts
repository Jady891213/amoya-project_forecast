import type { ForecastLine, Project } from '../domain/types'

export const project: Project = {
  id: 'project-forecast',
  code: 'P-FORECAST',
  name: '预测编译测试',
  departmentId: 'department-finance',
  startPeriod: '2026-01',
  endPeriod: '2026-04',
  status: 'calculating',
  draftRevision: 0,
  origin: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export function line(
  overrides: Partial<ForecastLine> = {},
): ForecastLine {
  return {
    id: 'line-1',
    projectId: project.id,
    code: 'LINE-001',
    name: '基础收入',
    category: 'revenue',
    metricCode: 'revenue',
    forecastMethod: 'fixed_monthly',
    startPeriod: '2026-01',
    endPeriod: '2026-04',
    fixedMonthlyValue: '100.25',
    amountBasis: 'tax_exclusive',
    taxRate: '0',
    assumption: '',
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}
