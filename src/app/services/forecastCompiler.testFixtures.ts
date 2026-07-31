import type { ForecastLine, Project, ProjectModule } from '../domain/types'

export const project: Project = {
  id: 'project-forecast',
  code: 'P-FORECAST',
  name: '预测编译测试',
  customer: '',
  departmentId: 'department-finance',
  owner: '',
  startPeriod: '2026-01',
  durationMonths: 4,
  status: 'calculating',
  remark: '',
  draftRevision: 0,
  origin: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export const module: ProjectModule = {
  id: 'module-public',
  projectId: project.id,
  code: 'PUBLIC',
  name: '公共',
  isCommon: true,
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
    businessModuleId: module.id,
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
