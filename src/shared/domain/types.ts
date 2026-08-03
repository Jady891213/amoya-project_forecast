export type DataOrigin = 'system' | 'user' | 'demo'
export type DepartmentStatus = 'active' | 'inactive'
export type ProjectStatus = 'calculating' | 'archived'
export type MetricCategory = 'profit' | 'cashflow'
export type MetricValueType = 'currency' | 'percentage'
export type MetricType = 'base' | 'calculated'
export type PeriodAggregation = 'sum' | 'recompute' | 'ending'
export type VersionStatus = 'working' | 'snapshot'
export type ForecastMethod = 'monthly_input' | 'fixed_monthly' | 'formula'
export type ForecastCalculationPreset =
  | 'price_quantity'
  | 'revenue_ratio'
  | 'custom_formula'
export interface ForecastCalculationConfig {
  priceValue?: string
  quantityValue?: string
  ratioValue?: string
  priceParameterCode?: string
  quantityParameterCode?: string
  revenueLineCode?: string
  ratioParameterCode?: string
}
export type TaxAmountBasis =
  | 'tax_exclusive'
  | 'tax_inclusive'
  | 'non_taxable'
export type CashRuleMethod =
  | 'disabled'
  | 'immediate'
  | 'delayed'
  | 'installment'
export type ParameterType = 'fixed' | 'monthly'
export type ParameterValueType =
  | 'currency'
  | 'quantity'
  | 'percentage'
  | 'number'
export type ForecastCategory =
  | 'revenue'
  | 'cost'
  | 'cash_inflow'
  | 'cash_outflow'
export type CalculationRunStatus = 'success' | 'failed'

export const BASELINE_SCENARIO_CODE = 'baseline'
export const WORKING_VERSION_CODE = 'working'
export const REFERENCE_DATASET_ID = 'historical-project-config-v6'

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
  departmentId: string
  startPeriod: string
  endPeriod: string
  status: ProjectStatus
  attributesJson?: string
  draftRevision: number
  createdAt: string
  updatedAt: string
}

export interface ForecastOverride {
  id: string
  projectId: string
  forecastLineId: string
  period: string
  originalValue: string
  overrideValue: string
  reason: string
  updatedAt: string
}

export interface ForecastOverrideDraft {
  id?: string
  forecastLineId: string
  period: string
  originalValue: string
  overrideValue: string
  reason: string
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
  forecastMethod: ForecastMethod
  startPeriod: string
  endPeriod: string
  fixedMonthlyValue?: string
  formulaExpression?: string
  calculationPreset?: ForecastCalculationPreset
  calculationConfig?: ForecastCalculationConfig
  amountBasis: TaxAmountBasis
  taxRate: string
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
  forecastMethod: ForecastMethod
  startPeriod: string
  endPeriod: string
  fixedMonthlyValue?: string
  formulaExpression?: string
  calculationPreset?: ForecastCalculationPreset
  calculationConfig?: ForecastCalculationConfig
  amountBasis?: TaxAmountBasis
  taxRate?: string
  assumption: string
  sortOrder: number
  monthlyValues: Record<string, string>
}

