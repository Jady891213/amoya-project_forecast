export type DataOrigin = 'system' | 'user' | 'demo'
export type DepartmentStatus = 'active' | 'inactive'
export type ProjectStatus = 'calculating' | 'archived'
export type MetricCategory = 'profit' | 'cashflow'
export type MetricValueType = 'currency' | 'percentage'
export type MetricType = 'base' | 'calculated'
export type PeriodAggregation = 'sum' | 'recompute' | 'ending'
export type VersionStatus = 'working' | 'snapshot'
export type ForecastMethod = 'monthly_input' | 'fixed_monthly'
export type ForecastCategory =
  | 'revenue'
  | 'cost'
  | 'cash_inflow'
  | 'cash_outflow'
export type CalculationRunStatus = 'success' | 'failed'

export const BASELINE_SCENARIO_CODE = 'baseline'
export const WORKING_VERSION_CODE = 'working'
export const REFERENCE_DATASET_ID = 'historical-project-config-v1'

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
  calculationRunId?: string
  createdAt?: string
  updatedAt?: string
}

export interface ForecastLine {
  id: string
  projectId: string
  code: string
  name: string
  category: ForecastCategory
  metricCode: BaseMetricCode
  businessModuleId: string
  forecastMethod: ForecastMethod
  startPeriod: string
  endPeriod: string
  fixedMonthlyValue?: string
  assumption: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ForecastMonthlyValue {
  lineId: string
  period: string
  value: string
}

export interface ForecastLineDraft {
  id?: string
  code?: string
  name: string
  category: ForecastCategory
  businessModuleId: string
  forecastMethod: ForecastMethod
  startPeriod: string
  endPeriod: string
  fixedMonthlyValue?: string
  assumption: string
  sortOrder: number
  monthlyValues: Record<string, string>
}

export interface CompiledLineValue {
  lineId: string
  projectId: string
  departmentId: string
  businessModuleId: string
  period: string
  scenarioId: string
  versionId: string
  metricCode: BaseMetricCode
  value: string
}

export interface CalculationIssue {
  severity: 'error' | 'warning'
  lineId?: string
  field?: string
  period?: string
  message: string
}

export interface CalculationRun {
  id: string
  projectId: string
  scenarioId: string
  versionId: string
  runNumber: number
  status: CalculationRunStatus
  configHash: string
  issueCount: number
  issues: CalculationIssue[]
  startedAt: string
  completedAt: string
}

export interface ForecastProjectState {
  lines: ForecastLine[]
  values: ForecastMonthlyValue[]
  latestRun?: CalculationRun
  isResultCurrent: boolean
}

export interface ForecastLineBreakdown {
  lineId: string
  lineCode: string
  lineName: string
  category: ForecastCategory
  values: Array<{ period: string; value: string }>
  total: string
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
  hasCashFacts: boolean
}
