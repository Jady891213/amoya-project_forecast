import Decimal from 'decimal.js'
import type {
  FactAdjustment,
  ForecastLine,
  ForecastLineBreakdown,
  ProjectParameter,
  ProjectParameterValue,
  ProjectReport,
  ProjectReportPresentation,
  ReportCompositionItem,
  ReportLineResult,
  ReportParameterResult,
} from '../../shared/domain/types'
import { countPeriods, generatePeriodRange } from '../../app/domain/periods'

function decimal(value: Decimal.Value | null | undefined): Decimal {
  try { return new Decimal(value ?? 0) }
  catch { return new Decimal(0) }
}

function ratio(value: Decimal, total: Decimal): string | null {
  return total.isZero() ? null : value.div(total).toString()
}

function methodLabel(line: ForecastLine): string {
  if (line.calculationPreset === 'price_quantity') return '单价 × 数量'
  if (line.calculationPreset === 'revenue_ratio') return '按收入比例'
  if (line.forecastMethod === 'fixed_monthly') return '固定月金额'
  if (line.forecastMethod === 'monthly_input') return '逐月填写'
  return '自定义公式'
}

function resolveConfigNumber(
  literal: string | undefined,
  parameterCode: string | undefined,
  parameters: Map<string, ProjectParameter>,
): string | undefined {
  if (literal?.trim()) return literal.trim()
  const parameter = parameterCode ? parameters.get(parameterCode) : undefined
  return parameter?.fixedValue
}

function lineDescription(line: ForecastLine, breakdown?: ForecastLineBreakdown): string {
  const parts = [breakdown?.sourceSummary, line.assumption].filter(Boolean)
  return parts.join(' · ') || methodLabel(line)
}

function buildLineResults(
  report: ProjectReport,
  lines: ForecastLine[],
  breakdown: ForecastLineBreakdown[],
  parameters: ProjectParameter[],
  adjustments: FactAdjustment[],
): ReportLineResult[] {
  const lineById = new Map(lines.map((item) => [item.id, item]))
  const parameterByCode = new Map(parameters.map((item) => [item.code, item]))
  const adjustmentByCell = new Map(
    adjustments.map((item) => [`${item.forecastLineId}:${item.period}`, item.adjustedValue]),
  )
  return breakdown.map((item) => {
    const line = lineById.get(item.lineId)
    const rawByPeriod = new Map(item.values.map((value) => [value.period, value.value]))
    const monthly = report.monthly.map(({ period }) => ({
      period,
      value: adjustmentByCell.get(`${item.lineId}:${period}`) ?? rawByPeriod.get(period) ?? '0',
    }))
    const netTotal = monthly.reduce((sum, value) => sum.plus(value.value), new Decimal(0))
    const amountBasis = line?.amountBasis ?? 'non_taxable'
    const taxRate = line?.taxRate ?? '0'
    const grossTotal = amountBasis === 'non_taxable'
      ? netTotal
      : netTotal.times(decimal(taxRate).plus(1))
    const config = line?.calculationConfig
    const preset = line?.calculationPreset
    const priceOrRatio = preset === 'price_quantity'
      ? resolveConfigNumber(config?.priceValue, config?.priceParameterCode, parameterByCode)
      : preset === 'revenue_ratio'
        ? resolveConfigNumber(config?.ratioValue, config?.ratioParameterCode, parameterByCode)
        : undefined
    const quantity = preset === 'price_quantity'
      ? resolveConfigNumber(config?.quantityValue, config?.quantityParameterCode, parameterByCode)
      : undefined
    return {
      lineId: item.lineId,
      code: item.lineCode,
      name: item.lineName,
      category: item.category,
      method: line ? methodLabel(line) : item.forecastMethod === 'monthly_input' ? '逐月填写' : '固定月金额',
      methodDescription: line ? lineDescription(line, item) : item.sourceSummary ?? '',
      amountBasis,
      taxRate,
      priceOrRatio,
      quantity,
      months: line ? countPeriods(line.startPeriod, line.endPeriod) : undefined,
      grossTotal: grossTotal.toString(),
      netTotal: netTotal.toString(),
      monthly,
    }
  })
}

function buildParameterResults(
  report: ProjectReport,
  parameters: ProjectParameter[],
  parameterValues: ProjectParameterValue[],
): ReportParameterResult[] {
  const operationPeriods = generatePeriodRange(report.plan.startPeriod, report.operationEndPeriod)
  const valuesByParameter = new Map<string, Map<string, string>>()
  parameterValues.forEach((item) => {
    const values = valuesByParameter.get(item.parameterId) ?? new Map<string, string>()
    values.set(item.period, item.value)
    valuesByParameter.set(item.parameterId, values)
  })
  return parameters.map((parameter) => {
    const savedValues = valuesByParameter.get(parameter.id) ?? new Map<string, string>()
    const monthly = operationPeriods.map((period) => ({
      period,
      value: parameter.parameterType === 'fixed'
        ? parameter.fixedValue ?? null
        : savedValues.get(period) ?? null,
    }))
    const total = parameter.valueType === 'percentage'
      ? null
      : monthly.reduce((sum, item) => sum.plus(item.value ?? 0), new Decimal(0)).toString()
    return {
      code: parameter.code,
      name: parameter.name,
      unit: parameter.unit,
      valueType: parameter.valueType,
      inputMode: parameter.parameterType === 'fixed' ? '全期固定' : '逐月填写',
      description: parameter.description,
      monthly,
      total,
    }
  })
}

