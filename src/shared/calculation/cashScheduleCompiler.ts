import Decimal from 'decimal.js'
import { addMonths } from '../domain/periods'
import type {
  CalculationIssue,
  CashRule,
  CompiledCashScheduleValue,
  CompiledLineValue,
  ForecastLine,
} from '../domain/types'

export interface CashScheduleCompilation {
  values: CompiledCashScheduleValue[]
  issues: CalculationIssue[]
}

interface ScheduleItem {
  offsetMonths: number
  ratio: Decimal
}

function scheduleForRule(
  rule: CashRule,
  issues: CalculationIssue[],
): ScheduleItem[] {
  if (rule.method === 'disabled') return []
  if (rule.method === 'immediate') {
    return [{ offsetMonths: 0, ratio: new Decimal(1) }]
  }
  if (rule.method === 'delayed') {
    if (
      !Number.isInteger(rule.delayMonths) ||
      rule.delayMonths < 0 ||
      rule.delayMonths > 36
    ) {
      issues.push({
        severity: 'error',
        lineId: rule.sourceLineId,
        field: 'delayMonths',
        message: '延后月份必须是0～36之间的整数',
      })
      return []
    }
    return [{ offsetMonths: rule.delayMonths, ratio: new Decimal(1) }]
  }
  if (rule.installments.length === 0 || rule.installments.length > 12) {
    issues.push({
      severity: 'error',
      lineId: rule.sourceLineId,
      field: 'installments',
      message: '分期规则必须包含1～12期',
    })
    return []
  }
  const offsets = new Set<number>()
  const schedule: ScheduleItem[] = []
  for (const installment of [...rule.installments].sort(
    (a, b) => a.sequence - b.sequence,
  )) {
    if (
      !Number.isInteger(installment.offsetMonths) ||
      installment.offsetMonths < 0 ||
      installment.offsetMonths > 36
    ) {
      issues.push({
        severity: 'error',
        lineId: rule.sourceLineId,
        field: 'installments',
        message: '分期偏移月份必须是0～36之间的整数',
      })
      return []
    }
    if (offsets.has(installment.offsetMonths)) {
      issues.push({
        severity: 'error',
        lineId: rule.sourceLineId,
        field: 'installments',
        message: '同一分期规则不能出现重复的偏移月份',
      })
      return []
    }
    offsets.add(installment.offsetMonths)
    try {
      const ratio = new Decimal(installment.ratio)
      if (!ratio.isFinite() || ratio.lessThanOrEqualTo(0)) {
        throw new Error('invalid ratio')
      }
      schedule.push({ offsetMonths: installment.offsetMonths, ratio })
    } catch {
      issues.push({
        severity: 'error',
        lineId: rule.sourceLineId,
        field: 'installments',
        message: '分期比例必须是有效的正数',
      })
      return []
    }
  }
  const total = schedule.reduce(
    (sum, item) => sum.plus(item.ratio),
    new Decimal(0),
  )
  if (!total.equals(1)) {
    issues.push({
      severity: 'error',
      lineId: rule.sourceLineId,
      field: 'installments',
      message: '分期比例合计必须等于100%',
    })
    return []
  }
  return schedule
}

