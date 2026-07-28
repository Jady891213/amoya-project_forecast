import Decimal from 'decimal.js'
import { generatePeriods } from '../domain/periods'
import type {
  CalculationIssue,
  CompiledLineValue,
  ForecastLine,
  ForecastMonthlyValue,
  Project,
  ProjectModule,
} from '../domain/types'

export interface ForecastCompilation {
  values: CompiledLineValue[]
  issues: CalculationIssue[]
}

function decimalValue(
  rawValue: string,
  lineId: string,
  field: string,
  period: string | undefined,
  issues: CalculationIssue[],
): Decimal | undefined {
  try {
    const value = new Decimal(rawValue)
    if (!value.isFinite()) throw new Error('not finite')
    if (value.isNegative()) {
      issues.push({
        severity: 'warning',
        lineId,
        field,
        period,
        message: '金额为负数，将按冲销或调整项参与计算',
      })
    }
    return value
  } catch {
    issues.push({
      severity: 'error',
      lineId,
      field,
      period,
      message: '金额不是有效数字',
    })
    return undefined
  }
}

export function buildForecastConfigHash(
  lines: ForecastLine[],
  monthlyValues: ForecastMonthlyValue[],
): string {
  const payload = JSON.stringify({
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
): ForecastCompilation {
  const issues: CalculationIssue[] = []
  const values: CompiledLineValue[] = []
  const projectPeriods = generatePeriods(
    project.startPeriod,
    project.durationMonths,
  )
  const periodSet = new Set(projectPeriods)
  const moduleIds = new Set(modules.map((module) => module.id))
  const valuesByLine = new Map<string, Map<string, string>>()
  monthlyValues.forEach((value) => {
    const lineValues = valuesByLine.get(value.lineId) ?? new Map<string, string>()
    lineValues.set(value.period, value.value)
    valuesByLine.set(value.lineId, lineValues)
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
    const activePeriods = projectPeriods.slice(startIndex, endIndex + 1)
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
        line.id,
        'fixedMonthlyValue',
        undefined,
        issues,
      )
      if (!amount) return
      activePeriods.forEach((period) => {
        values.push({
          lineId: line.id,
          projectId: project.id,
          departmentId: project.departmentId,
          businessModuleId: line.businessModuleId,
          period,
          scenarioId: 'baseline',
          versionId: 'working',
          metricCode: line.metricCode,
          value: amount.toDecimalPlaces(6).toString(),
        })
      })
      return
    }

    const lineValues = valuesByLine.get(line.id) ?? new Map<string, string>()
    const missingPeriods: string[] = []
    activePeriods.forEach((period) => {
      const rawValue = lineValues.get(period)?.trim() ?? ''
      if (!rawValue) {
        missingPeriods.push(period)
        values.push({
          lineId: line.id,
          projectId: project.id,
          departmentId: project.departmentId,
          businessModuleId: line.businessModuleId,
          period,
          scenarioId: 'baseline',
          versionId: 'working',
          metricCode: line.metricCode,
          value: '0',
        })
        return
      }
      const amount = decimalValue(
        rawValue,
        line.id,
        'monthlyValues',
        period,
        issues,
      )
      if (!amount) return
      values.push({
        lineId: line.id,
        projectId: project.id,
        departmentId: project.departmentId,
        businessModuleId: line.businessModuleId,
        period,
        scenarioId: 'baseline',
        versionId: 'working',
        metricCode: line.metricCode,
        value: amount.toDecimalPlaces(6).toString(),
      })
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

  return { values, issues }
}