function buildComposition(
  lines: ReportLineResult[],
  category: 'revenue' | 'cost',
  total: Decimal,
): ReportCompositionItem[] {
  return lines
    .filter((item) => item.category === category)
    .map((item) => ({
      code: item.code,
      name: item.name,
      amount: item.netTotal,
      share: ratio(decimal(item.netTotal), total),
      description: item.methodDescription,
    }))
    .sort((a, b) => decimal(b.amount).comparedTo(decimal(a.amount)))
}

export function buildProjectReportPresentation(input: {
  report: ProjectReport
  lines: ForecastLine[]
  breakdown: ForecastLineBreakdown[]
  parameters: ProjectParameter[]
  parameterValues: ProjectParameterValue[]
  adjustments: FactAdjustment[]
}): ProjectReportPresentation {
  const { report, lines, breakdown, parameters, parameterValues, adjustments } = input
  const lineResults = buildLineResults(report, lines, breakdown, parameters, adjustments)
  const parameterResults = buildParameterResults(report, parameters, parameterValues)
  const revenue = decimal(report.summary.revenue)
  const cost = decimal(report.summary.cost)
  const profit = decimal(report.summary.grossProfit)
  const roi = cost.isZero() ? null : profit.div(cost).toString()
  const byYear = new Map<number, { revenue: Decimal; cost: Decimal }>()
  report.monthly
    .filter((item) => item.period <= report.operationEndPeriod)
    .forEach((item) => {
      const year = Number(item.period.slice(0, 4))
      const values = byYear.get(year) ?? { revenue: new Decimal(0), cost: new Decimal(0) }
      values.revenue = values.revenue.plus(item.revenue)
      values.cost = values.cost.plus(item.cost)
      byYear.set(year, values)
    })
  const annualResults = Array.from(byYear.entries()).sort(([a], [b]) => a - b).map(([year, value]) => {
    const grossProfit = value.revenue.minus(value.cost)
    return {
      year,
      revenue: value.revenue.toString(),
      cost: value.cost.toString(),
      grossProfit: grossProfit.toString(),
      grossMargin: value.revenue.isZero() ? null : grossProfit.div(value.revenue).toString(),
    }
  })
  const userBasis = parameterResults.find((item) =>
    item.valueType === 'quantity' && /(用户|人数|订购|注册|客户数)/.test(item.name),
  )
  const totalBasis = userBasis?.total ? decimal(userBasis.total) : new Decimal(0)
  const unitEconomics = userBasis && totalBasis.gt(0) ? {
    basisName: userBasis.name,
    basisUnit: userBasis.unit,
    totalBasis: totalBasis.toString(),
    revenuePerUnitPeriod: revenue.div(totalBasis).toString(),
    costPerUnitPeriod: cost.div(totalBasis).toString(),
    profitPerUnitPeriod: profit.div(totalBasis).toString(),
  } : undefined
  const grossMargin = report.summary.grossMargin === null ? null : decimal(report.summary.grossMargin)
  let conclusionTitle = '利润空间正常'
  if (!report.hasFacts) conclusionTitle = '暂无有效结果'
  else if (revenue.lte(0)) conclusionTitle = '暂无有效收入'
  else if (profit.lt(0)) conclusionTitle = '项目处于亏损状态'
  else if (grossMargin?.lt(0.05)) conclusionTitle = '低利润项目'
  else if (grossMargin?.lt(0.1)) conclusionTitle = '微利项目'
  else if (grossMargin?.gt(0.5)) conclusionTitle = '利润表现较好'
  const topCost = buildComposition(lineResults, 'cost', cost)[0]
  const marginText = grossMargin ? `${grossMargin.times(100).toFixed(2)}%` : '—'
  const roiText = roi ? `${decimal(roi).times(100).toFixed(2)}%` : '—'
  const conclusionDescription = `${report.plan.name}预计实现不含税收入 ${revenue.div(10_000).toFixed(2)} 万元、成本 ${cost.div(10_000).toFixed(2)} 万元、利润 ${profit.div(10_000).toFixed(2)} 万元，利润率 ${marginText}，ROI ${roiText}。${topCost ? `成本占比最高的是“${topCost.name}”，建议作为成本复核重点。` : ''}`
  return {
    roi,
    lineResults,
    parameterResults,
    revenueComposition: buildComposition(lineResults, 'revenue', revenue),
    costComposition: buildComposition(lineResults, 'cost', cost),
    annualResults,
    unitEconomics,
    conclusionTitle,
    conclusionDescription,
    generatedAt: new Date().toISOString(),
  }
}
