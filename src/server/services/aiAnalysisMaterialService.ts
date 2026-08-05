import Decimal from 'decimal.js'
import { readFileSync } from 'node:fs'
import type { AiAnalysisMaterialStatus, AiAnalysisPreviewDto } from '../../shared/api'
import type {
  ForecastCategory,
  ProjectReportDto,
  ReportCompositionItem,
  ReportLineResult,
  ReportMetricGroup,
  ReportParameterResult,
} from '../../shared/domain/types'
import { ReportWorkbookService } from './reportWorkbookService'

const PROJECT_ALIAS = '项目 A'
const PLAN_ALIAS = '方案 A'
const PROMPT_FILE_NAME = 'ai-analysis-prompt-v1.md'
const PROMPT_VERSION = PROMPT_FILE_NAME.match(/[-_](v\d+)\.md$/)?.[1] ?? 'unknown'
const PROMPT_TEMPLATE = readFileSync(
  new URL(`../../config/prompts/${PROMPT_FILE_NAME}`, import.meta.url),
  'utf8',
).trim()

function dataSourceName(date = new Date()): string {
  const dateText = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')
  return `AI分析脱敏数据_项目A_方案A_${dateText}.xlsx`
}

const CATEGORY_ALIAS: Record<ForecastCategory, { label: string; code: string }> = {
  revenue: { label: '收入项', code: 'REV' },
  cost: { label: '成本项', code: 'COST' },
  cash_inflow: { label: '收款项', code: 'CASH-IN' },
  cash_outflow: { label: '付款项', code: 'CASH-OUT' },
}

function statusOf(report: ProjectReportDto): AiAnalysisMaterialStatus {
  if (!report.calculationState?.lastSuccessAt || !report.hasFacts) return 'not_calculated'
  return report.isBehindDraft ? 'stale' : 'ready'
}

function warningOf(status: AiAnalysisMaterialStatus): string {
  if (status === 'not_calculated') return '当前方案尚未形成成功计算结果，请先完成计算后再下载脱敏数据源。'
  if (status === 'stale') return '当前配置已变更，请重新计算后再下载脱敏数据源。'
  return '身份信息已脱敏，财务数值未脱敏，请仅发送至可信 AI 服务。'
}

function promptFor(report: ProjectReportDto, attachmentName: string): string {
  return PROMPT_TEMPLATE
    .replaceAll('{{ATTACHMENT_NAME}}', attachmentName)
    .replaceAll('{{PROJECT_ALIAS}}', PROJECT_ALIAS)
    .replaceAll('{{PLAN_ALIAS}}', PLAN_ALIAS)
    .replaceAll('{{START_PERIOD}}', report.plan.startPeriod)
    .replaceAll('{{END_PERIOD}}', report.operationEndPeriod)
}

function stableAliasMap<T extends { code: string; category: ForecastCategory }>(items: T[]) {
  const counts = new Map<ForecastCategory, number>()
  const aliases = new Map<string, { code: string; name: string }>()
  items.forEach((item) => {
    const next = (counts.get(item.category) ?? 0) + 1
    counts.set(item.category, next)
    const category = CATEGORY_ALIAS[item.category]
    const suffix = String(next).padStart(2, '0')
    aliases.set(item.code, { code: `${category.code}-${suffix}`, name: `${category.label} ${suffix}` })
  })
  return aliases
}

function replaceKnownIdentities(text: string | undefined, replacements: Map<string, string>): string {
  if (!text) return ''
  return Array.from(replacements.entries())
    .sort(([left], [right]) => right.length - left.length)
    .reduce((result, [source, alias]) => result.replaceAll(source, alias), text)
    .replace(/(?:来源|源表|原表|文件|路径)[^·；。]*/g, '')
    .replace(/\s*·\s*·+/g, ' · ')
    .replace(/^\s*·|·\s*$/g, '')
    .trim()
}

function safeLineDescription(item: ReportLineResult, sourceSummary: string | undefined, replacements: Map<string, string>): string {
  const structured = replaceKnownIdentities(sourceSummary, replacements)
  if (structured) return structured
  const taxRate = new Decimal(item.taxRate || 0).times(100).toFixed(2)
  const amountBasis = item.amountBasis === 'tax_inclusive' ? '含税录入' : item.amountBasis === 'non_taxable' ? '免税' : '未税录入'
  return `${item.method} · ${amountBasis} ${taxRate}%`
}

