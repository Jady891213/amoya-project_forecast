import Decimal from 'decimal.js'
import { generatePeriods } from '../domain/periods'
import type {
  CalculationIssue,
  CompiledLineValue,
  ForecastLine,
  ForecastMonthlyValue,
  Project,
  ProjectModule,
  ProjectParameter,
  ProjectParameterValue,
} from '../domain/types'
import { resolveFormulaDependencies } from './formulaDependencyGraph'
import {
  evaluateFormula,
  parseFormula,
  type FormulaReference,
} from './formulaEngine'

export interface ForecastCompilation {
  values: CompiledLineValue[]
  issues: CalculationIssue[]
}

function decimalValue(
  rawValue: string,
  issue: Omit<CalculationIssue, 'severity' | 'message'>,
  issues: CalculationIssue[],
): Decimal | undefined {
  try {
    const value = new Decimal(rawValue)
    if (!value.isFinite()) throw new Error('not finite')
    if (value.isNegative()) {
      issues.push({
        severity: 'warning',
        ...issue,
        message: '金额为负数，将按冲销或调整项参与计算',
      })
    }
    return value
  } catch {
    issues.push({
      severity: 'error',
      ...issue,
      message: '数值不是有效数字',
    })
    return undefined
  }
}

export function buildForecastConfigHash(
  lines: ForecastLine[],
  monthlyValues: ForecastMonthlyValue[],
  parameters: ProjectParameter[] = [],
  parameterValues: ProjectParameterValue[] = [],
): string {
  const payload = JSON.stringify({
    parameters: [...parameters]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
      .map((parameter) => ({
        id: parameter.id,
        code: parameter.code,
        name: parameter.name,
        parameterType: parameter.parameterType,
        valueType: parameter.valueType,
        unit: parameter.unit,
        fixedValue: parameter.fixedValue ?? '',
        description: parameter.description,
        sortOrder: parameter.sortOrder,
      })),
    parameterValues: [...parameterValues]
      .sort((a, b) =>
        `${a.parameterId}:${a.period}`.localeCompare(
          `${b.parameterId}:${b.period}`,
        ),
      )
      .map((value) => [value.parameterId, value.period, value.value]),
    lines: [...lines]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
      .map((line) => ({
        id: line.id,
        code: line.code,
        name: line.name,
        category: line.category,
        businessModuleId: line.businessModuleId,
        forecastMethod: line.forecastMethod,
        startPeriod: line.startPeriod,
        endPeriod: line.endPeriod,
        fixedMonthlyValue: line.fixedMonthlyValue ?? '',
        formulaExpression: line.formulaExpression ?? '',
        assumption: line.assumption,
        sortOrder: line.sortOrder,
      })),
    values: [...monthlyValues]
      .sort((a, b) =>
        `${a.lineId}:${a.period}`.localeCompare(`${b.lineId}:${b.period}`),
      )
      .map((value) => [value.lineId, value.period, value.value]),
  })
  let hash = 2166136261
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function compileForecast(
  project: Project,
  modules: ProjectModule[],
  lines: ForecastLine[],
  monthlyValues: ForecastMonthlyValue[],
  parameters: ProjectParameter[] = [],
  parameterValues: ProjectParameterValue[] = [],
): ForecastCompilation {
  const issues: CalculationIssue[] = []
  const values: CompiledLineValue[] = []
  const projectPeriods = generatePeriods(
    project.startPeriod,
    project.durationMonths,
  )
  const periodSet = new Set(projectPeriods)
  const moduleIds = new Set(modules.map((module) => module.id))
  const lineByCode = new Map(lines.map((line) => [line.code, line]))
  const parameterByCode = new Map(
    parameters.map((parameter) => [parameter.code, parameter]),
  )
  const valuesByLine = new Map<string, Map<string, string>>()
  const parameterValuesById = new Map<string, Map<string, string>>()
  const compiledByLine = new Map<string, Map<string, Decimal>>()

  monthlyValues.forEach((value) => {
    const lineValues = valuesByLine.get(value.lineId) ?? new Map<string, string>()
    lineValues.set(value.period, value.value)
    valuesByLine.set(value.lineId, lineValues)
  })
  parameterValues.forEach((value) => {
    const valuesForParameter =
      parameterValuesById.get(value.parameterId) ?? new Map<string, string>()
    valuesForParameter.set(value.period, value.value)
    parameterValuesById.set(value.parameterId, valuesForParameter)
  })

  if (project.status !== 'calculating') {
    issues.push({
      severity: 'error',
      message: '已归档项目不能执行预测计算',
    })
  }
  if (lines.length === 0) {
    issues.push({
      severity: 'error',
      message: '至少需要一个收入、成本或现金流行项目',
    })
  }

  const activePeriodsByLine = new Map<string, string[]>()
  lines.forEach((line) => {
    if (!line.name.trim()) {
      issues.push({
        severity: 'error',
        lineId: line.id,
        field: 'name',
        message: '行项目名称不能为空',
      })
    }
    if (!moduleIds.has(line.businessModuleId)) {
      issues.push({
        severity: 'error',
        lineId: line.id,
        field: 'businessModuleId',
        message: '业务模块不属于当前项目',
      })
    }
    if (!periodSet.has(line.startPeriod) || !periodSet.has(line.endPeriod)) {
      issues.push({
        severity: 'error',
        lineId: line.id,
        field: 'period',
        message: '生效期间必须位于项目预测周期内',
      })
      return
    }
    const startIndex = projectPeriods.indexOf(line.startPeriod)
    const endIndex = projectPeriods.indexOf(line.endPeriod)
    if (startIndex > endIndex) {
      issues.push({
        severity: 'error',
        lineId: line.id,
        field: 'period',
        message: '结束期间不能早于开始期间',
      })
      return
    }
    activePeriodsByLine.set(
      line.id,
      projectPeriods.slice(startIndex, endIndex + 1),
    )
  })

  function appendValue(line: ForecastLine, period: string, amount: Decimal) {
    const normalized = amount.toDecimalPlaces(6)
    const lineValues = compiledByLine.get(line.id) ?? new Map<string, Decimal>()
    lineValues.set(period, normalized)
    compiledByLine.set(line.id, lineValues)
    values.push({
      lineId: line.id,
      projectId: project.id,
      departmentId: project.departmentId,
      businessModuleId: line.businessModuleId,
      period,
      scenarioId: 'baseline',
      versionId: 'working',
      metricCode: line.metricCode,
      value: normalized.toString(),
    })
  }

  lines
    .filter((line) => line.forecastMethod !== 'formula')
    .forEach((line) => {
      const activePeriods = activePeriodsByLine.get(line.id)
      if (!activePeriods) return
      if (line.forecastMethod === 'fixed_monthly') {
        if (!line.fixedMonthlyValue?.trim()) {
          issues.push({
            severity: 'error',
            lineId: line.id,
            field: 'fixedMonthlyValue',
            message: '固定月金额不能为空',
          })
          return
        }
        const amount = decimalValue(
          line.fixedMonthlyValue,
          { lineId: line.id, field: 'fixedMonthlyValue' },
          issues,
        )
        if (!amount) return
        activePeriods.forEach((period) => appendValue(line, period, amount))
        return
      }

      const lineValues = valuesByLine.get(line.id) ?? new Map<string, string>()
      const missingPeriods: string[] = []
      activePeriods.forEach((period) => {
        const rawValue = lineValues.get(period)?.trim() ?? ''
        if (!rawValue) {
          missingPeriods.push(period)
          appendValue(line, period, new Decimal(0))
          return
        }
        const amount = decimalValue(
          rawValue,
          { lineId: line.id, field: 'monthlyValues', period },
          issues,
        )
        if (amount) appendValue(line, period, amount)
      })
      if (missingPeriods.length > 0) {
        issues.push({
          severity: 'warning',
          lineId: line.id,
          field: 'monthlyValues',
          message: `${missingPeriods.length}个月未填写，已按0计算`,
        })
      }
    })

  const graph = resolveFormulaDependencies(lines)
  graph.errors.forEach((message, lineId) => {
    issues.push({
      severity: 'error',
      lineId,
      field: 'formulaExpression',
      message,
    })
  })

  graph.orderedLines.forEach((line) => {
    const activePeriods = activePeriodsByLine.get(line.id)
    if (!activePeriods) return
    let parsed: ReturnType<typeof parseFormula>
    try {
      parsed = parseFormula(line.formulaExpression ?? '')
    } catch (reason) {
      issues.push({
        severity: 'error',
        lineId: line.id,
        field: 'formulaExpression',
        message: reason instanceof Error ? reason.message : '公式格式错误',
      })
      return
    }
    activePeriods.forEach((period) => {
      const referenceErrors: string[] = []
      const resolve = (reference: FormulaReference): Decimal | undefined => {
        if (reference.type === 'parameter') {
          const parameter = parameterByCode.get(reference.code)
          if (!parameter) {
            referenceErrors.push(`引用的参数“${reference.code}”不存在`)
            return undefined
          }
          const rawValue =
            parameter.parameterType === 'fixed'
              ? parameter.fixedValue
              : parameterValuesById.get(parameter.id)?.get(period)
          if (rawValue === undefined || rawValue.trim() === '') {
            referenceErrors.push(
              `参数“${parameter.name}”在 ${period} 没有可用值`,
            )
            return undefined
          }
          try {
            const value = new Decimal(rawValue)
            if (!value.isFinite()) throw new Error('not finite')
            return value
          } catch {
            referenceErrors.push(`参数“${parameter.name}”的数值格式错误`)
            return undefined
          }
        }
        const sourceLine = lineByCode.get(reference.code)
        if (!sourceLine) {
          referenceErrors.push(`引用的行项目“${reference.code}”不存在`)
          return undefined
        }
        const sourcePeriods = activePeriodsByLine.get(sourceLine.id) ?? []
        if (!sourcePeriods.includes(period)) return new Decimal(0)
        const value = compiledByLine.get(sourceLine.id)?.get(period)
        if (!value) {
          referenceErrors.push(
            `上游行项目“${sourceLine.name}”在 ${period} 没有可用结果`,
          )
        }
        return value
      }
      try {
        const amount = evaluateFormula(parsed, resolve)
        if (referenceErrors.length > 0) throw new Error(referenceErrors[0])
        appendValue(line, period, amount)
      } catch (reason) {
        issues.push({
          severity: 'error',
          lineId: line.id,
          field: 'formulaExpression',
          period,
          message:
            referenceErrors[0] ??
            (reason instanceof Error ? reason.message : '公式计算失败'),
        })
      }
    })
  })

  return { values, issues }
}
