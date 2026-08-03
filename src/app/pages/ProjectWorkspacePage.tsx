import Decimal from 'decimal.js'
import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  Calculator,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileChartColumn,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Save,
  Settings,
  TableProperties,
  Trash2,
  X,
} from 'lucide-react'
import type {
  CashRuleDraft,
  ForecastCategory,
  ForecastLineDraft,
  ForecastOverrideDraft,
  ProjectInput,
  ProjectParameterDraft,
  ProjectReportDto,
  ProjectWorkspace,
} from '../../shared/domain/types'
import type { AppSnapshot } from '../state/types'
import { ApiClient } from '../api/client'
import { countPeriods, generatePeriodRange, generatePeriods } from '../domain/periods'
import { FinancialGrid, type FinancialGridChange, type FinancialGridRow } from '../components/FinancialGrid'
import { PageBreadcrumbs } from '../components/PageBreadcrumbs'
import { formatPercent, formatWan } from '../ui/formatters'
import { useAppDialog } from '../ui/AppDialog'
import {
  ForecastSchemeFields,
  forecastScheme,
  forecastSchemeLabel,
  patchForForecastScheme,
  type ForecastScheme,
} from '../ui/ForecastSchemeFields'
import { previewForecastDraft } from '../../shared/calculation/previewForecastDraft'

const ReportCharts = lazy(async () => {
  const module = await import('../components/ReportCharts')
  return { default: module.ReportCharts }
})

type WorkspaceView = 'config' | 'calculation' | 'report'
interface Props {
  api: ApiClient
  snapshot: AppSnapshot
  projectId: string
  view: WorkspaceView
  onNavigate: (path: string) => void
  onRefresh: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}

export function validateProjectDraft(input: ProjectInput): string | undefined {
  if (!input.name.trim()) return '项目名称不能为空'
  if (!input.departmentId.trim()) return '申报部门不能为空'
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.startPeriod)) return '开始期间格式不正确'
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.endPeriod)) return '结束期间格式不正确'
  if (input.endPeriod < input.startPeriod) return '结束期间不能早于开始期间'
  return undefined
}

function stateToLineDrafts(workspace: ProjectWorkspace): ForecastLineDraft[] {
  const values = new Map<string, Record<string, string>>()
  workspace.forecast.values.forEach((item) => {
    const row = values.get(item.lineId) ?? {}
    row[item.period] = item.value
    values.set(item.lineId, row)
  })
  return workspace.forecast.lines.map((line) => ({
    id: line.id,
    code: line.code,
    name: line.name,
    category: line.category,
    forecastMethod: line.forecastMethod,
    startPeriod: line.startPeriod,
    endPeriod: line.endPeriod,
    fixedMonthlyValue: line.fixedMonthlyValue ?? '',
    formulaExpression: line.formulaExpression ?? '',
    calculationPreset: line.calculationPreset,
    calculationConfig: line.calculationConfig,
    amountBasis: line.amountBasis,
    taxRate: new Decimal(line.taxRate || 0).times(100).toString(),
    assumption: line.assumption,
    sortOrder: line.sortOrder,
    monthlyValues: values.get(line.id) ?? {},
  }))
}

function stateToParameterDrafts(workspace: ProjectWorkspace): ProjectParameterDraft[] {
  const values = new Map<string, Record<string, string>>()
  workspace.forecast.parameterValues.forEach((item) => {
    const row = values.get(item.parameterId) ?? {}
    const parameter = workspace.forecast.parameters.find((candidate) => candidate.id === item.parameterId)
    row[item.period] = parameter?.valueType === 'percentage'
      ? new Decimal(item.value).times(100).toString()
      : item.value
    values.set(item.parameterId, row)
  })
  return workspace.forecast.parameters.map((parameter) => ({
    id: parameter.id,
    code: parameter.code,
    name: parameter.name,
    parameterType: parameter.parameterType,
    valueType: parameter.valueType,
    unit: parameter.unit,
    fixedValue: parameter.valueType === 'percentage' && parameter.fixedValue
      ? new Decimal(parameter.fixedValue).times(100).toString()
      : parameter.fixedValue ?? '',
    description: parameter.description,
    sortOrder: parameter.sortOrder,
    monthlyValues: values.get(parameter.id) ?? {},
  }))
}

function stateToCashRules(workspace: ProjectWorkspace): CashRuleDraft[] {
  return workspace.forecast.cashRules.map((rule) => ({
    id: rule.id,
    sourceLineId: rule.sourceLineId,
    sourceLineCode: rule.sourceLineCode,
    method: rule.method,
    delayMonths: rule.delayMonths,
    installments: rule.installments.map((item) => ({
      id: item.id,
      sequence: item.sequence,
      offsetMonths: item.offsetMonths,
      ratio: new Decimal(item.ratio).times(100).toString(),
    })),
  }))
}

function nextCode(prefix: 'LINE' | 'PAR', codes: Array<string | undefined>) {
  const used = new Set(codes.filter(Boolean))
  let sequence = 1
  while (used.has(`${prefix}-${String(sequence).padStart(3, '0')}`)) sequence += 1
  return `${prefix}-${String(sequence).padStart(3, '0')}`
}

