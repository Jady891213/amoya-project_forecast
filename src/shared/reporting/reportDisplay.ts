import Decimal from 'decimal.js'
import type {
  ProjectReportDto,
  ReportAnnualResult,
  ReportCompositionItem,
  ReportLineResult,
  ReportUnitEconomics,
} from '../domain/types'

export type ReportTaxBasis = 'tax_exclusive' | 'tax_inclusive'
export type ReportDisplayUnit = 'yuan' | 'wan'

export interface ReportDisplayLine extends ReportLineResult {
  displayTotal: string
  displayMonthly: Array<{ period: string; value: string }>
}

export interface ReportDisplayModel {
  taxBasis: ReportTaxBasis
  basisLabel: '不含税' | '含税'
  summary: {
    revenue: string
    cost: string
    grossProfit: string
    grossMargin: string | null
    roi: string | null
  }
  lineResults: ReportDisplayLine[]
  revenueComposition: ReportCompositionItem[]
  costComposition: ReportCompositionItem[]
  annualResults: ReportAnnualResult[]
  unitEconomics?: ReportUnitEconomics
  conclusionTitle: string
  conclusionDescription: string
}

function decimal(value: Decimal.Value | null | undefined): Decimal {
  try { return new Decimal(value ?? 0) }
  catch { return new Decimal(0) }
}

function factorFor(line: ReportLineResult, taxBasis: ReportTaxBasis): Decimal {
  if (taxBasis === 'tax_exclusive' || line.amountBasis === 'non_taxable') return new Decimal(1)
  return decimal(line.taxRate).plus(1)
}

function composition(lines: ReportDisplayLine[], category: 'revenue' | 'cost', total: Decimal): ReportCompositionItem[] {
  return lines
    .filter((item) => item.category === category)
    .map((item) => ({
      code: item.code,
      name: item.name,
      amount: item.displayTotal,
      share: total.isZero() ? null : decimal(item.displayTotal).div(total).toString(),
      description: item.methodDescription,
    }))
    .sort((left, right) => decimal(right.amount).comparedTo(left.amount))
}

function conclusionTitle(hasFacts: boolean, revenue: Decimal, profit: Decimal, margin: Decimal | null): string {
  if (!hasFacts) return '暂无有效结果'
  if (revenue.lte(0)) return '暂无有效收入'
  if (profit.lt(0)) return '项目处于亏损状态'
  if (margin?.lt(0.05)) return '低利润项目'
  if (margin?.lt(0.1)) return '微利项目'
  if (margin?.gt(0.5)) return '利润表现较好'
  return '利润空间正常'
}

export function buildReportDisplay(
  report: ProjectReportDto,
  taxBasis: ReportTaxBasis,
  displayUnit: ReportDisplayUnit = 'wan',
): ReportDisplayModel {
  const lineResults: ReportDisplayLine[] = report.presentation.lineResults.map((line) => {
    const factor = factorFor(line, taxBasis)
    const displayMonthly = line.monthly.map((item) => ({ period: item.period, value: decimal(item.value).times(factor).toString() }))
    return {
      ...line,
      displayMonthly,
      displayTotal: displayMonthly.reduce((sum, item) => sum.plus(item.value), new Decimal(0)).toString(),
    }
  })
  const revenueLines = lineResults.filter((item) => item.category === 'revenue')
  const costLines = lineResults.filter((item) => item.category === 'cost')
  const revenue = revenueLines.length
    ? revenueLines.reduce((sum, item) => sum.plus(item.displayTotal), new Decimal(0))
    : decimal(report.summary.revenue)
  const cost = costLines.length
    ? costLines.reduce((sum, item) => sum.plus(item.displayTotal), new Decimal(0))
    : decimal(report.summary.cost)
  const profit = revenue.minus(cost)
  const grossMargin = revenue.isZero() ? null : profit.div(revenue)
  const roi = cost.isZero() ? null : profit.div(cost)
  const years = Array.from(new Set(
    report.monthly
      .filter((item) => item.period <= report.operationEndPeriod)
      .map((item) => Number(item.period.slice(0, 4))),
  )).sort((left, right) => left - right)
  const annualResults = years.map((year) => {
    const annualRevenue = revenueLines.reduce((sum, line) => sum.plus(
      line.displayMonthly.filter((item) => Number(item.period.slice(0, 4)) === year).reduce((lineSum, item) => lineSum.plus(item.value), new Decimal(0)),
    ), new Decimal(0))
    const annualCost = costLines.reduce((sum, line) => sum.plus(
      line.displayMonthly.filter((item) => Number(item.period.slice(0, 4)) === year).reduce((lineSum, item) => lineSum.plus(item.value), new Decimal(0)),
    ), new Decimal(0))
    const annualProfit = annualRevenue.minus(annualCost)
    return {
      year,
      revenue: annualRevenue.toString(),
      cost: annualCost.toString(),
      grossProfit: annualProfit.toString(),
      grossMargin: annualRevenue.isZero() ? null : annualProfit.div(annualRevenue).toString(),
    }
  })
  const basis = report.presentation.unitEconomics
  const totalBasis = decimal(basis?.totalBasis)
  const unitEconomics = basis && totalBasis.gt(0) ? {
    ...basis,
    revenuePerUnitPeriod: revenue.div(totalBasis).toString(),
    costPerUnitPeriod: cost.div(totalBasis).toString(),
    profitPerUnitPeriod: profit.div(totalBasis).toString(),
  } : undefined
  const topCost = composition(lineResults, 'cost', cost)[0]
  const basisLabel = taxBasis === 'tax_inclusive' ? '含税' : '不含税'
  const unitLabel = reportUnitLabel(displayUnit)
  const marginText = grossMargin ? `${grossMargin.times(100).toFixed(2)}%` : '—'
  const roiText = roi ? `${roi.times(100).toFixed(2)}%` : '—'
  return {
    taxBasis,
    basisLabel,
    summary: {
      revenue: revenue.toString(),
      cost: cost.toString(),
      grossProfit: profit.toString(),
      grossMargin: grossMargin?.toString() ?? null,
      roi: roi?.toString() ?? null,
    },
    lineResults,
    revenueComposition: composition(lineResults, 'revenue', revenue),
    costComposition: composition(lineResults, 'cost', cost),
    annualResults,
    unitEconomics,
    conclusionTitle: conclusionTitle(report.hasFacts, revenue, profit, grossMargin),
    conclusionDescription: `${report.plan.name}预计实现${basisLabel}收入 ${formatReportAmount(revenue, displayUnit)} ${unitLabel}、成本 ${formatReportAmount(cost, displayUnit)} ${unitLabel}、利润 ${formatReportAmount(profit, displayUnit)} ${unitLabel}，利润率 ${marginText}，ROI ${roiText}。${topCost ? `成本占比最高的是“${topCost.name}”，建议作为成本复核重点。` : ''}`,
  }
}

export function scaleReportAmount(value: Decimal.Value | null | undefined, unit: ReportDisplayUnit): number {
  return unit === 'wan' ? decimal(value).div(10_000).toNumber() : decimal(value).toNumber()
}

export function formatReportAmount(value: Decimal.Value | null | undefined, unit: ReportDisplayUnit): string {
  return scaleReportAmount(value, unit).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function reportUnitLabel(unit: ReportDisplayUnit): '元' | '万元' {
  return unit === 'wan' ? '万元' : '元'
}