export function compileCashSchedule(
  lines: ForecastLine[],
  lineValues: CompiledLineValue[],
  cashRules: CashRule[],
): CashScheduleCompilation {
  const issues: CalculationIssue[] = []
  const values: CompiledCashScheduleValue[] = []
  const lineById = new Map(lines.map((line) => [line.id, line]))
  const ruleByLineId = new Map(cashRules.map((rule) => [rule.sourceLineId, rule]))

  for (const [sourceLineId, rule] of ruleByLineId.entries()) {
    const line = lineById.get(sourceLineId)
    if (!line) {
      issues.push({
        severity: 'error',
        lineId: sourceLineId,
        field: 'cashRule',
        message: '收付款规则引用的损益行不存在',
      })
      continue
    }
    if (line.category !== 'revenue' && line.category !== 'cost') {
      issues.push({
        severity: 'error',
        lineId: line.id,
        field: 'cashRule',
        message: '只有收入或成本行可以配置自动收付款规则',
      })
      continue
    }
    const sourceValues = lineValues.filter((value) => value.lineId === line.id)
    if (rule.method === 'manual_monthly') {
      const coordinates = sourceValues[0]
      const monthlyValues = Object.entries(rule.monthlyValues)
      if (!coordinates || monthlyValues.length === 0) {
        issues.push({
          severity: 'error',
          lineId: line.id,
          field: 'monthlyValues',
          message: '逐月指定收付款至少需要填写一个期间',
        })
        continue
      }
      let manualTotal = new Decimal(0)
      let invalid = false
      const valueStartIndex = values.length
      for (const [period, raw] of monthlyValues.sort(([left], [right]) => left.localeCompare(right))) {
        let amount: Decimal
        try {
          amount = new Decimal(raw)
          if (!amount.isFinite()) throw new Error('invalid')
        } catch {
          issues.push({ severity: 'error', lineId: line.id, field: 'monthlyValues', period, message: '逐月指定收付款金额必须是有效数字' })
          invalid = true
          break
        }
        manualTotal = manualTotal.plus(amount)
        const source = sourceValues.find((item) => item.period === period)
        values.push({
          sourceLineId: line.id,
          sourceLineCode: line.code,
          sourceLineName: line.name,
          projectId: coordinates.projectId,
          departmentId: coordinates.departmentId,
          sourcePeriod: period,
          settlementPeriod: period,
          scenarioId: coordinates.scenarioId,
          versionId: coordinates.versionId,
          metricCode: line.category === 'revenue' ? 'cash_inflow' : 'cash_outflow',
          amountBasis: line.amountBasis,
          taxRate: line.taxRate,
          netValue: source?.netValue ?? '0',
          taxValue: source?.taxValue ?? '0',
          grossValue: source?.grossValue ?? '0',
          settlementRatio: '0',
          value: amount.toDecimalPlaces(6).toString(),
          ruleMethod: rule.method,
        })
      }
      if (invalid) {
        values.splice(valueStartIndex)
        continue
      }
      const grossTotal = sourceValues.reduce((sum, source) => sum.plus(source.grossValue), new Decimal(0))
      if (!manualTotal.toDecimalPlaces(6).equals(grossTotal.toDecimalPlaces(6))) {
        issues.push({
          severity: 'warning',
          lineId: line.id,
          field: 'monthlyValues',
          message: `${line.category === 'revenue' ? '计划收款' : '计划付款'}与含税结算额存在差额`,
        })
      }
      continue
    }
    const schedule = scheduleForRule(rule, issues)
    if (schedule.length === 0) continue
    sourceValues.forEach((source) => {
      const gross = new Decimal(source.grossValue)
      let allocated = new Decimal(0)
      schedule.forEach((item, index) => {
        const isLast = index === schedule.length - 1
        const amount = isLast
          ? gross.minus(allocated).toDecimalPlaces(6)
          : gross.times(item.ratio).toDecimalPlaces(6)
        allocated = allocated.plus(amount)
        values.push({
          sourceLineId: line.id,
          sourceLineCode: line.code,
          sourceLineName: line.name,
          projectId: source.projectId,
          departmentId: source.departmentId,
          sourcePeriod: source.period,
          settlementPeriod: addMonths(source.period, item.offsetMonths),
          scenarioId: source.scenarioId,
          versionId: source.versionId,
          metricCode:
            line.category === 'revenue' ? 'cash_inflow' : 'cash_outflow',
          amountBasis: line.amountBasis,
          taxRate: line.taxRate,
          netValue: source.netValue,
          taxValue: source.taxValue,
          grossValue: source.grossValue,
          settlementRatio: item.ratio.toString(),
          value: amount.toString(),
          ruleMethod: rule.method,
        })
      })
    })
  }
  return { values, issues }
}