function formulaSummary(expression: string | undefined, parameters: ProjectParameterDraft[], lines: ForecastLineDraft[]) {
  if (!expression) return '未配置'
  const parameterNames = new Map(parameters.map((item) => [item.code, item.name]))
  const lineNames = new Map(lines.map((item) => [item.code, item.name]))
  return expression
    .replace(/PARAM\("([^"]+)"\)/g, (_, code: string) => parameterNames.get(code) ?? code)
    .replace(/LINE\("([^"]+)"\)/g, (_, code: string) => lineNames.get(code) ?? code)
    .replace(/\*/g, ' × ')
    .replace(/\//g, ' ÷ ')
    .replace(/\s+/g, ' ')
    .trim()
}

function lineGridValues(line: ForecastLineDraft, periods: string[]) {
  if (line.forecastMethod === 'monthly_input') return line.monthlyValues
  if (line.forecastMethod === 'fixed_monthly') {
    return Object.fromEntries(periods.map((period) => [period, period >= line.startPeriod && period <= line.endPeriod ? line.fixedMonthlyValue ?? '' : '']))
  }
  return {}
}

export function ProjectWorkspacePage({ api, snapshot, projectId, view, onNavigate, onRefresh, onDirtyChange }: Props) {
  const dialog = useAppDialog()
  const [workspace, setWorkspace] = useState<ProjectWorkspace>()
  const [projectDraft, setProjectDraft] = useState<ProjectInput>()
  const [lines, setLines] = useState<ForecastLineDraft[]>([])
  const [parameters, setParameters] = useState<ProjectParameterDraft[]>([])
  const [cashRules, setCashRules] = useState<CashRuleDraft[]>([])
  const [overrides, setOverrides] = useState<ForecastOverrideDraft[]>([])
  const [selectedLineId, setSelectedLineId] = useState('')
  const [selectedParameterId, setSelectedParameterId] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [report, setReport] = useState<ProjectReportDto>()
  const [reportRunId, setReportRunId] = useState('')
  const [editingProjectHeader, setEditingProjectHeader] = useState(false)
  const [createMenu, setCreateMenu] = useState<'profit' | 'cash' | ''>('')
  const [debouncedFormulaExpressions, setDebouncedFormulaExpressions] = useState<Record<string, string>>({})

  const markDirty = useCallback(() => {
    setDirty(true)
    onDirtyChange(true)
  }, [onDirtyChange])

  const hydrate = useCallback((next: ProjectWorkspace) => {
    setWorkspace(next)
    setProjectDraft({
      id: next.project.id,
      code: next.project.code,
      name: next.project.name,
      departmentId: next.project.departmentId,
      startPeriod: next.project.startPeriod,
      endPeriod: next.project.endPeriod,
    })
    const nextLines = stateToLineDrafts(next)
    const nextParameters = stateToParameterDrafts(next)
    setLines(nextLines)
    setParameters(nextParameters)
    setCashRules(stateToCashRules(next))
    setOverrides(next.forecast.overrides.map((item) => ({
      id: item.id,
      forecastLineId: item.forecastLineId,
      period: item.period,
      originalValue: item.originalValue,
      overrideValue: item.overrideValue,
      reason: item.reason,
    })))
    setSelectedLineId((current) => current && nextLines.some((line) => line.id === current) ? current : '')
    setSelectedParameterId((current) => current && nextParameters.some((item) => item.id === current) ? current : '')
    setDirty(false)
    onDirtyChange(false)
  }, [onDirtyChange])

  useEffect(() => {
    let cancelled = false
    setWorkspace(undefined)
    void api.getWorkspace(projectId).then((result) => {
      if (!cancelled) hydrate(result)
    }).catch((reason) => {
      if (!cancelled) setMessage(reason instanceof Error ? reason.message : '项目加载失败')
    })
    return () => { cancelled = true }
  }, [api, hydrate, projectId])

  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    void api.report(projectId, view === 'report' && reportRunId ? reportRunId : undefined).then((result) => {
      if (!cancelled) setReport(result)
    }).catch((reason) => {
      if (!cancelled) setMessage(reason instanceof Error ? reason.message : '结果加载失败')
    })
    return () => { cancelled = true }
  }, [api, projectId, reportRunId, view, workspace])

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const projectPeriods = useMemo(() => projectDraft ? generatePeriodRange(projectDraft.startPeriod, projectDraft.endPeriod) : [], [projectDraft])
  const cashPeriods = useMemo(() => projectDraft ? generatePeriods(projectDraft.startPeriod, countPeriods(projectDraft.startPeriod, projectDraft.endPeriod) + 36) : [], [projectDraft])
  const selectedLine = lines.find((line) => line.id === selectedLineId)
  const selectedParameter = parameters.find((item) => item.id === selectedParameterId)

  const formulaExpressionKey = useMemo(
    () => JSON.stringify(lines.filter((line) => line.forecastMethod === 'formula').map((line) => [line.id, line.formulaExpression])),
    [lines],
  )
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedFormulaExpressions(Object.fromEntries(
        lines.filter((line) => line.forecastMethod === 'formula').map((line) => [line.id ?? line.code ?? line.name, line.formulaExpression ?? '']),
      ))
    }, 150)
    return () => window.clearTimeout(timer)
  }, [formulaExpressionKey, lines])

  function normalizedForecast(forecastLines = lines) {
    return {
      lines: forecastLines.map((line) => ({
        ...line,
        taxRate: line.category === 'revenue' || line.category === 'cost'
          ? new Decimal(line.taxRate || 0).div(100).toString()
          : '0',
      })),
      parameters,
      cashRules: cashRules.map((rule) => ({
        ...rule,
        installments: rule.installments.map((item) => ({ ...item, ratio: new Decimal(item.ratio || 0).div(100).toString() })),
      })),
      overrides,
    }
  }

  const livePreview = useMemo(() => {
    if (!workspace || !projectDraft) return { values: [], cashValues: [], issues: [] }
    try {
      return previewForecastDraft(
        { ...workspace.project, ...projectDraft },
        normalizedForecast(lines.map((line) => line.forecastMethod === 'formula'
          ? { ...line, formulaExpression: debouncedFormulaExpressions[line.id ?? line.code ?? line.name] ?? line.formulaExpression }
          : line)),
      )
    } catch (reason) {
      return {
        values: [],
        cashValues: [],
        issues: [{
          severity: 'error' as const,
          message: reason instanceof Error ? reason.message : '当前配置无法预览',
        }],
      }
    }
  }, [cashRules, debouncedFormulaExpressions, lines, overrides, parameters, projectDraft, workspace])

  async function save(manageBusy = true) {
    if (!workspace || !projectDraft) throw new Error('项目尚未加载')
    const validationMessage = validateProjectDraft(projectDraft)
    if (validationMessage) {
      setMessage(validationMessage)
      throw new Error(validationMessage)
    }
    if (manageBusy) setBusy(true)
    setMessage('')
    try {
      const saved = await api.saveWorkspace(projectId, {
        expectedRevision: workspace.draftRevision,
        draft: { project: projectDraft, forecast: normalizedForecast() },
      })
      hydrate(saved)
      await onRefresh()
      setMessage('整个项目草稿已保存')
      return saved
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '保存失败')
      throw reason
    } finally { if (manageBusy) setBusy(false) }
  }

  async function saveFromToolbar() {
    try { await save() }
    catch { /* 错误已由 save 显示在工作区消息中。 */ }
  }

  async function calculate() {
    if (!workspace) return
    setBusy(true); setMessage('')
    try {
      const saved = dirty ? await save(false) : workspace
      const result = await api.calculate(projectId, saved.draftRevision)
      if (!result.success) {
        setMessage(`计算失败：${result.issues.map((item) => item.message).slice(0, 3).join('；')}`)
        return
      }
      const refreshed = await api.getWorkspace(projectId)
      hydrate(refreshed)
      setReport(await api.report(projectId))
      setMessage(`计算完成：RUN-${String(result.run.runNumber).padStart(4, '0')}`)
      onNavigate(`/projects/${projectId}/calculation`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '计算失败')
    } finally { setBusy(false) }
  }

  function patchLine(id: string, patch: Partial<ForecastLineDraft>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line)); markDirty()
  }

  function patchParameter(id: string, patch: Partial<ProjectParameterDraft>) {
    setParameters((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)); markDirty()
  }

  function addParameter() {
    const id = `draft-${crypto.randomUUID()}`
    const parameter: ProjectParameterDraft = {
      id,
      code: nextCode('PAR', parameters.map((item) => item.code)),
      name: '新增业务参数',
      parameterType: 'fixed',
      valueType: 'number',
      unit: '',
      fixedValue: '',
      description: '',
      sortOrder: parameters.length + 1,
      monthlyValues: {},
    }
    setParameters((current) => [...current, parameter])
    setSelectedLineId('')
    setSelectedParameterId(id)
    markDirty()
  }

  function duplicateParameter(parameterId = selectedParameterId) {
    const source = parameters.find((item) => item.id === parameterId)
    if (!source) return
    const id = `draft-${crypto.randomUUID()}`
    const copy: ProjectParameterDraft = {
      ...source,
      id,
      code: nextCode('PAR', parameters.map((item) => item.code)),
      name: `${source.name} 副本`,
      sortOrder: parameters.length + 1,
      monthlyValues: { ...source.monthlyValues },
    }
    setParameters((current) => [...current, copy])
    setSelectedLineId('')
    setSelectedParameterId(id)
    markDirty()
  }

  async function removeParameter(parameterId = selectedParameterId) {
    const target = parameters.find((item) => item.id === parameterId)
    if (!target) return
    const references = lines.filter((line) => line.formulaExpression?.includes(`"${target.code}"`))
    if (references.length > 0) {
      await dialog.alert(`参数“${target.name}”正在被 ${references.length} 个行项目引用。请先调整相关公式，再删除该参数。`, {
        title: '参数暂时无法删除',
        tone: 'warning',
      })
      return
    }
    if (!await dialog.confirm({
      title: '删除业务参数？',
      message: `确定删除“${target.name}”？保存后该参数及其逐月数据将被移除。`,
      tone: 'danger',
      confirmLabel: '删除参数',
    })) return
    setParameters((current) => current.filter((item) => item.id !== target.id))
    if (selectedParameterId === target.id) setSelectedParameterId('')
    markDirty()
  }

  function updateParameterMonthly(changes: FinancialGridChange[]) {
    if (!selectedParameter) return
    const values = { ...selectedParameter.monthlyValues }
    changes.forEach((change) => { if (change.value) values[change.period] = change.value; else delete values[change.period] })
    patchParameter(selectedParameter.id ?? '', { monthlyValues: values })
  }

  function addLine(category: ForecastCategory) {
    if (!workspace || projectPeriods.length === 0) return
    const id = `draft-${crypto.randomUUID()}`
    const periods = category === 'cash_inflow' || category === 'cash_outflow' ? cashPeriods : projectPeriods
    const line: ForecastLineDraft = {
      id,
      code: nextCode('LINE', lines.map((item) => item.code)),
      name: category === 'revenue' ? '新增收入项' : category === 'cost' ? '新增成本项' : category === 'cash_inflow' ? '新增收款项' : '新增付款项',
      category,
      forecastMethod: 'fixed_monthly',
      startPeriod: periods[0], endPeriod: periods[periods.length - 1],
      fixedMonthlyValue: '', formulaExpression: '',
      amountBasis: category === 'revenue' || category === 'cost' ? 'tax_exclusive' : 'non_taxable',
      taxRate: '0', assumption: '', sortOrder: lines.length + 1, monthlyValues: {},
    }
    setLines((current) => [...current, line])
    if (category === 'revenue' || category === 'cost') {
      setCashRules((current) => [...current, { sourceLineId: id, sourceLineCode: line.code ?? '', method: 'immediate', delayMonths: 0, installments: [] }])
    }
    setSelectedParameterId('')
    setSelectedLineId(id); markDirty()
  }

  function duplicateLine(lineId = selectedLineId) {
    const source = lines.find((item) => item.id === lineId)
    if (!source) return
    const id = `draft-${crypto.randomUUID()}`
    const code = nextCode('LINE', lines.map((item) => item.code))
    const copy = { ...source, id, code, name: `${source.name} 副本`, sortOrder: lines.length + 1, monthlyValues: { ...source.monthlyValues } }
    setLines((current) => [...current, copy])
    const rule = cashRules.find((item) => item.sourceLineCode === source.code)
    if (rule) setCashRules((current) => [...current, { ...rule, id: undefined, sourceLineId: id, sourceLineCode: code, installments: rule.installments.map((item) => ({ ...item, id: undefined })) }])
    setSelectedParameterId('')
    setSelectedLineId(id); markDirty()
  }

  async function removeLine(lineId = selectedLineId) {
    const target = lines.find((item) => item.id === lineId)
    if (!target || !await dialog.confirm({
      title: '删除预测项？',
      message: `确定删除“${target.name}”？关联的收付款规则和人工覆盖也会一并移除。`,
      tone: 'danger',
      confirmLabel: '删除预测项',
    })) return
    setLines((current) => current.filter((item) => item.id !== target.id))
    setCashRules((current) => current.filter((item) => item.sourceLineCode !== target.code))
    setOverrides((current) => current.filter((item) => item.forecastLineId !== target.id))
    if (selectedLineId === target.id) setSelectedLineId('')
    markDirty()
  }

  function updateMonthly(changes: FinancialGridChange[]) {
    if (!selectedLine) return
    const values = { ...selectedLine.monthlyValues }
    changes.forEach((change) => { if (change.value) values[change.period] = change.value; else delete values[change.period] })
    patchLine(selectedLine.id ?? '', { monthlyValues: values })
  }

  function editCalculation(changes: FinancialGridChange[]) {
    if (!report) return
    const breakdown = new Map(report.lineBreakdown.map((item) => [item.lineId, item]))
    const next = [...overrides]
    let hasChange = false
    changes.forEach((change) => {
      const index = next.findIndex((item) => item.forecastLineId === change.rowId && item.period === change.period)
      const original = breakdown.get(change.rowId)?.values.find((item) => item.period === change.period)?.value ?? '0'
      if (!change.value || new Decimal(change.value || 0).equals(original)) {
        if (index >= 0) { next.splice(index, 1); hasChange = true }
      } else if (index >= 0) {
        if (!new Decimal(next[index].overrideValue).equals(change.value)) {
          next[index] = { ...next[index], overrideValue: change.value }
          hasChange = true
        }
      } else {
        next.push({ forecastLineId: change.rowId, period: change.period, originalValue: original, overrideValue: change.value, reason: '计算工作表人工调整' })
        hasChange = true
      }
    })
    if (hasChange) { setOverrides(next); markDirty() }
  }

  if (!workspace || !projectDraft) return <section className="loading-card">正在加载项目工作区…</section>

  const previewHasErrors = livePreview.issues.some((issue) => issue.severity === 'error')
  const statusText = previewHasErrors
    ? '预览存在错误，上次结果仍有效'
    : dirty
      ? '实时预览，尚未保存'
      : workspace.forecast.latestRun
        ? workspace.forecast.isResultCurrent ? '结果与当前配置一致' : '已保存，等待计算'
        : '已保存，等待计算'
  const departmentName = snapshot.departments.find((item) => item.id === projectDraft.departmentId)?.name ?? '未选择申报部门'
  const categoryOrder: ForecastCategory[] = ['revenue', 'cost', 'cash_inflow', 'cash_outflow']
  const orderedLines = [...lines].sort((left, right) => {
    const categoryDifference = categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category)
    return categoryDifference || left.sortOrder - right.sortOrder
  })
  const modelRows: Array<{ id: string; kind: 'parameter' | ForecastCategory; parameter?: ProjectParameterDraft; line?: ForecastLineDraft }> = [
    ...[...parameters].sort((left, right) => left.sortOrder - right.sortOrder).map((parameter) => ({ id: parameter.id ?? '', kind: 'parameter' as const, parameter })),
    ...orderedLines.map((line) => ({ id: line.id ?? '', kind: line.category, line })),
  ]
  const typeLabels: Record<'parameter' | ForecastCategory, string> = {
    parameter: '业务参数', revenue: '收入', cost: '成本', cash_inflow: '直接收款', cash_outflow: '直接付款',
  }
  const previewValuesByLine = new Map<string, Record<string, string>>()
  livePreview.values.forEach((item) => {
    const values = previewValuesByLine.get(item.lineId) ?? {}
    values[item.period] = item.value
    previewValuesByLine.set(item.lineId, values)
  })
  const previewIssuesByLine = new Map<string, string[]>()
  livePreview.issues.forEach((issue) => {
    if (!issue.lineId) return
    previewIssuesByLine.set(issue.lineId, [...(previewIssuesByLine.get(issue.lineId) ?? []), issue.message])
  })
  const calculationRows: FinancialGridRow[] = report?.lineBreakdown.map((item) => {
    const valueMap = Object.fromEntries(item.values.map((value) => [value.period, value.value]))
    const overrideMap = new Map(overrides.filter((override) => override.forecastLineId === item.lineId).map((override) => [override.period, override]))
    overrideMap.forEach((override, period) => { valueMap[period] = override.overrideValue })
    const originalValues = Object.fromEntries(item.values.map((value) => [value.period, value.value]))
    overrideMap.forEach((override, period) => { originalValues[period] = override.originalValue })
    return {
      id: item.lineId,
      label: item.lineName,
      secondary: `${item.lineCode} · ${item.category === 'revenue' ? '收入' : item.category === 'cost' ? '成本' : item.category === 'cash_inflow' ? '直接收款' : '直接付款'}`,
      editable: true,
      values: valueMap,
      overriddenPeriods: new Set(overrideMap.keys()),
      originalValues,
    }
  }) ?? []
  return <main className="workspace semantic-workspace">
    <div className="workspace-head unified-workspace-head">
      <div className="workspace-heading project-inline-heading">
        <PageBreadcrumbs back={{ label: '返回', onClick: () => onNavigate('/projects') }} items={[{ label: projectDraft.name }]} />
      </div>
      <div className="workspace-tabs">
        <button className={view === 'config' ? 'workspace-tab active' : 'workspace-tab'} onClick={() => onNavigate(`/projects/${projectId}/config`)}><Calculator size={14} />项目配置</button>
        <button className={view === 'calculation' ? 'workspace-tab active' : 'workspace-tab'} onClick={() => onNavigate(`/projects/${projectId}/calculation`)}><TableProperties size={14} />计算工作表</button>
        <button className={view === 'report' ? 'workspace-tab active' : 'workspace-tab'} onClick={() => onNavigate(`/projects/${projectId}/report`)}><FileChartColumn size={14} />项目报告</button>
      </div>
      <div className="workspace-head-actions">
        <span className={`workspace-save-state ${dirty ? 'dirty' : ''}`}>{statusText}</span>
        <button className="btn" disabled={busy || !dirty} onClick={() => void saveFromToolbar()}><Save size={14} />保存</button>
        <button className="btn primary" disabled={busy} onClick={() => void calculate()}><Calculator size={14} />计算</button>
        <button className="btn icon-only" aria-label="更多项目操作" title="归档项目" onClick={() => void api.archive(projectId).then(() => onNavigate('/projects'))}><MoreHorizontal size={15} /></button>
      </div>
    </div>
    {message && <div className="workspace-message">{message}</div>}

    {view === 'config' && <div className={`project-config-shell ${(selectedLine || selectedParameter) ? 'drawer-open' : ''}`}>
      <div className="project-config-page">
        <section className="project-information-card">
          <div className="project-information-card-head">
            <div><h2>项目信息</h2><span className="project-code-subtitle">项目编码：{projectDraft.code || '待生成'}</span></div>
            <button className="text-button" onClick={() => setEditingProjectHeader((current) => !current)}>{editingProjectHeader ? '完成' : <><Pencil size={13} />编辑</>}</button>
          </div>
          {editingProjectHeader ? <div className="project-information-compact-form project-information-equal-form">
            <label>项目名称<input value={projectDraft.name} onChange={(event) => { setProjectDraft({ ...projectDraft, name: event.target.value }); markDirty() }} /></label>
            <label>申报部门<select value={projectDraft.departmentId} onChange={(event) => { setProjectDraft({ ...projectDraft, departmentId: event.target.value }); markDirty() }}>{snapshot.departments.filter((item) => item.status === 'active' || item.id === projectDraft.departmentId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>开始期间<input type="month" value={projectDraft.startPeriod} onChange={(event) => { setProjectDraft({ ...projectDraft, startPeriod: event.target.value }); markDirty() }} /></label>
            <label>结束期间<input type="month" value={projectDraft.endPeriod} onChange={(event) => { setProjectDraft({ ...projectDraft, endPeriod: event.target.value }); markDirty() }} /></label>
            <div className="project-period-result"><span>项目周期</span><b>{countPeriods(projectDraft.startPeriod, projectDraft.endPeriod) > 0 ? `${countPeriods(projectDraft.startPeriod, projectDraft.endPeriod)} 个月` : '结束期间不能早于开始期间'}</b></div>
          </div> : <dl className="project-information-readonly project-information-equal-readonly">
            <div><dt>项目名称</dt><dd>{projectDraft.name}</dd></div><div><dt>申报部门</dt><dd>{departmentName}</dd></div><div><dt>开始期间</dt><dd>{projectDraft.startPeriod}</dd></div><div><dt>结束期间</dt><dd>{projectDraft.endPeriod}</dd></div><div><dt>项目周期</dt><dd>{countPeriods(projectDraft.startPeriod, projectDraft.endPeriod)} 个月</dd></div>
          </dl>}
        </section>
        <section className="forecast-config-section unified-model-section">
          <div className="forecast-toolbar unified-model-toolbar">
            <div><h2>行项目配置</h2><span>{modelRows.length} 个行项目 · 实时预览 · 损益未税口径</span></div><span className="spacer" />
            <button className="btn" onClick={addParameter}><Plus size={14} />新增参数</button>
            <div className="toolbar-create-menu">
              <button className={`btn toolbar-menu-trigger ${createMenu === 'profit' ? 'active' : ''}`} onClick={() => setCreateMenu((current) => current === 'profit' ? '' : 'profit')}><Plus size={14} />新增损益<ChevronDown size={13} /></button>
              {createMenu === 'profit' && <div className="toolbar-create-popover"><button onClick={() => { addLine('revenue'); setCreateMenu('') }}><span className="create-type-dot revenue" />收入项目</button><button onClick={() => { addLine('cost'); setCreateMenu('') }}><span className="create-type-dot cost" />成本项目</button></div>}
            </div>
            <div className="toolbar-create-menu">
              <button className={`btn toolbar-menu-trigger ${createMenu === 'cash' ? 'active' : ''}`} onClick={() => setCreateMenu((current) => current === 'cash' ? '' : 'cash')}><Plus size={14} />新增现金<ChevronDown size={13} /></button>
              {createMenu === 'cash' && <div className="toolbar-create-popover"><button onClick={() => { addLine('cash_inflow'); setCreateMenu('') }}><span className="create-type-dot cash-inflow" />直接收款</button><button onClick={() => { addLine('cash_outflow'); setCreateMenu('') }}><span className="create-type-dot cash-outflow" />直接付款</button></div>}
            </div>
          </div>
          <div className="planning-grid-stage unified-preview-grid">
            <FinancialGrid
              ariaLabel="统一行项目分月预览"
              typeColumnTitle="类型"
              typeColumnWidth={88}
              labelColumnTitle="预测项"
              labelColumnWidth={330}
              periods={cashPeriods}
              activeRowId={selectedParameterId || selectedLineId}
              rows={modelRows.map((item) => {
                if (item.parameter) return { id: item.id, label: item.parameter.name, editable: false, values: item.parameter.parameterType === 'fixed' ? Object.fromEntries(projectPeriods.map((period) => [period, item.parameter?.fixedValue ?? ''])) : item.parameter.monthlyValues }
                const line = item.line as ForecastLineDraft
                return { id: item.id, label: line.name, editable: false, values: previewIssuesByLine.has(item.id) ? {} : previewValuesByLine.get(item.id) ?? {} }
              })}
              onRowActivate={(rowId) => {
                const item = modelRows.find((candidate) => candidate.id === rowId)
                if (item?.parameter) { setSelectedLineId(''); setSelectedParameterId(rowId) } else { setSelectedParameterId(''); setSelectedLineId(rowId) }
              }}
              renderRowType={(row) => {
                const item = modelRows.find((candidate) => candidate.id === row.id)
                return item ? <span className={`model-type-tag ${item.kind.replace('_', '-')}`}>{typeLabels[item.kind]}</span> : null
              }}
              renderRowLabel={(row) => {
                const item = modelRows.find((candidate) => candidate.id === row.id)
                if (item?.parameter) return <div className="model-row-content"><button className="model-row-summary"><b>{item.parameter.name}</b><span>{item.parameter.code} · {item.parameter.parameterType === 'fixed' ? `全期固定 · ${item.parameter.fixedValue || '未填写'} ${item.parameter.unit}` : `逐月填写 · ${Object.keys(item.parameter.monthlyValues).length}/${projectPeriods.length} 月已填`}</span></button><div className="model-row-actions"><button title="复制参数" aria-label={`复制${item.parameter.name}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); duplicateParameter(item.id) }}><Copy size={15} /></button><button title="删除参数" aria-label={`删除${item.parameter.name}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); removeParameter(item.id) }}><Trash2 size={15} /></button></div></div>
                const line = item?.line
                if (!line) return row.label
                const rule = cashRules.find((candidate) => candidate.sourceLineCode === line.code)
                const method = line.forecastMethod === 'fixed_monthly' ? `${line.fixedMonthlyValue || '未填写'} 元/月` : line.forecastMethod === 'formula' ? formulaSummary(line.formulaExpression, parameters, lines) : `${Object.keys(line.monthlyValues).length} 个月已填`
                const settlement = line.category === 'revenue' || line.category === 'cost' ? ` · ${line.amountBasis === 'tax_inclusive' ? '含税' : line.amountBasis === 'non_taxable' ? '免税' : '未税'} ${line.taxRate || 0}% · ${rule?.method === 'delayed' ? `延后${rule.delayMonths}月` : rule?.method === 'installment' ? '分期结算' : rule?.method === 'disabled' ? '不生成现金' : '当月结算'}` : ''
                const issue = previewIssuesByLine.get(item.id)?.[0]
                return <div className="model-row-content"><button className="model-row-summary"><b>{line.name}</b><span className={issue ? 'preview-line-error' : ''}>{line.code} · {issue ? `预览错误：${issue}` : `${forecastSchemeLabel(line)} · ${method}${settlement}`}</span></button><div className="model-row-actions"><button title="复制预测项" aria-label={`复制${line.name}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); duplicateLine(item.id) }}><Copy size={15} /></button><button title="删除预测项" aria-label={`删除${line.name}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); removeLine(item.id) }}><Trash2 size={15} /></button></div></div>
              }}
            />
          </div>
        </section>
      </div>
      {selectedParameter && <ParameterLineEditor parameter={selectedParameter} periods={projectPeriods} onPatch={(patch) => patchParameter(selectedParameter.id ?? '', patch)} onMonthlyChange={updateParameterMonthly} onClose={() => setSelectedParameterId('')} />}
      {selectedLine && <LineEditor key={selectedLine.id} line={selectedLine} periods={selectedLine.category === 'cash_inflow' || selectedLine.category === 'cash_outflow' ? cashPeriods : projectPeriods} parameters={parameters} lines={lines} cashRule={cashRules.find((rule) => rule.sourceLineCode === selectedLine.code)} onPatch={(patch) => patchLine(selectedLine.id ?? '', patch)} onMonthlyChange={updateMonthly} onCashRuleChange={(rule) => { setCashRules((current) => current.some((item) => item.sourceLineCode === rule.sourceLineCode) ? current.map((item) => item.sourceLineCode === rule.sourceLineCode ? rule : item) : [...current, rule]); markDirty() }} onClose={() => setSelectedLineId('')} />}
    </div>}

    {view === 'calculation' && <div className="workspace-view calculation-sheet-view">
      {!report?.hasFacts ? <div className="empty-report-card"><h2>当前项目尚无成功计算结果</h2><p>请先在项目配置中维护预测行并点击“计算”。</p></div> : <>
        <div className="calculation-sheet-head"><div><h2>行项目分月计算工作表</h2><p>叶子行可批量粘贴覆盖；汇总指标由系统重新计算。</p></div><span>{report.calculationRun ? `RUN-${String(report.calculationRun.runNumber).padStart(4, '0')}` : ''}</span></div>
        {dirty && <div className="page-alert">人工覆盖尚未保存；点击顶部“保存”后仍需“计算”才会更新汇总和报告。</div>}
        <FinancialGrid ariaLabel="计算工作表" periods={report.monthly.map((item) => item.period)} rows={calculationRows} onChange={editCalculation} onClearOverride={(rowId, period) => { setOverrides((current) => current.filter((item) => !(item.forecastLineId === rowId && item.period === period))); markDirty() }} includeHeadersOnCopy />
        <ReadOnlySummaryGrid report={report} />
      </>}
    </div>}

    {view === 'report' && <ProjectReportView
      report={report}
      selectedRunId={reportRunId}
      onSelectRun={setReportRunId}
      onExport={() => void api.exportReport(projectId, report?.calculationRun?.id).catch((reason) => setMessage(reason instanceof Error ? reason.message : 'Excel 导出失败'))}
    />}
  </main>
}