function composition(items: ReportLineResult[], category: 'revenue' | 'cost', total: string): ReportCompositionItem[] {
  const denominator = new Decimal(total || 0)
  return items
    .filter((item) => item.category === category)
    .map((item) => ({
      code: item.code,
      name: item.name,
      amount: item.netTotal,
      share: denominator.isZero() ? null : new Decimal(item.netTotal || 0).div(denominator).toString(),
      description: item.methodDescription,
    }))
}

function remapMetricGroups(groups: ReportMetricGroup[], lines: ReportLineResult[]): ReportMetricGroup[] {
  return groups.map((group) => ({
    ...group,
    items: lines.filter((line) => line.metricCode === group.metricCode),
    children: remapMetricGroups(group.children, lines),
  }))
}

export class AiAnalysisMaterialService {
  preview(report: ProjectReportDto): AiAnalysisPreviewDto {
    const status = statusOf(report)
    const attachmentName = dataSourceName()
    return {
      promptVersion: PROMPT_VERSION,
      prompt: promptFor(report, attachmentName),
      dataSourceName: attachmentName,
      status,
      redactionSummary: [
        '项目、方案、部门及人员等身份信息已移除或别名化。',
        '参数、收入、成本、收款和付款明细已按类别重新编号。',
        '真实期间、金额、数量、比例和计算关系保持不变。',
        '备注、来源文件、路径和其他自由文本不会进入附件。',
      ],
      warning: warningOf(status),
    }
  }