export interface ProjectParameter {
  id: string
  projectId: string
  code: string
  name: string
  parameterType: ParameterType
  valueType: ParameterValueType
  unit: string
  fixedValue?: string
  description: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ProjectParameterValue {
  parameterId: string
  period: string
  value: string
}

export interface ProjectParameterDraft {
  id?: string
  code?: string
  name: string
  parameterType: ParameterType
  valueType: ParameterValueType
  unit: string
  fixedValue?: string
  description: string
  sortOrder: number
  monthlyValues: Record<string, string>
}

export interface ForecastProjectDraft {
  lines: ForecastLineDraft[]
  parameters: ProjectParameterDraft[]
  cashRules?: CashRuleDraft[]
  overrides?: ForecastOverrideDraft[]
}

export interface CashInstallment {
  id: string
  cashRuleId: string
  sequence: number
  offsetMonths: number
  ratio: string
}

export interface CashRule {
  id: string
  projectId: string
  sourceLineId: string
  sourceLineCode: string
  method: CashRuleMethod
  delayMonths: number
  installments: CashInstallment[]
  createdAt: string
  updatedAt: string
}

export interface CashInstallmentDraft {
  id?: string
  sequence: number
  offsetMonths: number
  ratio: string
}

export interface CashRuleDraft {
  id?: string
  sourceLineId?: string
  sourceLineCode: string
  method: CashRuleMethod
  delayMonths: number
  installments: CashInstallmentDraft[]
}

export interface TaxAmountBreakdown {
  rawValue: string
  netValue: string
  taxValue: string
  grossValue: string
}

export interface CompiledLineValue {
  lineId: string
  projectId: string
  departmentId: string
  period: string
  scenarioId: string
  versionId: string
  metricCode: BaseMetricCode
  value: string
  rawValue: string
  netValue: string
  taxValue: string
  grossValue: string
}

export interface CompiledCashScheduleValue {
  sourceLineId: string
  sourceLineCode: string
  sourceLineName: string
  projectId: string
  departmentId: string
  sourcePeriod: string
  settlementPeriod: string
  scenarioId: string
  versionId: string
  metricCode: 'cash_inflow' | 'cash_outflow'
  amountBasis: TaxAmountBasis
  taxRate: string
  netValue: string
  taxValue: string
  grossValue: string
  settlementRatio: string
  value: string
  ruleMethod: CashRuleMethod
}

export interface CalculationIssue {
  severity: 'error' | 'warning'
  lineId?: string
  parameterId?: string
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
  configSnapshotJson: string
  draftRevision: number
  projectSnapshotJson: string
  startedAt: string
  completedAt: string
}

export interface ForecastProjectState {
  lines: ForecastLine[]
  values: ForecastMonthlyValue[]
  parameters: ProjectParameter[]
  parameterValues: ProjectParameterValue[]
  cashRules: CashRule[]
  overrides: ForecastOverride[]
  latestRun?: CalculationRun
  isResultCurrent: boolean
  currentConfigHash: string
}

export interface ForecastLineBreakdown {
  lineId: string
  lineCode: string
  lineName: string
  category: ForecastCategory
  forecastMethod?: ForecastMethod
  sourceSummary?: string
  dependencies?: string[]
  values: Array<{ period: string; value: string }>
  total: string
}

export interface CashScheduleBreakdown {
  sourceLineId: string
  sourceLineCode: string
  sourceLineName: string
  sourcePeriod: string
  settlementPeriod: string
  metricCode: 'cash_inflow' | 'cash_outflow'
  amountBasis: TaxAmountBasis
  taxRate: string
  netValue: string
  taxValue: string
  grossValue: string
  settlementRatio: string
  value: string
  ruleMethod: CashRuleMethod
}

export interface CalculatedFact {
  projectId: string
  period: string
  scenarioId: string
  versionId: string
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
  departmentId: string
  startPeriod: string
  endPeriod: string
}

export interface ProjectWorkspaceDraft {
  project: ProjectInput
  forecast: ForecastProjectDraft
}

export interface ProjectWorkspace {
  project: Project
  draftRevision: number
  forecast: ForecastProjectState
}

export interface SaveProjectWorkspaceRequest {
  expectedRevision: number
  draft: ProjectWorkspaceDraft
}

export interface FieldError {
  section: string
  itemId?: string
  period?: string
  field?: string
  message: string
}

export interface ApiError {
  code: string
  message: string
  fieldErrors?: FieldError[]
  currentRevision?: number
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
}

export interface MonthlyMetricRow {
  period: string
  isRecoveryPeriod: boolean
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
  hasFacts: boolean
  factCount: number
  monthly: MonthlyMetricRow[]
  summary: ReportSummary
  metricDefinitions: MetricDefinition[]
  calculatedFacts: CalculatedFact[]
  hasCashFacts: boolean
  operationEndPeriod: string
  reportEndPeriod: string
}

export interface ProjectReportDto extends ProjectReport {
  calculationRun?: CalculationRun
  availableRuns: CalculationRun[]
  projectSnapshot: Project
  lineBreakdown: ForecastLineBreakdown[]
  cashSchedule: CashScheduleBreakdown[]
  overrides: ForecastOverride[]
  keyAssumptions: Array<{ code: string; name: string; value: string; unit: string }>
  measurementSummary: string[]
  riskNotes: string[]
  isBehindDraft: boolean
}