function ParameterLineEditor({ parameter, periods, onPatch, onMonthlyChange, onClose }: {
  parameter: ProjectParameterDraft
  periods: string[]
  onPatch: (patch: Partial<ProjectParameterDraft>) => void
  onMonthlyChange: (changes: FinancialGridChange[]) => void
  onClose: () => void
}) {
  const [editingTitle, setEditingTitle] = useState(false)
  const monthlyRow: FinancialGridRow = {
    id: parameter.id ?? '',
    label: parameter.name,
    editable: true,
    values: parameter.monthlyValues,
  }
  return <aside className="forecast-editor compact-line-editor parameter-line-editor">
    <div className="editor-head"><div>{editingTitle ? <input className="drawer-title-input" value={parameter.name} autoFocus onChange={(event) => onPatch({ name: event.target.value })} onBlur={() => setEditingTitle(false)} onKeyDown={(event) => { if (event.key === 'Enter') setEditingTitle(false) }} /> : <button className="drawer-title-button" onClick={() => setEditingTitle(true)} title="点击编辑名称"><b>{parameter.name}</b></button>}<small>{parameter.code}</small></div><div className="editor-head-actions"><button className="icon-button" aria-label="关闭参数配置" onClick={onClose}><X size={15} /></button></div></div>
    <div className="editor-form compact-editor-form">
      <div className="drawer-section-title full-field">基本信息</div>
      <label>录入方式<select value={parameter.parameterType} onChange={(event) => onPatch({ parameterType: event.target.value as ProjectParameterDraft['parameterType'] })}><option value="fixed">全期固定</option><option value="monthly">逐月填写</option></select></label>
      <label>数值类型<select value={parameter.valueType} onChange={(event) => onPatch({ valueType: event.target.value as ProjectParameterDraft['valueType'] })}><option value="currency">金额</option><option value="quantity">数量</option><option value="percentage">比例</option><option value="number">普通数值</option></select></label>
      <label className="full-field">单位<input value={parameter.unit} onChange={(event) => onPatch({ unit: event.target.value })} /></label>
      <div className="drawer-section-title full-field">参数取值</div>
      {parameter.parameterType === 'fixed' && <label className="full-field">全期值<input value={parameter.fixedValue ?? ''} onChange={(event) => onPatch({ fixedValue: event.target.value })} /></label>}
      {parameter.parameterType === 'monthly' && <div className="editor-grid full-field"><FinancialGrid ariaLabel={`${parameter.name}逐月参数`} periods={periods} rows={[monthlyRow]} onChange={onMonthlyChange} /></div>}
      <div className="drawer-section-title full-field">说明</div>
      <label className="full-field">参数说明<textarea value={parameter.description} onChange={(event) => onPatch({ description: event.target.value })} /></label>
    </div>
  </aside>
}

