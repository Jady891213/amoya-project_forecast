import Decimal from 'decimal.js'
import type {
  CashRule,
  ForecastLine,
  ForecastProjectDraft,
  Project,
  ProjectParameter,
} from '../domain/types'
import { compileCashSchedule } from './cashScheduleCompiler'
import { compileForecast } from './forecastCompiler'

export function previewForecastDraft(project: Project, draft: ForecastProjectDraft) {
  const now = new Date(0).toISOString()
  const lines: ForecastLine[] = draft.lines.map((line, index) => ({
    id: line.id ?? line.code ?? `preview-line-${index + 1}`,
    projectId: project.id,
    code: line.code ?? `LINE-${String(index + 1).padStart(3, '0')}`,
    name: line.name,
    category: line.category,
    metricCode: line.category,
    forecastMethod: line.forecastMethod,
    startPeriod: line.startPeriod,
    endPeriod: line.endPeriod,
    fixedMonthlyValue: line.fixedMonthlyValue,
    formulaExpression: line.formulaExpression,
    calculationPreset: line.calculationPreset,
    calculationConfig: line.calculationConfig,
    amountBasis: line.amountBasis ?? 'tax_exclusive',
    taxRate: line.taxRate ?? '0',
    assumption: line.assumption,
    sortOrder: line.sortOrder,
    createdAt: now,
    updatedAt: now,
  }))
  const parameters: ProjectParameter[] = draft.parameters.map((parameter, index) => ({
    id: parameter.id ?? parameter.code ?? `preview-parameter-${index + 1}`,
    projectId: project.id,
    code: parameter.code ?? `PAR-${String(index + 1).padStart(3, '0')}`,
    name: parameter.name,
    parameterType: parameter.parameterType,
    valueType: parameter.valueType,
    unit: parameter.unit,
    fixedValue: parameter.parameterType === 'fixed' && parameter.fixedValue?.trim()
      ? parameter.valueType === 'percentage'
        ? new Decimal(parameter.fixedValue).div(100).toString()
        : parameter.fixedValue
      : undefined,
    description: parameter.description,
    sortOrder: parameter.sortOrder,
    createdAt: now,
    updatedAt: now,
  }))
  const values = draft.lines.flatMap((line, index) =>
    Object.entries(line.monthlyValues)
      .filter(([, value]) => value.trim())
      .map(([period, value]) => ({
        lineId: line.id ?? line.code ?? `preview-line-${index + 1}`,
        period,
        value,
      })),
  )
  const parameterValues = draft.parameters.flatMap((parameter, index) =>
    Object.entries(parameter.monthlyValues)
      .filter(([, value]) => value.trim())
      .map(([period, value]) => ({
        parameterId: parameter.id ?? parameter.code ?? `preview-parameter-${index + 1}`,
        period,
        value: parameter.valueType === 'percentage'
          ? new Decimal(value).div(100).toString()
          : value,
      })),
  )
  const compilation = compileForecast(
    project,
    lines,
    values,
    parameters,
    parameterValues,
    (draft.overrides ?? []).map((item) => ({
      id: item.id ?? `${item.forecastLineId}:${item.period}`,
      projectId: project.id,
      forecastLineId: item.forecastLineId,
      period: item.period,
      originalValue: item.originalValue,
      overrideValue: item.overrideValue,
      reason: item.reason,
      updatedAt: now,
    })),
  )
  const lineByCode = new Map(lines.map((line) => [line.code, line]))
  const cashRules: CashRule[] = (draft.cashRules ?? []).flatMap((rule, index) => {
    const sourceLine = lineByCode.get(rule.sourceLineCode)
    if (!sourceLine) return []
    const ruleId = rule.id ?? `preview-cash-rule-${index + 1}`
    return [{
      id: ruleId,
      projectId: project.id,
      sourceLineId: sourceLine.id,
      sourceLineCode: sourceLine.code,
      method: rule.method,
      delayMonths: rule.delayMonths,
      installments: rule.installments.map((item, itemIndex) => ({
        id: item.id ?? `preview-installment-${index + 1}-${itemIndex + 1}`,
        cashRuleId: ruleId,
        sequence: itemIndex + 1,
        offsetMonths: item.offsetMonths,
        ratio: item.ratio,
      })),
      createdAt: now,
      updatedAt: now,
    }]
  })
  const cashCompilation = compileCashSchedule(lines, compilation.values, cashRules)
  return {
    values: compilation.values,
    cashValues: cashCompilation.values,
    issues: [...compilation.issues, ...cashCompilation.issues],
  }
}
