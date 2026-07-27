export type DataOrigin = 'system' | 'user' | 'demo'
export type DepartmentStatus = 'active' | 'inactive'
export type ProjectStatus = 'calculating' | 'archived'
export type MetricCategory = 'profit' | 'cashflow'
export type MetricValueType = 'currency' | 'percentage'
export type MetricType = 'base' | 'calculated'
export type PeriodAggregation = 'sum' | 'recompute' | 'ending'
export type VersionStatus = 'working' | 'snapshot'

export const BASELINE_SCENARIO_CODE = 'baseline'
export const WORKING_VERSION_CODE = 'working'
export const REFERENCE_DATASET_ID = 'p0-reference-v2'

export type BaseMetricCode =
  | 'revenue'
  | 'cost'
  | 'cash_inflow'
  | 'cash_outflow'

export type CalculatedMetricCode =
  | 'gross_profit'
  | 'gross_margin'
  | 'net_cash_flow'
  | 'cumulative_cash_flow'

export type MetricCode = BaseMetricCode | CalculatedMetricCode

export interface OriginFields {
  origin: DataOrigin
  datasetId?: string
}

export interface Department extends OriginFields {
  id: string
  code: string
  name: string
  status: DepartmentStatus
  createdAt: string
  updatedAt: string
}

export interface Project extends OriginFields {
  id: string
  code?: string
  name: string
  customer: string
  departmentId: string
  owner: string
  startPeriod: string
  durationMonths: number
  status: ProjectStatus
  remark: string
  attributesJson?: string
  createdAt: string
  updatedAt: string
}

export interface ProjectModule extends OriginFields {
  id: string
  projectId: string
  code: string
  name: string
  isCommon: boolean
  createdAt: string
  updatedAt: string
}

export interface PeriodDimension {
  period: string
  displayName: string
  year: number
  quarter: number
  monthNumber: number
  sortKey: number
}

export interface Scenario {
  id: string
  code: string
  name: string
  isDefault: boolean
  origin: 'system'
  createdAt: string
  updatedAt: string
}

export interface Version {
  id: string
  code: string
  name: string
  status: VersionStatus
  isMutable: boolean
  origin: 'system'
  createdAt: string
  updatedAt: string
}

export interface MetricDefinition {
  code: MetricCode
  name: string
  metricType: MetricType
  category: MetricCategory
  expression?: string
  unit: string
  valueType: MetricValueType
  periodAggregation: PeriodAggregation
  description: string
  dependencies: MetricCode[]
  sortOrder: number
  systemManaged: boolean
  origin: 'system'
}

export interface BaseFact extends OriginFields {
  id: string
  projectId: string
  departmentId: string
  period: string
  scenarioId: string
  versionId: string
  businessModuleId: string
  metricCode: BaseMetricCode
  value: string
  sourceLabel: string
  createdAt?: string
  updatedAt?: string
}

export interface CalculatedFact {
  projectId: string
  period: string
  scenarioId: string
  versionId: string
  businessModuleId: string | 'all'
  metricCode: CalculatedMetricCode
  value: string | null
  source: 'calculated'
  expression: string
  dependencies: MetricCode[]
}

export interface AppMetadata {
  key: string
  value: string
  updatedAt: string
}

export interface ProjectInput {
  id?: string
  code?: string
  name: string
  customer: string
  departmentId: string
  owner: string
  startPeriod: string
  durationMonths: number
  remark: string
  modules: Array<{ code: string; name: string }>
}

export interface DepartmentInput {
  id?: string
  code: string
  name: string
  status?: DepartmentStatus
}

export interface ReportQuery {
  projectId: string
  scenarioId: string
  versionId: string
  businessModuleId?: string
}

export interface MonthlyMetricRow {
  period: string
  revenue: string
  cost: string
  grossProfit: string
  grossMargin: string | null
  cashInflow: string
  cashOutflow: string
  netCashFlow: string
  cumulativeCashFlow: string
}

export interface ReportSummary {
  revenue: string
  cost: string
  grossProfit: string
  grossMargin: string | null
  cashInflow: string
  cashOutflow: string
  netCashFlow: string
  cumulativeCashFlow: string
  maximumFunding: string
  cashPositiveLabel: string
}

export interface ProjectReport {
  project: Project
  department?: Department
  query: ReportQuery
  scenario: Scenario
  version: Version
  modules: ProjectModule[]
  selectedModule?: ProjectModule
  hasFacts: boolean
  factCount: number
  monthly: MonthlyMetricRow[]
  summary: ReportSummary
  metricDefinitions: MetricDefinition[]
  calculatedFacts: CalculatedFact[]
}
