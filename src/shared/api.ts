export type {
  ApiError,
  AppMetadata,
  BaseFact,
  PlanCalculationState,
  Department,
  DepartmentInput,
  FactAdjustment,
  FactAdjustmentDraft,
  ForecastProjectState,
  MetricDefinition,
  PeriodDimension,
  Project,
  ProjectPlan,
  ProjectInput,
  CreateProjectInput,
  ProjectReportDto,
  ProjectWorkspace,
  ProjectWorkspaceDraft,
  SaveProjectWorkspaceRequest,
  Scenario,
  PivotMetadata,
  PivotRequest,
  PivotResponse,
  CreateProjectPlanRequest,
} from './domain/types'

import type {
  BaseFact,
  Department,
  MetricDefinition,
  PeriodDimension,
  Project,
  ProjectPlan,
  Scenario,
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
  plans: ProjectPlan[]
  metrics: MetricDefinition[]
  facts: BaseFact[]
  storage: StorageRuntimeInfo
}

export interface BootstrapDto {
  snapshot: AppSnapshot
}

export interface CalculationRequest {
  planId: string
  expectedRevision: number
}

export interface CalculationResponse {
  success: boolean
  state: import('./domain/types').PlanCalculationState
  issues: import('./domain/types').CalculationIssue[]
}

export interface SavePlanAdjustmentsRequest {
  expectedResultRevision: number
  adjustments: import('./domain/types').FactAdjustmentDraft[]
}

export interface SavePlanAdjustmentsResponse {
  state: import('./domain/types').PlanCalculationState
  adjustments: import('./domain/types').FactAdjustment[]
}

export interface RestoreDatabaseResponse {
  ok: true
  schemaVersion: number
}

export function isProjectInput(value: unknown): value is import('./domain/types').ProjectInput {
  if (!value || typeof value !== 'object') return false
  const input = value as unknown as Record<string, unknown>
  return (
    typeof input.name === 'string' &&
    typeof input.departmentId === 'string'
  )
}

export function isCreateProjectInput(value: unknown): value is import('./domain/types').CreateProjectInput {
  if (!isProjectInput(value)) return false
  const input = value as unknown as Record<string, unknown>
  return typeof input.startPeriod === 'string' && typeof input.endPeriod === 'string'
}

export function isSaveProjectWorkspaceRequest(
  value: unknown,
): value is import('./domain/types').SaveProjectWorkspaceRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  if (typeof request.planId !== 'string' || !request.planId) return false
  if (!Number.isInteger(request.expectedRevision)) return false
  const draft = request.draft as Record<string, unknown> | undefined
  if (!draft || !isProjectInput(draft.project)) return false
  const plan = draft.plan as Record<string, unknown> | undefined
  if (!plan || typeof plan.name !== 'string' || typeof plan.startPeriod !== 'string' || typeof plan.endPeriod !== 'string') return false
  const forecast = draft.forecast as Record<string, unknown> | undefined
  return Boolean(
    forecast &&
    Array.isArray(forecast.lines) &&
    Array.isArray(forecast.parameters),
  )
}