function LineEditor({ line, periods, parameters, lines, cashRule, onPatch, onMonthlyChange, onCashRuleChange, onClose }: { line: ForecastLineDraft; periods: string[]; parameters: ProjectParameterDraft[]; lines: ForecastLineDraft[]; cashRule?: CashRuleDraft; onPatch: (patch: Partial<ForecastLineDraft>) => void; onMonthlyChange: (changes: FinancialGridChange[]) => void; onCashRuleChange: (rule: CashRuleDraft) => void; onClose: () => void }) {
  const [editingTitle, setEditingTitle] = useState(false)
  const isProfit = line.category === 'revenue' || line.category === 'cost'
  const scheme = forecastScheme(line)
  const monthlyRow: FinancialGridRow = { id: line.id ?? '', label: line.name, editable: true, values: line.monthlyValues }
  return <aside className="forecast-editor compact-line-editor"><div className="editor-head"><div>{editingTitle ? <input className="drawer-title-input" value={line.name} autoFocus onChange={(event) => onPatch({ name: event.target.value })} onBlur={() => setEditingTitle(false)} onKeyDown={(event) => { if (event.key === 'Enter') setEditingTitle(false) }} /> : <button className="drawer-title-button" onClick={() => setEditingTitle(true)} title="点击编辑名称"><b>{line.name}</b></button>}<small>{line.code}</small></div><div className="editor-head-actions"><button className="icon-button" aria-label="关闭配置" onClick={onClose}><X size={15} /></button></div></div>
    <div className="editor-form compact-editor-form">
      <div className="drawer-section-title full-field">基本信息与计算规则</div>
        <label>测算方式<select value={scheme} onChange={(e) => onPatch(patchForForecastScheme(line, e.target.value as ForecastScheme, parameters, lines))}><option value="fixed_monthly">固定月金额</option><option value="monthly_input">逐月填写</option>{isProfit && <option value="price_quantity">单价 × 数量</option>}{line.category === 'cost' && <option value="revenue_ratio">按收入比例</option>}<option value="custom_formula">自定义公式</option></select></label>
        <label>开始期间<select value={line.startPeriod} onChange={(e) => onPatch({ startPeriod: e.target.value })}>{periods.map((period) => <option key={period}>{period}</option>)}</select></label><label>结束期间<select value={line.endPeriod} onChange={(e) => onPatch({ endPeriod: e.target.value })}>{periods.map((period) => <option key={period}>{period}</option>)}</select></label>
        {scheme === 'fixed_monthly' && <label className="full-field">每月金额（元）<input value={line.fixedMonthlyValue ?? ''} onChange={(e) => onPatch({ fixedMonthlyValue: e.target.value })} /></label>}
        <ForecastSchemeFields line={line} parameters={parameters} lines={lines} onPatch={onPatch} />
        {scheme === 'custom_formula' && <div className="formula-editor full-field"><div className="formula-editor-title"><span>fx</span><b>公式表达式</b></div><textarea value={line.formulaExpression ?? ''} onChange={(e) => onPatch({ formulaExpression: e.target.value })} placeholder={'PARAM("PAR-001") * PARAM("PAR-002")'} /><div className="formula-business-summary">业务解释：{formulaSummary(line.formulaExpression, parameters, lines)}</div><details><summary>查看可用参数与行项目</summary><small>可用参数：{parameters.map((item) => `${item.name}(${item.code})`).join('、') || '无'}<br />可用行：{lines.filter((item) => item.id !== line.id).map((item) => `${item.name}(${item.code})`).join('、') || '无'}</small></details></div>}
        {scheme === 'monthly_input' && <div className="editor-grid full-field"><FinancialGrid ariaLabel="逐月预测输入" periods={periods.filter((period) => period >= line.startPeriod && period <= line.endPeriod)} rows={[monthlyRow]} onChange={onMonthlyChange} /></div>}
      {isProfit && <><div className="drawer-section-title full-field">税与收付款</div><div className="editor-rule-card full-field"><h3>损益金额口径</h3><div className="compact-editor-form nested-grid"><label>金额口径<select value={line.amountBasis} onChange={(e) => onPatch({ amountBasis: e.target.value as ForecastLineDraft['amountBasis'] })}><option value="tax_exclusive">未税</option><option value="tax_inclusive">含税</option><option value="non_taxable">免税</option></select></label><label>税率（%）<input value={line.taxRate ?? '0'} disabled={line.amountBasis === 'non_taxable'} onChange={(e) => onPatch({ taxRate: e.target.value })} /></label></div><p>损益结果统一换算为未税口径。</p></div><div className="editor-rule-card full-field"><h3>{line.category === 'revenue' ? '收款规则' : '付款规则'}</h3><label>收付款方式<select value={cashRule?.method ?? 'disabled'} onChange={(e) => onCashRuleChange({ ...(cashRule ?? { sourceLineId: line.id, sourceLineCode: line.code ?? '', delayMonths: 0, installments: [] }), method: e.target.value as CashRuleDraft['method'] })}><option value="disabled">不自动生成</option><option value="immediate">当月100%</option><option value="delayed">延后N个月</option><option value="installment">自定义分期</option></select></label>{cashRule?.method === 'delayed' && <label>延后月份<input type="number" min={0} max={36} value={cashRule.delayMonths} onChange={(e) => onCashRuleChange({ ...cashRule, delayMonths: Number(e.target.value) })} /></label>}<p>不自动生成时，可在“直接现金”中维护。</p></div></>}
      <div className="drawer-section-title full-field">说明与来源</div><label className="full-field">假设说明<textarea className="assumption-editor" value={line.assumption} onChange={(e) => onPatch({ assumption: e.target.value })} /></label><div className="line-source-summary full-field"><b>数据与依赖</b><p>{line.forecastMethod === 'formula' ? `${forecastSchemeLabel(line)}：${formulaSummary(line.formulaExpression, parameters, lines)}` : line.forecastMethod === 'monthly_input' ? `已填写 ${Object.keys(line.monthlyValues).length} 个月` : `每月固定金额 ${line.fixedMonthlyValue || '未填写'} 元`}</p></div>
    </div>
  </aside>
}