  createSanitizedReport(report: ProjectReportDto): ProjectReportDto {
    const lineAliases = stableAliasMap(report.presentation.lineResults)
    const parameterAliases = new Map<string, { code: string; name: string }>()
    report.presentation.parameterResults.forEach((item, index) => {
      const suffix = String(index + 1).padStart(2, '0')
      parameterAliases.set(item.code, { code: `PAR-${suffix}`, name: `参数 ${suffix}` })
    })
    const replacements = new Map<string, string>()
    replacements.set(report.project.name, PROJECT_ALIAS)
    if (report.project.code) replacements.set(report.project.code, 'PROJECT-A')
    replacements.set(report.plan.name, PLAN_ALIAS)
    if (report.department?.name) replacements.set(report.department.name, '申报部门')
    report.presentation.lineResults.forEach((item) => {
      const alias = lineAliases.get(item.code)
      if (!alias) return
      replacements.set(item.code, alias.code)
      replacements.set(item.name, alias.name)
    })
    report.presentation.parameterResults.forEach((item) => {
      const alias = parameterAliases.get(item.code)
      if (!alias) return
      replacements.set(item.code, alias.code)
      replacements.set(item.name, alias.name)
    })

    const sourceSummaryByCode = new Map(report.lineBreakdown.map((item) => [item.lineCode, item.sourceSummary]))
    const lineIdAliases = new Map<string, string>()
    const lineResults: ReportLineResult[] = report.presentation.lineResults.map((item) => {
      const alias = lineAliases.get(item.code) ?? { code: item.code, name: item.name }
      const lineId = `ai-${alias.code.toLowerCase()}`
      lineIdAliases.set(item.lineId, lineId)
      return {
        ...item,
        lineId,
        code: alias.code,
        name: alias.name,
        methodDescription: safeLineDescription(item, sourceSummaryByCode.get(item.code), replacements),
      }
    })
    const parameterResults: ReportParameterResult[] = report.presentation.parameterResults.map((item) => {
      const alias = parameterAliases.get(item.code) ?? { code: item.code, name: item.name }
      return {
        ...item,
        code: alias.code,
        name: alias.name,
        description: `${item.inputMode} · ${item.valueType === 'percentage' ? '比例' : item.valueType === 'quantity' ? '数量' : item.valueType === 'currency' ? '金额' : '数值'}`,
      }
    })
    const revenueMetricGroups = remapMetricGroups(report.presentation.revenueMetricGroups, lineResults)
    const costMetricGroups = remapMetricGroups(report.presentation.costMetricGroups, lineResults)
    const topCost = [...costMetricGroups]
      .sort((left, right) => new Decimal(right.amount || 0).comparedTo(left.amount || 0))[0]
    const margin = report.summary.grossMargin === null ? '—' : `${new Decimal(report.summary.grossMargin).times(100).toFixed(2)}%`
    const roi = report.presentation.roi === null ? '—' : `${new Decimal(report.presentation.roi).times(100).toFixed(2)}%`

    return {
      ...report,
      project: {
        ...report.project,
        id: 'project-a',
        code: undefined,
        name: PROJECT_ALIAS,
        departmentId: 'department-redacted',
        attributesJson: undefined,
      },
      department: undefined,
      query: { ...report.query, projectId: 'project-a', planId: 'plan-a' },
      plan: { ...report.plan, projectId: 'project-a', planId: 'plan-a', name: PLAN_ALIAS },
      calculationState: undefined,
      calculatedFacts: report.calculatedFacts.map((item) => ({ ...item, projectId: 'project-a', planId: 'plan-a' })),
      lineBreakdown: report.lineBreakdown.map((item) => {
        const alias = lineAliases.get(item.lineCode) ?? { code: item.lineCode, name: item.lineName }
        return {
          ...item,
          lineId: lineIdAliases.get(item.lineId) ?? `ai-${alias.code.toLowerCase()}`,
          lineCode: alias.code,
          lineName: alias.name,
          sourceSummary: replaceKnownIdentities(item.sourceSummary, replacements),
          dependencies: item.dependencies?.map((dependency) => replacements.get(dependency) ?? dependency),
        }
      }),
      cashSchedule: report.cashSchedule.map((item) => {
        const alias = lineAliases.get(item.sourceLineCode) ?? { code: item.sourceLineCode, name: '收付款项' }
        return {
          ...item,
          sourceLineId: lineIdAliases.get(item.sourceLineId) ?? `ai-${alias.code.toLowerCase()}`,
          sourceLineCode: alias.code,
          sourceLineName: alias.name,
        }
      }),
      adjustments: report.adjustments.map((item) => ({
        ...item,
        id: `ai-adjustment-${item.period}-${lineIdAliases.get(item.forecastLineId) ?? 'line'}`,
        projectId: 'project-a',
        planId: 'plan-a',
        forecastLineId: lineIdAliases.get(item.forecastLineId) ?? 'ai-line',
        reason: '',
      })),
      keyAssumptions: parameterResults.map((item) => ({
        code: item.code,
        name: item.name,
        value: item.inputMode === '全期固定' ? item.monthly[0]?.value ?? '—' : '逐月维护',
        unit: item.unit,
      })),
      measurementSummary: [
        `${PLAN_ALIAS}经营期为 ${report.plan.startPeriod} 至 ${report.operationEndPeriod}。`,
        '损益使用不含税口径，金额单位为万元。',
      ],
      riskNotes: report.riskNotes.map((item) => replaceKnownIdentities(item, replacements)),
      presentation: {
        ...report.presentation,
        lineResults,
        parameterResults,
        revenueComposition: composition(lineResults, 'revenue', report.summary.revenue),
        costComposition: composition(lineResults, 'cost', report.summary.cost),
        revenueMetricGroups,
        costMetricGroups,
        unitEconomics: report.presentation.unitEconomics ? {
          ...report.presentation.unitEconomics,
          basisName: parameterAliases.get(
            report.presentation.parameterResults.find((item) => item.name === report.presentation.unitEconomics?.basisName)?.code ?? '',
          )?.name ?? '数量参数',
        } : undefined,
        conclusionTitle: '脱敏测算结果概览',
        conclusionDescription: `${PLAN_ALIAS}的利润率为 ${margin}，ROI 为 ${roi}。${topCost ? `成本占比最高的是${topCost.name}，建议重点复核。` : ''}`,
      },
    }
  }

  async buildWorkbook(report: ProjectReportDto): Promise<Buffer> {
    const preview = this.preview(report)
    if (preview.status !== 'ready') {
      throw Object.assign(new Error(preview.warning), { code: 'INVALID_REQUEST' })
    }
    return new ReportWorkbookService().build(this.createSanitizedReport(report), {
      aiMaterial: true,
      creator: 'AI 分析素材',
      company: '',
      note: '说明：身份信息已脱敏，财务数值未脱敏，请仅发送至可信 AI 服务。',
    })
  }
}
