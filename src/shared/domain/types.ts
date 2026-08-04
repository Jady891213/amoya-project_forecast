export type DataOrigin = 'system' | 'user' | 'demo'
export type DepartmentStatus = 'active' | 'inactive'
export type ProjectStatus = 'calculating' | 'archived'
export type MetricCategory = 'profit' | 'cashflow'
export type MetricValueType = 'currency' | 'percentage'
export type MetricType = 'base' | 'calculated'
export type PeriodAggregation = 'sum' | 'recompute' | 'ending'
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
  | 'manual_monthly'
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
export type CalculationStatus = 'success' | 'failed'

export const BASELINE_SCENARIO_CODE = 'baseline'
export const DEFAULT_PLAN_NAME = '方案 1'
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
  status: ProjectStatus
  /** 排序第一的有效方案期间，仅用于项目列表等汇总视图；不存放在 dim_project。 */
  startPeriod: string
  endPeriod: string
  draftRevision: number
  planCount?: number
  attributesJson?: string
  createdAt: string
  updatedAt: string
}

export interface ProjectCalculationContext extends Project {
  startPeriod: string
  endPeriod: string
}

export interface FactAdjustment {
  id: string
  projectId: string
  planId: string
  forecastLineId: string
  period: string
  metricCode: BaseMetricCode
  adjustedValue: string
  reason: string
  createdAt: string
  updatedAt: string
}

export interface FactAdjustmentDraft {
  id?: string
  forecastLineId: string
  period: string
  metricCode: BaseMetricCode
  adjustedValue: string
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

export interface ProjectPlan {
  projectId: string
  planId: string
  name: string
  startPeriod: string
  endPeriod: string
  status: 'active' | 'archived'
  sortOrder: number
  draftRevision: number
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
  planId: string
  metricCode: BaseMetricCode
  value: string
  sourceLabel: string
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
  monthlyValues: Record<string, string>
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
  monthlyValues: Record<string, string>
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
  planId: string
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
  planId: string
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

export interface PlanCalculationState {
  projectId: string
  planId: string
  lastStatus: CalculationStatus
  lastAttemptAt: string
  lastSuccessAt?: string
  lastSuccessConfigHash?: string
  calculatedDraftRevision: number
  resultRevision: number
  issues: CalculationIssue[]
}

export interface ForecastProjectState {
  lines: ForecastLine[]
  values: ForecastMonthlyValue[]
  parameters: ProjectParameter[]
  parameterValues: ProjectParameterValue[]
  cashRules: CashRule[]
  calculationState?: PlanCalculationState
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
  planId: string
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
  /** 新建项目时用于创建首个方案；工作区保存时以 draft.plan 为准。 */
  startPeriod: string
  endPeriod: string
}

export interface CreateProjectInput extends ProjectInput {
  startPeriod: string
  endPeriod: string
}

export interface ProjectPlanInput {
  name: string
  startPeriod: string
  endPeriod: string
}

export interface ProjectWorkspaceDraft {
  project: ProjectInput
  plan: ProjectPlanInput
  forecast: ForecastProjectDraft
}

export interface ProjectWorkspace {
  project: Project
  projectPlans: ProjectPlan[]
  currentPlan: ProjectPlan
  draftRevision: number
  forecast: ForecastProjectState
}

export interface SaveProjectWorkspaceRequest {
  planId: string
  expectedRevision: number
  clearInvalidAdjustments?: boolean
  draft: ProjectWorkspaceDraft
}

export interface CreateProjectPlanRequest {
  name: string
  startPeriod: string
  endPeriod: string
  copyFromPlanId?: string
}

export type PivotDimension = 'project' | 'plan' | 'department' | 'period' | 'metric'

export interface PivotAxisDimension {
  dimension: PivotDimension
  memberIds: string[]
}

export interface PivotPovDimension {
  dimension: PivotDimension
  memberId: string
}

export interface PivotRequest {
  rows: PivotAxisDimension[]
  columns: PivotAxisDimension[]
  pov: PivotPovDimension[]
  scenarioId: 'baseline'
}

export interface PivotMember {
  id: string
  label: string
  parentId?: string
  sortKey: number
  status?: string
}

export interface PivotDimensionMetadata {
  dimension: PivotDimension
  label: string
  members: PivotMember[]
}

export interface PivotMetadata {
  dimensions: PivotDimensionMetadata[]
  scenario: { id: 'baseline'; label: string }
}

export interface PivotTupleMember {
  dimension: PivotDimension
  memberId: string
  label: string
  parentId?: string
}

export interface PivotTuple {
  key: string
  members: PivotTupleMember[]
}

export interface PivotCell {
  rowKey: string
  columnKey: string
  value: string | null
  valueType: MetricValueType
}

export interface PivotResponse {
  rowTuples: PivotTuple[]
  columnTuples: PivotTuple[]
  cells: PivotCell[]
  sourceFactCount: number
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
  planId: string
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
  plan: ProjectPlan
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
  calculationState?: PlanCalculationState
  lineBreakdown: ForecastLineBreakdown[]
  cashSchedule: CashScheduleBreakdown[]
  adjustments: FactAdjustment[]
  keyAssumptions: Array<{ code: string; name: string; value: string; unit: string }>
  measurementSummary: string[]
  riskNotes: string[]
  isBehindDraft: boolean
  presentation: ProjectReportPresentation
}

export interface ReportLineResult {
  lineId: string
  code: string
  name: string
  category: ForecastCategory
  method: string
  methodDescription: string
  amountBasis: TaxAmountBasis
  taxRate: string
  priceOrRatio?: string
  quantity?: string
  months?: number
  grossTotal: string
  netTotal: string
  monthly: Array<{ period: string; value: string }>
}

export interface ReportParameterResult {
  code: string
  name: string
  unit: string
  valueType: ParameterValueType
  inputMode: string
  description: string
  monthly: Array<{ period: string; value: string | null }>
  total: string | null
}

export interface ReportCompositionItem {
  code: string
  name: string
  amount: string
  share: string | null
  description: string
}

export interface ReportAnnualResult {
  year: number
  revenue: string
  cost: string
  grossProfit: string
  grossMargin: string | null
}

export interface ReportUnitEconomics {
  basisName: string
  basisUnit: string
  totalBasis: string
  revenuePerUnitPeriod: string
  costPerUnitPeriod: string
  profitPerUnitPeriod: string
}

export interface ProjectReportPresentation {
  roi: string | null
  lineResults: ReportLineResult[]
  parameterResults: ReportParameterResult[]
  revenueComposition: ReportCompositionItem[]
  costComposition: ReportCompositionItem[]
  annualResults: ReportAnnualResult[]
  unitEconomics?: ReportUnitEconomics
  conclusionTitle: string
  conclusionDescription: string
  generatedAt: string
}