function LegacyBusinessParameterSection({ project, parameters, selectedId, periods, lines, onProjectChange, onSelect, onChange }: { project: ProjectInput; parameters: ProjectParameterDraft[]; selectedId: string; periods: string[]; lines: ForecastLineDraft[]; onProjectChange: (next: ProjectInput) => void; onSelect: (id: string) => void; onChange: (next: ProjectParameterDraft[]) => void }) {
  const dialog = useAppDialog()
  const selected = parameters.find((item) => item.id === selectedId)
  const patch = (values: Partial<ProjectParameterDraft>) => selected && onChange(parameters.map((item) => item.id === selected.id ? { ...item, ...values } : item))
  function add() { const parameter: ProjectParameterDraft = { id: `draft-${crypto.randomUUID()}`, code: nextCode('PAR', parameters.map((item) => item.code)), name: '新增参数', parameterType: 'fixed', valueType: 'number', unit: '', fixedValue: '', description: '', sortOrder: parameters.length + 1, monthlyValues: {} }; onChange([...parameters, parameter]); onSelect(parameter.id ?? '') }
  const periodCount = countPeriods(project.startPeriod, project.endPeriod)
  const referenceCount = (parameter: ProjectParameterDraft) => lines.filter((line) => line.formulaExpression?.includes(`"${parameter.code}"`)).length
  async function remove(parameter: ProjectParameterDraft) {
    const count = referenceCount(parameter)
    if (count > 0) { await dialog.alert(`参数“${parameter.name}”正在被 ${count} 个行项目引用。请先调整相关公式。`, { title: '参数暂时无法删除', tone: 'warning' }); return }
    if (!await dialog.confirm({ title: '删除业务参数？', message: `确定删除“${parameter.name}”？`, tone: 'danger', confirmLabel: '删除参数' })) return
    onChange(parameters.filter((item) => item.id !== parameter.id)); onSelect('')
  }
  return <section className="business-parameter-section">
    <div className="simple-section-title"><h2>业务参数</h2><button className="btn primary" onClick={add}><Plus size={14} />新增参数</button></div>
    <div className="measurement-period-row"><label>开始期间<input type="month" value={project.startPeriod} onChange={(event) => onProjectChange({ ...project, startPeriod: event.target.value })} /></label><label>结束期间<input type="month" value={project.endPeriod} onChange={(event) => onProjectChange({ ...project, endPeriod: event.target.value })} /></label><div className={`period-count-preview ${periodCount < 1 ? 'error' : ''}`}><span>项目周期</span><b>{periodCount < 1 ? '结束期间不能早于开始期间' : `共 ${periodCount} 个月`}</b></div></div>
    <div className="business-parameter-table-wrap"><table className="data-table business-parameter-table"><thead><tr><th>参数</th><th>编码</th><th>录入方式</th><th>单位</th><th>主要配置</th><th>引用</th></tr></thead><tbody>{parameters.map((item) => {
      const expanded = item.id === selectedId
      const references = referenceCount(item)
      return <Fragment key={item.id}><tr className={expanded ? 'selected-row' : ''} onClick={() => onSelect(expanded ? '' : item.id ?? '')}><td><b>{item.name}</b></td><td><code>{item.code}</code></td><td>{item.parameterType === 'fixed' ? '全期固定' : '逐月填写'}</td><td>{item.unit || '—'}</td><td>{item.parameterType === 'fixed' ? item.fixedValue || '未填写' : `${Object.keys(item.monthlyValues).length} / ${Math.max(periodCount, 0)} 个月已填`}</td><td>{references ? `${references} 行` : '未引用'}</td></tr>{expanded && <tr className="parameter-detail-row"><td colSpan={6}><div className="parameter-inline-editor"><div className="parameter-property-grid"><label>参数名称<input value={item.name} onChange={(event) => patch({ name: event.target.value })} /></label><label>录入方式<select value={item.parameterType} onChange={(event) => patch({ parameterType: event.target.value as ProjectParameterDraft['parameterType'] })}><option value="fixed">全期固定</option><option value="monthly">逐月填写</option></select></label><label>数值类型<select value={item.valueType} onChange={(event) => patch({ valueType: event.target.value as ProjectParameterDraft['valueType'] })}><option value="currency">金额</option><option value="quantity">数量</option><option value="percentage">比例</option><option value="number">普通数值</option></select></label><label>单位<input value={item.unit} onChange={(event) => patch({ unit: event.target.value })} /></label>{item.parameterType === 'fixed' && <label>全期值<input value={item.fixedValue ?? ''} onChange={(event) => patch({ fixedValue: event.target.value })} /></label>}<button className="danger-link parameter-delete" onClick={(event) => { event.stopPropagation(); remove(item) }}>删除参数</button></div>{item.parameterType === 'monthly' && <FinancialGrid ariaLabel={`${item.name}逐月参数`} periods={periods} rows={[{ id: item.id ?? '', label: item.name, editable: true, values: item.monthlyValues }]} onChange={(changes) => { const values = { ...item.monthlyValues }; changes.forEach((change) => { if (change.value) values[change.period] = change.value; else delete values[change.period] }); patch({ monthlyValues: values }) }} />}<label className="parameter-description">说明<textarea value={item.description} onChange={(event) => patch({ description: event.target.value })} /></label></div></td></tr>}</Fragment>
    })}{parameters.length === 0 && <tr><td colSpan={6} className="empty-cell">暂无业务参数</td></tr>}</tbody></table></div>
  </section>
}

