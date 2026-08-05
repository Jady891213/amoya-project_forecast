import Decimal from 'decimal.js'
import { generatePeriods } from '../domain/periods'
import type {
  BaseFact,
  CalculatedFact,
  MetricDefinition,
  MonthlyMetricRow,
  ProjectCalculationContext,
  ReportSummary,
} from '../domain/types'
import { descendantProfitLeafCodes } from '../../config/profitMetricHierarchy'

interface MetricEngineResult {
  monthly: MonthlyMetricRow[]
  summary: ReportSummary
  calculatedFacts: CalculatedFact[]
  operationEndPeriod: string
  reportEndPeriod: string
}

const ZERO = new Decimal(0)

function sumMetric(
  facts: BaseFact[],
  period: string,
  metricCode: BaseFact['metricCode'],
): Decimal {
  return facts
    .filter(
      (fact) => fact.period === period && fact.metricCode === metricCode,
    )
    .reduce((sum, fact) => sum.plus(fact.value), ZERO)
}

function sumProfitMetric(facts: BaseFact[], period: string, metricCode: 'revenue' | 'cost'): Decimal {
  const leafCodes = new Set(descendantProfitLeafCodes(metricCode))
  return facts
    .filter((fact) => fact.period === period && (leafCodes.has(fact.metricCode as never) || String(fact.metricCode) === metricCode))
    .reduce((sum, fact) => sum.plus(fact.value), ZERO)
}

function value(decimal: Decimal): string {
  return decimal.toDecimalPlaces(6).toString()
}

function calculatedFact(
  project: ProjectCalculationContext,
  period: string,
  metric: MetricDefinition,
  metricValue: Decimal | null,
  scenarioId: string,
  planId: string,
): CalculatedFact {
  return {
    projectId: project.id,
    period,
    scenarioId,
    planId,
    metricCode: metric.code as CalculatedFact['metricCode'],
    value: metricValue === null ? null : value(metricValue),
    source: 'calculated',
    expression: metric.expression ?? '',
    dependencies: metric.dependencies,
  }
}

export function calculateMetrics(
  project: ProjectCalculationContext,
  facts: BaseFact[],
  metricDefinitions: MetricDefinition[],
): MetricEngineResult {
  const scenarioId = facts[0]?.scenarioId ?? 'baseline'
  const planId = facts[0]?.planId ?? 'plan-default'
  const operationEndPeriod = project.endPeriod
  const reportEndPeriod = [
    operationEndPeriod,
    ...facts.map((fact) => fact.period),
  ].sort().at(-1) ?? operationEndPeriod
  const [startYear, startMonth] = project.startPeriod.split('-').map(Number)
  const [endYear, endMonth] = reportEndPeriod.split('-').map(Number)
  const reportDuration =
    (endYear - startYear) * 12 + (endMonth - startMonth) + 1
  const periods = generatePeriods(project.startPeriod, reportDuration)
  let cumulativeCashFlow = ZERO
  const calculatedDefinitions = new Map(
    metricDefinitions
      .filter((metric) => metric.metricType === 'calculated')
      .map((metric) => [metric.code, metric]),
  )
  const calculatedFacts: CalculatedFact[] = []

  const monthly = periods.map((period) => {
    const revenue = sumProfitMetric(facts, period, 'revenue')
    const cost = sumProfitMetric(facts, period, 'cost')
    const grossProfit = revenue.minus(cost)
    const grossMargin = revenue.isZero()
      ? null
      : grossProfit.dividedBy(revenue)
    const cashInflow = sumMetric(facts, period, 'cash_inflow')
    const cashOutflow = sumMetric(facts, period, 'cash_outflow')
    const netCashFlow = cashInflow.minus(cashOutflow)
    cumulativeCashFlow = cumulativeCashFlow.plus(netCashFlow)

    const calculated: Array<
      [CalculatedFact['metricCode'], Decimal | null]
    > = [
      ['gross_profit', grossProfit],
      ['gross_margin', grossMargin],
      ['net_cash_flow', netCashFlow],
      ['cumulative_cash_flow', cumulativeCashFlow],
    ]

    calculated.forEach(([metricCode, metricValue]) => {
      const definition = calculatedDefinitions.get(metricCode)
      if (definition) {
        calculatedFacts.push(
          calculatedFact(
            project,
            period,
            definition,
            metricValue,
            scenarioId,
            planId,
          ),
        )
      }
    })

    return {
      period,
      isRecoveryPeriod: period > operationEndPeriod,
      revenue: value(revenue),
      cost: value(cost),
      grossProfit: value(grossProfit),
      grossMargin: grossMargin === null ? null : value(grossMargin),
      cashInflow: value(cashInflow),
      cashOutflow: value(cashOutflow),
      netCashFlow: value(netCashFlow),
      cumulativeCashFlow: value(cumulativeCashFlow),
    }
  })

  const totalRevenue = monthly.reduce(
    (sum, row) => sum.plus(row.revenue),
    ZERO,
  )
  const totalCost = monthly.reduce((sum, row) => sum.plus(row.cost), ZERO)
  const totalGrossProfit = totalRevenue.minus(totalCost)
  const totalGrossMargin = totalRevenue.isZero()
    ? null
    : totalGrossProfit.dividedBy(totalRevenue)
  const totalCashInflow = monthly.reduce(
    (sum, row) => sum.plus(row.cashInflow),
    ZERO,
  )
  const totalCashOutflow = monthly.reduce(
    (sum, row) => sum.plus(row.cashOutflow),
    ZERO,
  )
  const totalNetCashFlow = totalCashInflow.minus(totalCashOutflow)
  const endingCashFlow =
    monthly.length > 0
      ? new Decimal(monthly[monthly.length - 1].cumulativeCashFlow)
      : ZERO

  const cumulativeValues = monthly.map(
    (row) => new Decimal(row.cumulativeCashFlow),
  )
  const minimumCumulative =
    cumulativeValues.length > 0
      ? Decimal.min(...cumulativeValues)
      : ZERO
  const maximumFunding = minimumCumulative.isNegative()
    ? minimumCumulative.abs()
    : ZERO

  const firstNegativeIndex = cumulativeValues.findIndex((item) =>
    item.isNegative(),
  )
  let cashPositiveLabel = '无需垫资'
  if (firstNegativeIndex >= 0) {
    const positiveIndex = cumulativeValues.findIndex(
      (item, index) => index > firstNegativeIndex && item.greaterThanOrEqualTo(0),
    )
    cashPositiveLabel =
      positiveIndex >= 0 ? periods[positiveIndex] : '预测期内未转正'
  }

  return {
    monthly,
    summary: {
      revenue: value(totalRevenue),
      cost: value(totalCost),
      grossProfit: value(totalGrossProfit),
      grossMargin:
        totalGrossMargin === null ? null : value(totalGrossMargin),
      cashInflow: value(totalCashInflow),
      cashOutflow: value(totalCashOutflow),
      netCashFlow: value(totalNetCashFlow),
      cumulativeCashFlow: value(endingCashFlow),
      maximumFunding: value(maximumFunding),
      cashPositiveLabel,
    },
    calculatedFacts,
    operationEndPeriod,
    reportEndPeriod,
  }
}
