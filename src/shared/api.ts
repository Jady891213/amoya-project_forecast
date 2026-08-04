export type {
  ApiError,
  AppMetadata,
  BaseFact,
  CalculationRun,
  Department,
  DepartmentInput,
  ForecastOverrideDraft,
  ForecastProjectState,
  MetricDefinition,
  PeriodDimension,
  Project,
  ProjectVersion,
  ProjectInput,
  ProjectReportDto,
  ProjectWorkspace,
  ProjectWorkspaceDraft,
  SaveProjectWorkspaceRequest,
  Scenario,
  Version,
  PivotRequest,
  PivotResponse,
  CreateProjectVersionRequest,
} from './domain/types'

import type {
  BaseFact,
  Department,
  MetricDefinition,
  PeriodDimension,
  Project,
  Scenario,
  Version,
} from './domain/types'

export type StorageMode = 'persistent' | 'portable' | 'transient'

export interface StorageRuntimeInfo {
  mode: StorageMode
  label: string
  detail: string
  sqliteVersion: string
  schemaVersion: number
  persistent: boolean
}

export interface AppSnapshot {
  departments: Department[]
  projects: Project[]
  periods: PeriodDimension[]
  scenarios: Scenario[]
  versions: Version[]
  metrics: MetricDefinition[]
  facts: BaseFact[]
  storage: StorageRuntimeInfo
}

export interface BootstrapDto {
  snapshot: AppSnapshot
}

export interface CalculationRequest {
  versionId: string
  expectedRevision: number
}

export interface CalculationResponse {
  success: boolean
  run: import('./domain/types').CalculationRun
  issues: import('./domain/types').CalculationIssue[]
}

export interface RestoreDatabaseResponse {
  ok: true
  schemaVersion: number
}

export function isProjectInput(value: unknown): value is import('./domain/types').ProjectInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  return (
    typeof input.name === 'string' &&
    typeof input.departmentId === 'string' &&
    typeof input.startPeriod === 'string' &&
    typeof input.endPeriod === 'string'
  )
}

export function isSaveProjectWorkspaceRequest(
  value: unknown,
): value is import('./domain/types').SaveProjectWorkspaceRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  if (typeof request.versionId !== 'string' || !request.versionId) return false
  if (!Number.isInteger(request.expectedRevision)) return false
  const draft = request.draft as Record<string, unknown> | undefined
  if (!draft || !isProjectInput(draft.project)) return false
  const forecast = draft.forecast as Record<string, unknown> | undefined
  return Boolean(
    forecast &&
    Array.isArray(forecast.lines) &&
    Array.isArray(forecast.parameters),
  )
}