function BusinessParameterSection({ project, parameters, selectedId, periods, lines, onProjectChange, onSelect, onChange }: { project: ProjectInput; parameters: ProjectParameterDraft[]; selectedId: string; periods: string[]; lines: ForecastLineDraft[]; onProjectChange: (next: ProjectInput) => void; onSelect: (id: string) => void; onChange: (next: ProjectParameterDraft[]) => void }) {
  const dialog = useAppDialog()
  const selected = parameters.find((item) => item.id === selectedId)
  const periodCount = countPeriods(project.startPeriod, project.endPeriod)
  const referenceCount = (parameter: ProjectParameterDraft) => lines.filter((line) => line.formulaExpression?.includes(`\"${parameter.code}\"`)).length
  const patchParameter = (id: string, values: Partial<ProjectParameterDraft>) => onChange(parameters.map((item) => item.id === id ? { ...item, ...values } : item))
  function add() { const parameter: ProjectParameterDraft = { id: `draft-${crypto.randomUUID()}`, code: nextCode('PAR', parameters.map((item) => item.code)), name: '新增参数', parameterType: 'fixed', valueType: 'number', unit: '', fixedValue: '', description: '', sortOrder: parameters.length + 1, monthlyValues: {} }; onChange([...parameters, parameter]); onSelect(parameter.id ?? '') }
  async function remove(parameter: ProjectParameterDraft) {
    const count = referenceCount(parameter)
    if (count > 0) { await dialog.alert(`参数“${parameter.name}”正在被 ${count} 个行项目引用。请先调整相关公式。`, { title: '参数暂时无法删除', tone: 'warning' }); return }
    if (!await dialog.confirm({ title: '删除业务参数？', message: `确定删除“${parameter.name}”？`, tone: 'danger', confirmLabel: '删除参数' })) return
    onChange(parameters.filter((item) => item.id !== parameter.id)); onSelect('')
  }
  const rows: FinancialGridRow[] = parameters.map((item) => ({
    id: item.id ?? '', label: item.name, editable: item.parameterType === 'monthly',
    values: item.parameterType === 'fixed' ? Object.fromEntries(periods.map((period) => [period, item.fixedValue ?? ''])) : item.monthlyValues,
  }))
  return <section className="business-parameter-section planning-section">
    <div className="simple-section-title business-parameter-titlebar"><h2>业务参数</h2><div className="business-period-controls"><label>开始<input type="month" value={project.startPeriod} onChange={(event) => onProjectChange({ ...project, startPeriod: event.target.value })} /></label><label>结束<input type="month" value={project.endPeriod} onChange={(event) => onProjectChange({ ...project, endPeriod: event.target.value })} /></label><b className={periodCount < 1 ? 'period-error' : ''}>{periodCount < 1 ? '结束不能早于开始' : `${periodCount} 个月`}</b></div><button className="btn primary" onClick={add}><Plus size={14} />新增参数</button></div>
    <div className="planning-grid-stage parameter-planning-grid">
      <FinancialGrid ariaLabel="业务参数分月配置" labelColumnTitle="参数与综合配置" labelColumnWidth={390} periods={periods} rows={rows}
        onChange={(changes) => {
          const grouped = new Map<string, FinancialGridChange[]>()
          changes.forEach((change) => grouped.set(change.rowId, [...(grouped.get(change.rowId) ?? []), change]))
          onChange(parameters.map((item) => {
            const items = grouped.get(item.id ?? '')
            if (!items) return item
            const values = { ...item.monthlyValues }
            items.forEach((change) => { if (change.value) values[change.period] = change.value; else delete values[change.period] })
            return { ...item, monthlyValues: values }
          }))
        }}
        renderRowLabel={(row) => {
          const item = parameters.find((parameter) => parameter.id === row.id)
          if (!item) return row.label
          const references = referenceCount(item)
          return <div className="planning-row-config parameter-row-config"><div className="planning-row-title"><b>{item.name}</b><span>{item.unit || '无单位'}</span>{references > 0 && <span>{references} 处引用</span>}</div><div className="parameter-inline-rule" onMouseDown={(event) => event.stopPropagation()}><select aria-label={`${item.name}录入方式`} value={item.parameterType} onChange={(event) => patchParameter(item.id ?? '', { parameterType: event.target.value as ProjectParameterDraft['parameterType'] })}><option value="fixed">全期固定</option><option value="monthly">逐月填写</option></select>{item.parameterType === 'fixed' ? <input aria-label={`${item.name}全期值`} value={item.fixedValue ?? ''} placeholder="统一值" onChange={(event) => patchParameter(item.id ?? '', { fixedValue: event.target.value })} /> : <span>{Object.keys(item.monthlyValues).length}/{Math.max(periodCount, 0)} 月已填</span>}</div><button className="planning-settings" aria-label={`配置${item.name}`} title="修改完整配置" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onSelect(item.id ?? '') }}><Settings size={15} /></button></div>
        }} />
      {selected && <div className="row-config-popover parameter-config-popover"><div className="popover-head"><div><b>{selected.name}</b><small>{selected.code}</small></div><button className="icon-button" aria-label="关闭参数配置" onClick={() => onSelect('')}><X size={15} /></button></div><div className="parameter-popover-form"><label>参数名称<input value={selected.name} onChange={(event) => patchParameter(selected.id ?? '', { name: event.target.value })} /></label><label>数值类型<select value={selected.valueType} onChange={(event) => patchParameter(selected.id ?? '', { valueType: event.target.value as ProjectParameterDraft['valueType'] })}><option value="currency">金额</option><option value="quantity">数量</option><option value="percentage">比例</option><option value="number">普通数值</option></select></label><label>单位<input value={selected.unit} onChange={(event) => patchParameter(selected.id ?? '', { unit: event.target.value })} /></label><label className="full-field">说明<textarea value={selected.description} onChange={(event) => patchParameter(selected.id ?? '', { description: event.target.value })} /></label><button className="danger-link full-field" onClick={() => remove(selected)}>删除参数</button></div></div>}
    </div>
  </section>
}

function ReadOnlySummaryGrid({ report }: { report: ProjectReportDto }) {
  const rows: FinancialGridRow[] = [
    { id: 'revenue', label: '收入合计', editable: false, values: Object.fromEntries(report.monthly.map((item) => [item.period, item.revenue])) },
    { id: 'cost', label: '成本合计', editable: false, values: Object.fromEntries(report.monthly.map((item) => [item.period, item.cost])) },
    { id: 'gross', label: '毛利', editable: false, values: Object.fromEntries(report.monthly.map((item) => [item.period, item.grossProfit])) },
    ...(report.hasCashFacts ? [{ id: 'cash', label: '净现金流', editable: false, values: Object.fromEntries(report.monthly.map((item) => [item.period, item.netCashFlow])) }] : []),
  ]
  return <section className="calculation-summary"><h2>系统汇总与派生指标（只读）</h2>{!report.hasCashFacts && <p className="report-data-note">源项目未提供现金计划，本报告不以 0 元代替现金流结果。</p>}<FinancialGrid ariaLabel="系统汇总指标" periods={report.monthly.map((item) => item.period)} rows={rows} includeHeadersOnCopy /></section>
}

function ProjectReportView({ report, selectedRunId, onSelectRun, onExport }: { report?: ProjectReportDto; selectedRunId: string; onSelectRun: (runId: string) => void; onExport: () => void }) {
  if (!report?.hasFacts) return <div className="empty-report-card"><h2>当前项目尚无报告结果</h2><p>报告只读取成功计算批次。</p></div>
  return <div className="workspace-view formal-report">
    <div className="formal-report-toolbar no-print"><div><b>项目测算报告</b><span>{report.calculationRun ? `RUN-${String(report.calculationRun.runNumber).padStart(4, '0')} · 修订 R${report.calculationRun.draftRevision}` : ''}</span></div><span className="spacer" /><label>成功批次<select value={selectedRunId || report.calculationRun?.id || ''} onChange={(event) => onSelectRun(event.target.value)}>{report.availableRuns.map((run) => <option key={run.id} value={run.id}>RUN-{String(run.runNumber).padStart(4, '0')} · {new Date(run.completedAt).toLocaleString('zh-CN')}</option>)}</select></label><button className="btn" onClick={onExport}><Download size={14} />导出 Excel</button><button className="btn" onClick={() => window.print()}><Printer size={14} />打印 / PDF</button></div>
    <section className="report-cover"><div><span>项目测算报告</span><h1>{report.projectSnapshot.name}</h1><p>{report.projectSnapshot.code || '无项目编码'} · {report.department?.name || '未指定申报部门'} · {report.scenario.name} · {report.version.name}</p></div><dl><div><dt>经营期间</dt><dd>{report.projectSnapshot.startPeriod}—{report.operationEndPeriod}</dd></div><div><dt>计算批次</dt><dd>{report.calculationRun ? `RUN-${String(report.calculationRun.runNumber).padStart(4, '0')}` : '—'}</dd></div><div><dt>结果状态</dt><dd className={report.isBehindDraft ? 'risk' : 'good'}>{report.isBehindDraft ? '落后于当前配置' : '与当前配置一致'}</dd></div></dl></section>
    <section className="metrics-strip"><article><span>收入</span><strong>{formatWan(report.summary.revenue)} 万元</strong></article><article><span>成本</span><strong>{formatWan(report.summary.cost)} 万元</strong></article><article><span>毛利</span><strong>{formatWan(report.summary.grossProfit)} 万元</strong></article><article><span>毛利率</span><strong>{formatPercent(report.summary.grossMargin)}</strong></article><article><span>最大垫资</span><strong>{report.hasCashFacts ? `${formatWan(report.summary.maximumFunding)} 万元` : '暂无现金数据'}</strong></article><article><span>现金转正</span><strong>{report.hasCashFacts ? report.summary.cashPositiveLabel : '暂无现金数据'}</strong></article></section>
    <section className="report-section report-narrative"><h2>1. 测算概况与口径</h2>{report.measurementSummary.map((item) => <p key={item}>{item}</p>)}{report.riskNotes.map((item) => <p className="risk" key={item}>风险提示：{item}</p>)}</section>
    <section className="report-section"><h2>2. 损益、构成与现金趋势</h2><Suspense fallback={<div className="report-chart-loading">正在生成图表…</div>}><ReportCharts report={report} /></Suspense></section>
    <section className="report-section"><h2>3. 分月损益与现金流</h2><ReadOnlySummaryGrid report={report} /></section>
    <section className="report-section"><h2>4. 关键参数与人工覆盖</h2><div className="report-two-columns"><div><h3>关键参数</h3>{report.keyAssumptions.length ? report.keyAssumptions.map((item) => <p key={item.code}><b>{item.name}</b><span>{item.value} {item.unit}</span></p>) : <p>本批次无项目参数。</p>}</div><div><h3>人工覆盖</h3>{report.overrides.length ? report.overrides.map((item) => { const line = report.lineBreakdown.find((candidate) => candidate.lineId === item.forecastLineId); return <p key={`${item.forecastLineId}:${item.period}`}><b>{line?.lineName ?? item.forecastLineId} · {item.period}</b><span>{item.originalValue} → {item.overrideValue}</span></p> }) : <p>本批次无人工覆盖。</p>}</div></div></section>
    <section className="report-section"><h2>5. 指标公式与数据来源</h2><table className="data-table"><thead><tr><th>指标</th><th>类型</th><th>表达式</th><th>说明</th></tr></thead><tbody>{report.metricDefinitions.map((metric) => <tr key={metric.code}><td>{metric.name}<small>{metric.code}</small></td><td>{metric.metricType === 'base' ? '基础指标' : '系统计算'}</td><td><code>{metric.expression ?? '基础事实写入'}</code></td><td>{metric.description}</td></tr>)}</tbody></table></section>
  </div>
}
