import Decimal from 'decimal.js'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileChartColumn,
  BadgePercent,
  ChartNoAxesCombined,
  CircleDollarSign,
  Pencil,
  Plus,
  Printer,
  Save,
  Settings,
  Sparkles,
  TableProperties,
  Trash2,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import type {
  CashRuleDraft,
  ForecastCategory,
  ForecastLineDraft,
  FactAdjustmentDraft,
  ProjectInput,
  ProjectParameterDraft,
  ProjectPlan,
  ProjectReportDto,
  ProjectWorkspace,
} from '../../shared/domain/types'
import type { AppSnapshot } from '../state/types'
import { ApiClient, SemanticApiError } from '../api/client'
import { countPeriods, generatePeriodRange, generatePeriods } from '../../shared/domain/periods'
import { FinancialGrid, type FinancialGridChange, type FinancialGridRow } from '../components/FinancialGrid'
import { CalculationBaseGrid } from '../components/CalculationBaseGrid'
import { PageBreadcrumbs } from '../components/PageBreadcrumbs'
import { formatPercent } from '../ui/formatters'
import { useAppDialog } from '../ui/AppDialog'
import { AiAnalysisMaterialModal } from '../ui/AiAnalysisMaterialModal'
import {
  ForecastSchemeFields,
  forecastScheme,
  forecastSchemeLabel,
  patchForForecastScheme,
  type ForecastScheme,
} from '../ui/ForecastSchemeFields'
import { previewForecastDraft } from '../../shared/calculation/previewForecastDraft'
import {
  buildReportDisplay,
  formatReportAmount,
  reportUnitLabel,
  type ReportDisplayUnit,
  type ReportTaxBasis,
} from '../../shared/reporting/reportDisplay'
import guideProjectConfig from '../assets/guide/01_project_config.png'
import guideProjectInfo from '../assets/guide/02_project_info.png'
import guideForecastRule from '../assets/guide/03_forecast_rule.png'
import guideSaveCalculate from '../assets/guide/04_save_calculate.png'
import guideAdjustmentReport from '../assets/guide/05_adjustment_report.png'
import guideReportExport from '../assets/guide/06_report_export.png'
import guideAiAnalysisMaterial from '../assets/guide/07_ai_analysis_material.png'
import {
  PROFIT_METRIC_HIERARCHY,
  metricPathLabel,
} from '../../config/profitMetricHierarchy'

type WorkspaceView = 'config' | 'calculation' | 'report'
interface Props {
  api: ApiClient
  snapshot: AppSnapshot
  projectId: string
  planId?: string
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
    metricCode: line.metricCode,
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
    monthlyValues: rule.monthlyValues,
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

export function ProjectWorkspacePage({ api, snapshot, projectId, planId, view, onNavigate, onRefresh, onDirtyChange }: Props) {
  const dialog = useAppDialog()
  const [workspace, setWorkspace] = useState<ProjectWorkspace>()
  const [projectDraft, setProjectDraft] = useState<ProjectInput>()
  const [lines, setLines] = useState<ForecastLineDraft[]>([])
  const [parameters, setParameters] = useState<ProjectParameterDraft[]>([])
  const [cashRules, setCashRules] = useState<CashRuleDraft[]>([])
  const [adjustments, setAdjustments] = useState<FactAdjustmentDraft[]>([])
  const [adjustmentsDirty, setAdjustmentsDirty] = useState(false)
  const [selectedLineId, setSelectedLineId] = useState('')
  const [selectedParameterId, setSelectedParameterId] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [report, setReport] = useState<ProjectReportDto>()
  const [guideOpen, setGuideOpen] = useState(false)
  const [aiMaterialOpen, setAiMaterialOpen] = useState(false)
  const [editingProjectHeader, setEditingProjectHeader] = useState(false)
  const [createMenu, setCreateMenu] = useState<'profit' | 'cash' | ''>('')
  const [versionMenuOpen, setVersionMenuOpen] = useState(false)
  const [versionMemberId, setVersionMemberId] = useState('')
  const [planManageOpen, setPlanManageOpen] = useState(false)
  const [planNameDrafts, setPlanNameDrafts] = useState<Record<string, string>>({})
  const [editingPlanNameId, setEditingPlanNameId] = useState('')
  const [debouncedFormulaExpressions, setDebouncedFormulaExpressions] = useState<Record<string, string>>({})
  const createPlanMenuRef = useRef<HTMLDivElement>(null)

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
      startPeriod: next.currentPlan.startPeriod,
      endPeriod: next.currentPlan.endPeriod,
    })
    const nextLines = stateToLineDrafts(next)
    const nextParameters = stateToParameterDrafts(next)
    setLines(nextLines)
    setParameters(nextParameters)
    setCashRules(stateToCashRules(next))
    setSelectedLineId((current) => current && nextLines.some((line) => line.id === current) ? current : '')
    setSelectedParameterId((current) => current && nextParameters.some((item) => item.id === current) ? current : '')
    setDirty(false)
    onDirtyChange(false)
  }, [onDirtyChange])

  useEffect(() => {
    let cancelled = false
    setWorkspace(undefined)
    void api.getWorkspace(projectId, planId).then((result) => {
      if (!cancelled) hydrate(result)
    }).catch((reason) => {
      if (!cancelled) setMessage(reason instanceof Error ? reason.message : '项目加载失败')
    })
    return () => { cancelled = true }
  }, [api, hydrate, projectId, planId])

  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    void api.report(projectId, workspace.currentPlan.planId).then((result) => {
      if (!cancelled) {
        setReport(result)
        setAdjustments(result.adjustments.map((item) => ({
          id: item.id,
          forecastLineId: item.forecastLineId,
          period: item.period,
          metricCode: item.metricCode,
          adjustedValue: item.adjustedValue,
          reason: item.reason,
        })))
        setAdjustmentsDirty(false)
      }
    }).catch((reason) => {
      if (!cancelled) setMessage(reason instanceof Error ? reason.message : '结果加载失败')
    })
    return () => { cancelled = true }
  }, [api, projectId, view, workspace])

  useEffect(() => {
    if (!dirty && !adjustmentsDirty) return
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [adjustmentsDirty, dirty])

  useEffect(() => {
    if (!versionMenuOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (versionMenuOpen && !createPlanMenuRef.current?.contains(target)) setVersionMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [versionMenuOpen])

  useEffect(() => {
    if (!planManageOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPlanManageOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [planManageOpen])

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
    }
  }

  const livePreview = useMemo(() => {
    if (!workspace || !projectDraft) return { values: [], cashValues: [], issues: [] }
    try {
      return previewForecastDraft(
        { ...workspace.project, ...projectDraft, startPeriod: projectDraft.startPeriod, endPeriod: projectDraft.endPeriod },
        normalizedForecast(lines.map((line) => line.forecastMethod === 'formula'
          ? { ...line, formulaExpression: debouncedFormulaExpressions[line.id ?? line.code ?? line.name] ?? line.formulaExpression }
          : line)),
        workspace.currentPlan.planId,
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
  }, [cashRules, debouncedFormulaExpressions, lines, parameters, projectDraft, workspace])

  async function save(manageBusy = true, clearInvalidAdjustments = false) {
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
        planId: workspace.currentPlan.planId,
        expectedRevision: workspace.draftRevision,
        clearInvalidAdjustments,
        draft: {
          project: projectDraft,
          plan: { name: workspace.currentPlan.name, startPeriod: projectDraft.startPeriod, endPeriod: projectDraft.endPeriod },
          forecast: normalizedForecast(),
        },
      })
      hydrate(saved)
      await onRefresh()
      setMessage('整个项目草稿已保存')
      return saved
    } catch (reason) {
      if (!clearInvalidAdjustments && reason instanceof SemanticApiError && reason.detail.code === 'ADJUSTMENTS_OUTSIDE_PERIOD') {
        const details = reason.detail.fieldErrors?.map((item) => item.period).filter(Boolean).join('、')
        const confirmed = await dialog.confirm({
          title: '清理失效的人工调整？',
          message: `${reason.detail.message}${details ? `\n涉及期间：${details}` : ''}`,
          tone: 'warning',
          confirmLabel: '清理并保存',
        })
        if (confirmed) return save(false, true)
      }
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
      const result = await api.calculate(projectId, saved.currentPlan.planId, saved.draftRevision)
      if (!result.success) {
        setMessage(`计算失败：${result.issues.map((item) => item.message).slice(0, 3).join('；')}`)
        return
      }
      const refreshed = await api.getWorkspace(projectId, saved.currentPlan.planId)
      hydrate(refreshed)
      setReport(await api.report(projectId, saved.currentPlan.planId))
      setMessage('计算完成，已生成最新计算底稿')
      onNavigate(`/projects/${projectId}/calculation?planId=${encodeURIComponent(saved.currentPlan.planId)}`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '计算失败')
    } finally { setBusy(false) }
  }

  async function createVersion(copyCurrent: boolean) {
    if (!workspace) return
    if (!versionMemberId.trim()) { setMessage('请输入方案名称'); return }
    setBusy(true)
    try {
      const source = dirty ? await save(false) : workspace
      const created = await api.createPlan(projectId, {
        name: versionMemberId.trim(),
        startPeriod: source.currentPlan.startPeriod,
        endPeriod: source.currentPlan.endPeriod,
        copyFromPlanId: copyCurrent ? source.currentPlan.planId : undefined,
      })
      await onRefresh()
      setVersionMenuOpen(false)
      setVersionMemberId('')
      onNavigate(`/projects/${projectId}/${view}?planId=${encodeURIComponent(created.currentPlan.planId)}`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '新建方案失败')
    } finally { setBusy(false) }
  }

  function resetPlanNameDrafts(plans: ProjectPlan[]) {
    setPlanNameDrafts(Object.fromEntries(plans.map((plan) => [plan.planId, plan.name])))
  }

  async function refreshPlanManagement(preferredPlanId?: string | null) {
    const resolvedPlanId = preferredPlanId === null ? undefined : preferredPlanId ?? workspace?.currentPlan.planId
    const refreshed = await api.getWorkspace(projectId, resolvedPlanId)
    hydrate(refreshed)
    resetPlanNameDrafts(refreshed.projectPlans)
    await onRefresh()
    return refreshed
  }

  async function savePlanName(plan: ProjectPlan) {
    if (!workspace) return
    const name = planNameDrafts[plan.planId]?.trim()
    if (!name || name === plan.name) return
    setBusy(true)
    try {
      if (dirty) await save(false)
      await api.updatePlan(projectId, plan.planId, { name })
      await refreshPlanManagement(workspace.currentPlan.planId)
      setMessage('方案名称已更新')
      setEditingPlanNameId('')
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '方案更新失败') }
    finally { setBusy(false) }
  }

  async function archiveManagedPlan(plan: ProjectPlan) {
    if (!workspace || !await dialog.confirm({ title: `归档“${plan.name}”？`, message: '方案配置和历史结果会保留，之后可以恢复。', tone: 'warning', confirmLabel: '归档' })) return
    setBusy(true)
    try {
      if (dirty) await save(false)
      await api.archivePlan(projectId, plan.planId)
      const next = await refreshPlanManagement(plan.planId === workspace.currentPlan.planId ? null : workspace.currentPlan.planId)
      if (plan.planId === workspace.currentPlan.planId) onNavigate(planPath(view, next.currentPlan.planId))
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '方案归档失败') }
    finally { setBusy(false) }
  }

  async function restoreArchivedPlan(targetPlanId: string) {
    setBusy(true)
    try {
      if (dirty) await save(false)
      await api.restorePlan(projectId, targetPlanId)
      await refreshPlanManagement(workspace?.currentPlan.planId)
      setMessage('方案已恢复')
    }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '方案恢复失败') }
    finally { setBusy(false) }
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

  function addLine(category: ForecastCategory) {
    if (!workspace || projectPeriods.length === 0) return
    const id = `draft-${crypto.randomUUID()}`
    const periods = category === 'cash_inflow' || category === 'cash_outflow' ? cashPeriods : projectPeriods
    const line: ForecastLineDraft = {
      id,
      code: nextCode('LINE', lines.map((item) => item.code)),
      name: category === 'revenue' ? '新增收入项' : category === 'cost' ? '新增成本项' : category === 'cash_inflow' ? '新增收款项' : '新增付款项',
      category,
      metricCode: category === 'cash_inflow' || category === 'cash_outflow' ? category : undefined,
      forecastMethod: 'fixed_monthly',
      startPeriod: periods[0], endPeriod: periods[periods.length - 1],
      fixedMonthlyValue: '', formulaExpression: '',
      amountBasis: category === 'revenue' || category === 'cost' ? 'tax_exclusive' : 'non_taxable',
      taxRate: '0', assumption: '', sortOrder: lines.length + 1, monthlyValues: {},
    }
    setLines((current) => [...current, line])
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
    if (rule) setCashRules((current) => [...current, { ...rule, id: undefined, sourceLineId: id, sourceLineCode: code, installments: rule.installments.map((item) => ({ ...item, id: undefined })), monthlyValues: { ...rule.monthlyValues } }])
    setSelectedParameterId('')
    setSelectedLineId(id); markDirty()
  }

  async function removeLine(lineId = selectedLineId) {
    const target = lines.find((item) => item.id === lineId)
    if (!target || !await dialog.confirm({
      title: '删除预测项？',
      message: `确定删除“${target.name}”？关联的收付款规则和人工调整记录也会一并移除。`,
      tone: 'danger',
      confirmLabel: '删除预测项',
    })) return
    setLines((current) => current.filter((item) => item.id !== target.id))
    setCashRules((current) => current.filter((item) => item.sourceLineCode !== target.code))
    if (selectedLineId === target.id) setSelectedLineId('')
    markDirty()
  }

  function updateModelMonthly(changes: FinancialGridChange[]) {
    if (changes.length === 0) return
    const changesByRow = new Map<string, FinancialGridChange[]>()
    changes.forEach((change) => changesByRow.set(change.rowId, [...(changesByRow.get(change.rowId) ?? []), change]))
    setParameters((current) => current.map((parameter) => {
      const rowChanges = changesByRow.get(parameter.id ?? '')
      if (!rowChanges || parameter.parameterType !== 'monthly') return parameter
      const monthlyValues = { ...parameter.monthlyValues }
      rowChanges.forEach((change) => { if (change.value) monthlyValues[change.period] = change.value; else delete monthlyValues[change.period] })
      return { ...parameter, monthlyValues }
    }))
    setLines((current) => current.map((line) => {
      const rowChanges = changesByRow.get(line.id ?? '')
      if (!rowChanges || line.forecastMethod !== 'monthly_input') return line
      const monthlyValues = { ...line.monthlyValues }
      rowChanges.forEach((change) => { if (change.value) monthlyValues[change.period] = change.value; else delete monthlyValues[change.period] })
      return { ...line, monthlyValues }
    }))
    setCashRules((current) => current.map((rule) => {
      const rowChanges = changesByRow.get(`cash-plan:${rule.sourceLineId}`)
      if (!rowChanges || rule.method !== 'manual_monthly') return rule
      const monthlyValues = { ...rule.monthlyValues }
      rowChanges.forEach((change) => { if (change.value) monthlyValues[change.period] = change.value; else delete monthlyValues[change.period] })
      return { ...rule, monthlyValues }
    }))
    markDirty()
  }

  function editCalculation(changes: FinancialGridChange[]) {
    if (!report) return
    const breakdown = new Map(report.lineBreakdown.map((item) => [item.lineId, item]))
    const next = [...adjustments]
    let hasChange = false
    changes.forEach((change) => {
      const index = next.findIndex((item) => item.forecastLineId === change.rowId && item.period === change.period)
      const original = breakdown.get(change.rowId)?.values.find((item) => item.period === change.period)?.value ?? '0'
      if (!change.value || new Decimal(change.value || 0).equals(original)) {
        if (index >= 0) { next.splice(index, 1); hasChange = true }
      } else if (index >= 0) {
        if (!new Decimal(next[index].adjustedValue).equals(change.value)) {
          next[index] = { ...next[index], adjustedValue: change.value }
          hasChange = true
        }
      } else {
        const line = breakdown.get(change.rowId)
        if (!line) return
        next.push({ forecastLineId: change.rowId, period: change.period, metricCode: line.metricCode, adjustedValue: change.value, reason: '计算底稿人工调整' })
        hasChange = true
      }
    })
    if (hasChange) { setAdjustments(next); setAdjustmentsDirty(true); onDirtyChange(true) }
  }

  async function saveAdjustments() {
    if (!workspace || !report?.calculationState) return
    setBusy(true); setMessage('')
    try {
      await api.saveAdjustments(projectId, workspace.currentPlan.planId, {
        expectedResultRevision: report.calculationState.resultRevision,
        adjustments,
      })
      const nextReport = await api.report(projectId, workspace.currentPlan.planId)
      setReport(nextReport)
      setAdjustments(nextReport.adjustments.map((item) => ({ id: item.id, forecastLineId: item.forecastLineId, period: item.period, metricCode: item.metricCode, adjustedValue: item.adjustedValue, reason: item.reason })))
      setAdjustmentsDirty(false)
      onDirtyChange(dirty)
      setMessage('底稿调整已保存，报告与项目报表已更新')
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '底稿调整保存失败') }
    finally { setBusy(false) }
  }

  if (!workspace || !projectDraft) return <section className="loading-card">正在加载项目工作区…</section>

  const previewHasErrors = livePreview.issues.some((issue) => issue.severity === 'error')
  const statusText = previewHasErrors
    ? '预览存在错误，上次结果仍有效'
    : dirty
      ? '实时预览，尚未保存'
      : workspace.forecast.calculationState?.lastSuccessAt
        ? workspace.forecast.isResultCurrent ? '结果与当前配置一致' : '已保存，等待计算'
        : '已保存，等待计算'
  const departmentName = snapshot.departments.find((item) => item.id === projectDraft.departmentId)?.name ?? '未选择申报部门'
  const currentPlanId = workspace.currentPlan.planId
  const planPath = (targetView: WorkspaceView, targetVersionId = currentPlanId) =>
    `/projects/${projectId}/${targetView}?planId=${encodeURIComponent(targetVersionId)}`
  const categoryOrder: ForecastCategory[] = ['revenue', 'cost', 'cash_inflow', 'cash_outflow']
  const orderedLines = [...lines].sort((left, right) => {
    const categoryDifference = categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category)
    return categoryDifference || left.sortOrder - right.sortOrder
  })
  type ModelRowItem = { id: string; kind: 'parameter' | ForecastCategory | 'cash_plan_inflow' | 'cash_plan_outflow'; parameter?: ProjectParameterDraft; line?: ForecastLineDraft; cashRule?: CashRuleDraft; parentLine?: ForecastLineDraft }
  const modelRows: ModelRowItem[] = [
    ...[...parameters].sort((left, right) => left.sortOrder - right.sortOrder).map((parameter) => ({ id: parameter.id ?? '', kind: 'parameter' as const, parameter })),
    ...orderedLines.flatMap((line): ModelRowItem[] => {
      const base: ModelRowItem = { id: line.id ?? '', kind: line.category, line }
      if (line.category !== 'revenue' && line.category !== 'cost') return [base]
      const cashRule = cashRules.find((rule) => rule.sourceLineCode === line.code)
      if (!cashRule || cashRule.method === 'disabled') return [base]
      return [base, {
        id: `cash-plan:${line.id}`,
        kind: line.category === 'revenue' ? 'cash_plan_inflow' : 'cash_plan_outflow',
        cashRule,
        parentLine: line,
      }]
    }),
  ]
  const typeLabels: Record<ModelRowItem['kind'], string> = {
    parameter: '参数', revenue: '收入', cost: '成本', cash_inflow: '其他收入', cash_outflow: '其他付款', cash_plan_inflow: '收款', cash_plan_outflow: '付款',
  }
  const previewValuesByLine = new Map<string, Record<string, string>>()
  livePreview.values.forEach((item) => {
    const values = previewValuesByLine.get(item.lineId) ?? {}
    values[item.period] = item.value
    previewValuesByLine.set(item.lineId, values)
  })
  const previewCashValuesByLine = new Map<string, Record<string, string>>()
  livePreview.cashValues.forEach((item) => {
    const values = previewCashValuesByLine.get(item.sourceLineId) ?? {}
    values[item.settlementPeriod] = new Decimal(values[item.settlementPeriod] ?? 0).plus(item.value).toString()
    previewCashValuesByLine.set(item.sourceLineId, values)
  })
  const previewIssuesByLine = new Map<string, string[]>()
  livePreview.issues.forEach((issue) => {
    if (!issue.lineId) return
    previewIssuesByLine.set(issue.lineId, [...(previewIssuesByLine.get(issue.lineId) ?? []), issue.message])
  })
  return <main className="workspace semantic-workspace">
    <div className="workspace-head unified-workspace-head">
      <div className="workspace-heading project-inline-heading">
        <PageBreadcrumbs back={{ label: '返回', onClick: () => onNavigate('/projects') }} items={[{ label: projectDraft.name }]} />
      </div>
      <div className="workspace-tabs">
        <button className={view === 'config' ? 'workspace-tab active' : 'workspace-tab'} onClick={() => onNavigate(planPath('config'))}><Calculator size={14} />项目配置</button>
        <button className={view === 'calculation' ? 'workspace-tab active' : 'workspace-tab'} onClick={() => onNavigate(planPath('calculation'))}><TableProperties size={14} />计算底稿</button>
        <button className={view === 'report' ? 'workspace-tab active' : 'workspace-tab'} onClick={() => onNavigate(planPath('report'))}><FileChartColumn size={14} />项目报告</button>
      </div>
      <div className="workspace-head-actions">
        <button className="btn" onClick={() => setGuideOpen(true)}>操作指引</button>
        <span className="workspace-guide-separator" aria-hidden="true" />
        <span className={`workspace-save-state ${dirty || adjustmentsDirty ? 'dirty' : ''}`}>{view === 'calculation' && adjustmentsDirty ? '调整未保存' : statusText}</span>
        {view === 'config' && <><button className="btn" disabled={busy || !dirty} onClick={() => void saveFromToolbar()}><Save size={14} />保存</button><button className="btn primary" disabled={busy} onClick={() => void calculate()}><Calculator size={14} />计算</button></>}
        {view === 'calculation' && <button className="btn primary" disabled={busy || !adjustmentsDirty} onClick={() => void saveAdjustments()}><Save size={14} />保存调整</button>}
      </div>
    </div>
    <div className="project-plan-bar">
      <span className="project-plan-label">测算方案</span>
      <div className="project-plan-select-wrap" ref={createPlanMenuRef}>
        <select aria-label="切换测算方案" value={currentPlanId} onChange={(event) => {
          const targetPlanId = event.target.value
          if (targetPlanId === '__create__') {
            setVersionMemberId(`方案 ${workspace.projectPlans.length + 1}`)
            setVersionMenuOpen(true)
            return
          }
          if (targetPlanId === currentPlanId) return
          setVersionMenuOpen(false)
          onNavigate(planPath(view, targetPlanId))
        }}>
          {workspace.projectPlans.filter((item) => item.status === 'active').map((item) => <option key={item.planId} value={item.planId}>{item.name}</option>)}
          <option value="__create__">＋ 新建方案</option>
        </select>
        {versionMenuOpen && <div className="project-plan-popover">
          <label>方案名称<input autoFocus value={versionMemberId} onChange={(event) => setVersionMemberId(event.target.value)} /></label>
          <p>选择创建方式</p>
          <div><button className="btn" onClick={() => setVersionMenuOpen(false)}>取消</button><button className="btn" disabled={busy || !versionMemberId.trim()} onClick={() => void createVersion(false)}>空白方案</button><button className="btn primary" disabled={busy || !versionMemberId.trim()} onClick={() => void createVersion(true)}><Copy size={13} />复制当前</button></div>
        </div>}
      </div>
      <div className="project-plan-create">
        <button className="btn" onClick={() => {
          setVersionMenuOpen(false)
          resetPlanNameDrafts(workspace.projectPlans)
          setEditingPlanNameId('')
          setPlanManageOpen(true)
        }}><Settings size={14} />方案管理</button>
        <button className="btn" onClick={() => onNavigate(`/multidimensional?compareProjectId=${encodeURIComponent(projectId)}`)}><ChartNoAxesCombined size={14} />方案对比</button>
      </div>
      <span className="project-plan-context">场景：基准场景</span>
    </div>
    {planManageOpen && <div className="modal-backdrop plan-management-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPlanManageOpen(false) }}>
      <section className="modal-card plan-management-modal" role="dialog" aria-modal="true" aria-labelledby="plan-management-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header"><div><h2 id="plan-management-title">方案管理</h2><p>{workspace.projectPlans.length} 个方案，当前使用“{workspace.currentPlan.name}”</p></div><button className="icon-button" aria-label="关闭方案管理" onClick={() => setPlanManageOpen(false)}><X size={16} /></button></header>
        <div className="plan-management-table-wrap"><table className="plan-management-table"><thead><tr><th>方案名称</th><th>状态</th><th>方案期间</th><th>修订</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{workspace.projectPlans.map((plan) => {
          const nameDraft = planNameDrafts[plan.planId] ?? plan.name
          const activeCount = workspace.projectPlans.filter((item) => item.status === 'active').length
          const canArchive = plan.status === 'active' && activeCount > 1
          return <tr key={plan.planId} className={plan.planId === workspace.currentPlan.planId ? 'current' : ''}>
            <td><div className={`plan-name-editor ${editingPlanNameId === plan.planId ? 'editing' : ''}`}>
              {editingPlanNameId === plan.planId ? <div className="plan-name-input-wrap"><input autoFocus aria-label={`${plan.name}方案名称`} value={nameDraft} onChange={(event) => setPlanNameDrafts((current) => ({ ...current, [plan.planId]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') void savePlanName(plan); if (event.key === 'Escape') { setPlanNameDrafts((current) => ({ ...current, [plan.planId]: plan.name })); setEditingPlanNameId('') } }} /><div className="plan-name-input-actions"><button aria-label="确认修改方案名称" disabled={busy || !nameDraft.trim() || nameDraft.trim() === plan.name} onClick={() => void savePlanName(plan)}><Check size={14} /></button><button aria-label="取消修改方案名称" onClick={() => { setPlanNameDrafts((current) => ({ ...current, [plan.planId]: plan.name })); setEditingPlanNameId('') }}><X size={14} /></button></div></div> : <div className="plan-name-readonly"><b>{plan.name}</b><button aria-label={`修改${plan.name}名称`} onClick={() => { setPlanNameDrafts((current) => ({ ...current, [plan.planId]: plan.name })); setEditingPlanNameId(plan.planId) }}><Pencil size={13} /></button></div>}
              <span>{plan.planId === workspace.currentPlan.planId ? '当前使用' : ''}</span>
            </div></td>
            <td><span className={`plan-status ${plan.status}`}>{plan.status === 'active' ? '可用' : '已归档'}</span></td>
            <td>{plan.startPeriod} 至 {plan.endPeriod}</td><td>R{plan.draftRevision}</td><td>{new Date(plan.updatedAt).toLocaleDateString('zh-CN')}</td>
            <td><div className="plan-row-actions">{plan.status === 'active' ? <button className="action-link danger-action" disabled={busy || !canArchive} title={!canArchive ? '至少保留一个有效方案' : ''} onClick={() => void archiveManagedPlan(plan)}>归档</button> : <button className="action-link" disabled={busy} onClick={() => void restoreArchivedPlan(plan.planId)}>恢复</button>}</div></td>
          </tr>
        })}</tbody></table></div>
        <footer className="modal-actions"><button className="btn" onClick={() => setPlanManageOpen(false)}>关闭</button></footer>
      </section>
    </div>}
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
              <button className={`btn toolbar-menu-trigger ${createMenu === 'cash' ? 'active' : ''}`} onClick={() => setCreateMenu((current) => current === 'cash' ? '' : 'cash')}><Plus size={14} />其他现金<ChevronDown size={13} /></button>
              {createMenu === 'cash' && <div className="toolbar-create-popover"><button onClick={() => { addLine('cash_inflow'); setCreateMenu('') }}><span className="create-type-dot cash-inflow" />其他收款</button><button onClick={() => { addLine('cash_outflow'); setCreateMenu('') }}><span className="create-type-dot cash-outflow" />其他付款</button></div>}
            </div>
          </div>
          <div className="planning-grid-stage unified-preview-grid">
            <FinancialGrid
              ariaLabel="统一行项目分月预览"
              labelColumnTitle="预测项"
              labelColumnWidth={360}
              periods={cashPeriods}
              activeRowId={selectedParameterId || selectedLineId}
              rows={modelRows.map((item) => {
                if (item.parameter) return {
                  id: item.id,
                  label: item.parameter.name,
                  editable: item.parameter.parameterType === 'monthly',
                  editablePeriods: item.parameter.parameterType === 'monthly' ? new Set(projectPeriods) : undefined,
                  values: item.parameter.parameterType === 'fixed' ? Object.fromEntries(projectPeriods.map((period) => [period, item.parameter?.fixedValue ?? ''])) : item.parameter.monthlyValues,
                }
                if (item.cashRule && item.parentLine) {
                  const manual = item.cashRule.method === 'manual_monthly'
                  return {
                    id: item.id,
                    label: `${item.parentLine.name}${item.parentLine.category === 'revenue' ? '收款计划' : '付款计划'}`,
                    editable: manual,
                    editablePeriods: manual ? new Set(cashPeriods) : undefined,
                    values: manual ? item.cashRule.monthlyValues : previewCashValuesByLine.get(item.parentLine.id ?? '') ?? {},
                  }
                }
                const line = item.line as ForecastLineDraft
                const isMonthlyInput = line.forecastMethod === 'monthly_input'
                return {
                  id: item.id,
                  label: line.name,
                  editable: isMonthlyInput,
                  editablePeriods: isMonthlyInput ? new Set(cashPeriods.filter((period) => period >= line.startPeriod && period <= line.endPeriod)) : undefined,
                  values: isMonthlyInput ? line.monthlyValues : previewIssuesByLine.has(item.id) ? {} : previewValuesByLine.get(item.id) ?? {},
                }
              })}
              onChange={updateModelMonthly}
              onRowActivate={(rowId) => {
                const item = modelRows.find((candidate) => candidate.id === rowId)
                if (item?.parameter) { setSelectedLineId(''); setSelectedParameterId(rowId) }
                else { setSelectedParameterId(''); setSelectedLineId(item?.parentLine?.id ?? rowId) }
              }}
              renderRowLabel={(row) => {
                const item = modelRows.find((candidate) => candidate.id === row.id)
                const typeTag = item ? <span className={`model-type-tag ${item.kind.replaceAll('_', '-')}`}>{typeLabels[item.kind]}</span> : null
                if (item?.parameter) return <div className="model-row-content"><button className="model-row-summary"><span className="model-row-title-line">{typeTag}<b>{item.parameter.name}</b></span><span>{item.parameter.code} · {item.parameter.parameterType === 'fixed' ? `全期固定 · ${item.parameter.fixedValue || '未填写'} ${item.parameter.unit}` : `逐月填写 · ${Object.keys(item.parameter.monthlyValues).length}/${projectPeriods.length} 月已填`}</span></button><div className="model-row-actions"><button title="复制参数" aria-label={`复制${item.parameter.name}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); duplicateParameter(item.id) }}><Copy size={15} /></button><button title="删除参数" aria-label={`删除${item.parameter.name}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); removeParameter(item.id) }}><Trash2 size={15} /></button></div></div>
                if (item?.cashRule && item.parentLine) return <div className="model-row-content cash-plan-row-content"><button className="model-row-summary"><span className="model-row-title-line">{typeTag}<b>{item.parentLine.name} · {item.parentLine.category === 'revenue' ? '收款计划' : '付款计划'}</b></span><span>{item.parentLine.code} · {item.cashRule.method === 'manual_monthly' ? `逐月指定 · ${Object.keys(item.cashRule.monthlyValues).length} 个月已填` : item.cashRule.method === 'delayed' ? `自动生成 · 延后 ${item.cashRule.delayMonths} 个月` : item.cashRule.method === 'installment' ? '自动生成 · 分期收付' : '自动生成 · 当月收付'}</span></button></div>
                const line = item?.line
                if (!line) return row.label
                const rule = cashRules.find((candidate) => candidate.sourceLineCode === line.code)
                const method = line.forecastMethod === 'fixed_monthly' ? `${line.fixedMonthlyValue || '未填写'} 元/月` : line.forecastMethod === 'formula' ? formulaSummary(line.formulaExpression, parameters, lines) : `${Object.keys(line.monthlyValues).length} 个月已填`
                const metricPath = line.metricCode ? metricPathLabel(line.metricCode) : ''
                const settlement = line.category === 'revenue' || line.category === 'cost' ? ` · ${line.amountBasis === 'tax_inclusive' ? '含税' : line.amountBasis === 'non_taxable' ? '免税' : '未税'} ${line.taxRate || 0}% · ${rule?.method === 'delayed' ? `延后${rule.delayMonths}月` : rule?.method === 'installment' ? '分期收付' : rule?.method === 'manual_monthly' ? '逐月指定收付' : rule?.method === 'disabled' || !rule ? '不生成现金' : '当月收付'}` : ''
                const issue = previewIssuesByLine.get(item.id)?.[0]
                return <div className="model-row-content"><button className="model-row-summary"><span className="model-row-title-line">{typeTag}<b>{line.name}</b></span><span className={issue ? 'preview-line-error' : ''}>{line.code}{metricPath ? ` · ${metricPath}` : ''} · {issue ? `预览错误：${issue}` : `${forecastSchemeLabel(line)} · ${method}${settlement}`}</span></button><div className="model-row-actions"><button title="复制预测项" aria-label={`复制${line.name}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); duplicateLine(item.id) }}><Copy size={15} /></button><button title="删除预测项" aria-label={`删除${line.name}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); removeLine(item.id) }}><Trash2 size={15} /></button></div></div>
              }}
              toolbarPlacement="bottom"
            />
          </div>
        </section>
      </div>
      {selectedParameter && <ParameterLineEditor parameter={selectedParameter} onPatch={(patch) => patchParameter(selectedParameter.id ?? '', patch)} onClose={() => setSelectedParameterId('')} />}
      {selectedLine && <LineEditor key={selectedLine.id} line={selectedLine} periods={selectedLine.category === 'cash_inflow' || selectedLine.category === 'cash_outflow' ? cashPeriods : projectPeriods} parameters={parameters} lines={lines} cashRule={cashRules.find((rule) => rule.sourceLineCode === selectedLine.code)} onPatch={(patch) => patchLine(selectedLine.id ?? '', patch)} onCashRuleChange={(rule) => { setCashRules((current) => current.some((item) => item.sourceLineCode === rule.sourceLineCode) ? current.map((item) => item.sourceLineCode === rule.sourceLineCode ? rule : item) : [...current, rule]); markDirty() }} onClose={() => setSelectedLineId('')} />}
    </div>}

    {view === 'calculation' && <div className="workspace-view calculation-sheet-view">
      {!report?.hasFacts ? <div className="empty-report-card"><h2>当前项目尚无成功计算结果</h2><p>请先在项目配置中维护预测行并点击“计算”。</p></div> : <>
        {adjustmentsDirty && <div className="page-alert">人工调整尚未保存；保存后会立即更新汇总和报告，无需重新计算。</div>}
        <CalculationBaseGrid report={report} adjustments={adjustments} onChange={editCalculation} onClearOverride={(rowId, period) => { setAdjustments((current) => current.filter((item) => !(item.forecastLineId === rowId && item.period === period))); setAdjustmentsDirty(true); onDirtyChange(true) }} />
      </>}
    </div>}

    {view === 'report' && <ProjectReportView
      report={report}
      onExport={(taxBasis, displayUnit) => void api.exportReport(projectId, workspace.currentPlan.planId, taxBasis, displayUnit).catch((reason) => setMessage(reason instanceof Error ? reason.message : 'Excel 导出失败'))}
      onOpenAi={() => setAiMaterialOpen(true)}
    />}
    {guideOpen && <ProjectGuideModal onClose={() => setGuideOpen(false)} />}
    {aiMaterialOpen && <AiAnalysisMaterialModal api={api} projectId={projectId} planId={workspace.currentPlan.planId} onClose={() => setAiMaterialOpen(false)} />}
  </main>
}

function ParameterLineEditor({ parameter, onPatch, onClose }: {
  parameter: ProjectParameterDraft
  onPatch: (patch: Partial<ProjectParameterDraft>) => void
  onClose: () => void
}) {
  const [editingTitle, setEditingTitle] = useState(false)
  return <aside className="forecast-editor compact-line-editor parameter-line-editor">
    <div className="editor-head"><div>{editingTitle ? <input className="drawer-title-input" value={parameter.name} autoFocus onChange={(event) => onPatch({ name: event.target.value })} onBlur={() => setEditingTitle(false)} onKeyDown={(event) => { if (event.key === 'Enter') setEditingTitle(false) }} /> : <button className="drawer-title-button" onClick={() => setEditingTitle(true)} title="点击编辑名称"><b>{parameter.name}</b></button>}<small>{parameter.code}</small></div><div className="editor-head-actions"><button className="icon-button" aria-label="关闭参数配置" onClick={onClose}><X size={15} /></button></div></div>
    <div className="editor-form compact-editor-form">
      <div className="drawer-section-title full-field">基本信息</div>
      <label>录入方式<select value={parameter.parameterType} onChange={(event) => onPatch({ parameterType: event.target.value as ProjectParameterDraft['parameterType'] })}><option value="fixed">全期固定</option><option value="monthly">逐月填写</option></select></label>
      <label>数值类型<select value={parameter.valueType} onChange={(event) => onPatch({ valueType: event.target.value as ProjectParameterDraft['valueType'] })}><option value="currency">金额</option><option value="quantity">数量</option><option value="percentage">比例</option><option value="number">普通数值</option></select></label>
      <label className="full-field">单位<input value={parameter.unit} onChange={(event) => onPatch({ unit: event.target.value })} /></label>
      <div className="drawer-section-title full-field">参数取值</div>
      {parameter.parameterType === 'fixed' && <label className="full-field">全期值<input value={parameter.fixedValue ?? ''} onChange={(event) => onPatch({ fixedValue: event.target.value })} /></label>}
      {parameter.parameterType === 'monthly' && <div className="drawer-monthly-hint full-field"><b>逐月数值在左侧表格录入</b><span>黄色单元格可直接编辑，也可从 Excel 批量粘贴。</span></div>}
      <div className="drawer-section-title full-field">说明</div>
      <label className="full-field">参数说明<textarea value={parameter.description} onChange={(event) => onPatch({ description: event.target.value })} /></label>
    </div>
  </aside>
}

function LineEditor({ line, periods, parameters, lines, cashRule, onPatch, onCashRuleChange, onClose }: { line: ForecastLineDraft; periods: string[]; parameters: ProjectParameterDraft[]; lines: ForecastLineDraft[]; cashRule?: CashRuleDraft; onPatch: (patch: Partial<ForecastLineDraft>) => void; onCashRuleChange: (rule: CashRuleDraft) => void; onClose: () => void }) {
  const [editingTitle, setEditingTitle] = useState(false)
  const isProfit = line.category === 'revenue' || line.category === 'cost'
  const scheme = forecastScheme(line)
  const baseCashRule: CashRuleDraft = cashRule ?? { sourceLineId: line.id, sourceLineCode: line.code ?? '', method: 'disabled', delayMonths: 0, installments: [], monthlyValues: {} }
  return <aside className="forecast-editor compact-line-editor"><div className="editor-head"><div>{editingTitle ? <input className="drawer-title-input" value={line.name} autoFocus onChange={(event) => onPatch({ name: event.target.value })} onBlur={() => setEditingTitle(false)} onKeyDown={(event) => { if (event.key === 'Enter') setEditingTitle(false) }} /> : <button className="drawer-title-button" onClick={() => setEditingTitle(true)} title="点击编辑名称"><b>{line.name}</b></button>}<small>{line.code}</small></div><div className="editor-head-actions"><button className="icon-button" aria-label="关闭配置" onClick={onClose}><X size={15} /></button></div></div>
    <div className="editor-form compact-editor-form">
      <div className="drawer-section-title full-field">基本信息与计算规则</div>
        {isProfit && <label className="full-field">指标分类
          <select value={line.metricCode ?? ''} onChange={(event) => onPatch({ metricCode: event.target.value as ForecastLineDraft['metricCode'] })}>
            <option value="">请选择末级指标</option>
            {line.category === 'revenue'
              ? PROFIT_METRIC_HIERARCHY[0].children.map((metric) => <option key={metric.code} value={metric.code}>{metric.name}</option>)
              : PROFIT_METRIC_HIERARCHY[1].children.map((group) => <optgroup key={group.code} label={group.name}>{group.children.map((metric) => <option key={metric.code} value={metric.code}>{group.name} / {metric.name}</option>)}</optgroup>)}
          </select>
          {line.metricCode && <small className="drawer-field-note">当前路径：{metricPathLabel(line.metricCode)}</small>}
        </label>}
        <label className="full-field">测算方式<select value={scheme} onChange={(e) => onPatch(patchForForecastScheme(line, e.target.value as ForecastScheme, parameters, lines))}><option value="fixed_monthly">固定月金额</option><option value="monthly_input">逐月填写</option>{isProfit && <option value="price_quantity">单价 × 数量</option>}{line.category === 'cost' && <option value="revenue_ratio">按收入比例</option>}<option value="custom_formula">自定义公式</option></select></label>
        <div className="drawer-field-pair full-field"><label>开始期间<select value={line.startPeriod} onChange={(e) => onPatch({ startPeriod: e.target.value })}>{periods.map((period) => <option key={period}>{period}</option>)}</select></label><label>结束期间<select value={line.endPeriod} onChange={(e) => onPatch({ endPeriod: e.target.value })}>{periods.map((period) => <option key={period}>{period}</option>)}</select></label></div>
        {scheme === 'fixed_monthly' && <label className="full-field">每月金额（元）<input value={line.fixedMonthlyValue ?? ''} onChange={(e) => onPatch({ fixedMonthlyValue: e.target.value })} /></label>}
        <ForecastSchemeFields line={line} parameters={parameters} lines={lines} onPatch={onPatch} />
        {scheme === 'custom_formula' && <div className="formula-editor full-field"><div className="formula-editor-title"><span>fx</span><b>公式表达式</b></div><textarea value={line.formulaExpression ?? ''} onChange={(e) => onPatch({ formulaExpression: e.target.value })} placeholder={'PARAM("PAR-001") * PARAM("PAR-002")'} /><div className="formula-business-summary">业务解释：{formulaSummary(line.formulaExpression, parameters, lines)}</div><details><summary>查看可用参数与行项目</summary><small>可用参数：{parameters.map((item) => `${item.name}(${item.code})`).join('、') || '无'}<br />可用行：{lines.filter((item) => item.id !== line.id).map((item) => `${item.name}(${item.code})`).join('、') || '无'}</small></details></div>}
        {scheme === 'monthly_input' && <div className="drawer-monthly-hint full-field"><b>逐月金额在左侧表格录入</b><span>生效期间内的黄色单元格可直接编辑，也可从 Excel 批量粘贴。</span></div>}
      {isProfit && <>
        <div className="drawer-section-title full-field">税与收付款</div>
        <div className="drawer-field-pair full-field">
          <label>金额口径<select value={line.amountBasis} onChange={(e) => onPatch({ amountBasis: e.target.value as ForecastLineDraft['amountBasis'] })}><option value="tax_exclusive">未税</option><option value="tax_inclusive">含税</option><option value="non_taxable">免税</option></select></label>
          <label>税率（%）<input value={line.taxRate ?? '0'} disabled={line.amountBasis === 'non_taxable'} onChange={(e) => onPatch({ taxRate: e.target.value })} /></label>
        </div>
        <small className="drawer-field-note full-field">损益结果统一换算为未税口径。</small>
        <div className="drawer-field-pair full-field">
          <label className={cashRule?.method === 'delayed' ? '' : 'pair-span-all'}>现金生成方式<select value={cashRule?.method ?? 'disabled'} onChange={(e) => { const method = e.target.value as CashRuleDraft['method']; onCashRuleChange({ ...baseCashRule, method, installments: method === 'installment' && baseCashRule.installments.length === 0 ? [{ sequence: 1, offsetMonths: 0, ratio: '50' }, { sequence: 2, offsetMonths: 1, ratio: '50' }] : baseCashRule.installments }) }}><option value="disabled">不生成现金</option><option value="immediate">当月收付</option><option value="delayed">延后N个月</option><option value="installment">分期收付</option><option value="manual_monthly">逐月指定</option></select></label>
          {cashRule?.method === 'delayed' && <label>延后月份<input type="number" min={0} max={36} value={cashRule.delayMonths} onChange={(e) => onCashRuleChange({ ...cashRule, delayMonths: Number(e.target.value) })} /></label>}
        </div>
        {cashRule?.method === 'installment' && <div className="compact-installment-editor full-field">
          <div className="compact-installment-head"><b>分期计划</b><button type="button" onClick={() => onCashRuleChange({ ...cashRule, installments: [...cashRule.installments, { sequence: cashRule.installments.length + 1, offsetMonths: cashRule.installments.length, ratio: '' }] })}><Plus size={13} />增加一期</button></div>
          {cashRule.installments.map((item, index) => <div className="compact-installment-row" key={item.id ?? index}><span>第 {index + 1} 期</span><label>偏移月<input type="number" min={0} max={36} value={item.offsetMonths} onChange={(event) => onCashRuleChange({ ...cashRule, installments: cashRule.installments.map((current, currentIndex) => currentIndex === index ? { ...current, offsetMonths: Number(event.target.value) } : current) })} /></label><label>比例 %<input value={item.ratio} onChange={(event) => onCashRuleChange({ ...cashRule, installments: cashRule.installments.map((current, currentIndex) => currentIndex === index ? { ...current, ratio: event.target.value } : current) })} /></label><button className="icon-button" aria-label={`删除第${index + 1}期`} onClick={() => onCashRuleChange({ ...cashRule, installments: cashRule.installments.filter((_, currentIndex) => currentIndex !== index).map((current, currentIndex) => ({ ...current, sequence: currentIndex + 1 })) })}><Trash2 size={13} /></button></div>)}
        </div>}
        <small className="drawer-field-note full-field">无法由损益推导的专项资金、保证金等，可在“其他现金”中兜底维护。</small>
        {cashRule?.method === 'manual_monthly' && <div className="drawer-monthly-hint full-field"><b>逐月收付款在左侧子行录入</b><span>对应的收款或付款计划行已变为黄色，可直接编辑或粘贴。</span></div>}
      </>}
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

function ProjectReportView({ report, onExport, onOpenAi }: { report?: ProjectReportDto; onExport: (taxBasis: ReportTaxBasis, displayUnit: ReportDisplayUnit) => void; onOpenAi: () => void }) {
  const [taxBasis, setTaxBasis] = useState<ReportTaxBasis>('tax_exclusive')
  const [displayUnit, setDisplayUnit] = useState<ReportDisplayUnit>('wan')
  const display = useMemo(() => report ? buildReportDisplay(report, taxBasis, displayUnit) : undefined, [report, taxBasis, displayUnit])
  const unitLabel = reportUnitLabel(displayUnit)
  const amountText = (value: string) => formatReportAmount(value, displayUnit)
  const toolbar = <div className="formal-report-toolbar no-print">
    <div className="report-toolbar-title"><b>项目测算分析报告</b></div>
    <div className="report-view-controls">
      <span>结果口径</span><div className="report-toggle-group"><button className={taxBasis === 'tax_inclusive' ? 'active' : ''} onClick={() => setTaxBasis('tax_inclusive')}>含税</button><button className={taxBasis === 'tax_exclusive' ? 'active' : ''} onClick={() => setTaxBasis('tax_exclusive')}>不含税</button></div>
      <span>展示单位</span><div className="report-toggle-group"><button className={displayUnit === 'yuan' ? 'active' : ''} onClick={() => setDisplayUnit('yuan')}>元</button><button className={displayUnit === 'wan' ? 'active' : ''} onClick={() => setDisplayUnit('wan')}>万元</button></div>
    </div>
    <span className="spacer" />{report?.isBehindDraft && <span className="report-stale-tag">配置已变更，当前为最近成功结果</span>}<div className="report-toolbar-actions"><button className="btn" disabled={!report?.hasFacts} onClick={() => onExport(taxBasis, displayUnit)}><Download size={14} />导出 Excel</button><button className="btn" disabled={!report?.hasFacts} onClick={() => window.print()}><Printer size={14} />打印 / PDF</button><button className="btn ai-material-button" onClick={onOpenAi}><Sparkles size={14} />AI 分析素材</button></div>
  </div>
  if (!report?.hasFacts) return <div className="workspace-view formal-report">{toolbar}<div className="empty-report-card"><h2>当前项目尚无报告结果</h2><p>请先保存配置并完成一次计算；AI 分析提示词仍可预览。</p></div></div>
  const { presentation } = report
  if (!display) return null
  const numberText = (value: string, digits = 2) => Number(value).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  const shareText = (value: string | null) => value === null ? '—' : `${new Decimal(value).times(100).toFixed(2)}%`
  const riskNotes = report.riskNotes.map((item) => item.startsWith('预测期内最大垫资')
    ? `预测期内最大垫资为 ${amountText(report.summary.maximumFunding)} ${unitLabel}。`
    : item)
  const largestAnnual = Math.max(1, ...display.annualResults.flatMap((item) => [Math.abs(Number(item.revenue)), Math.abs(Number(item.cost))]))
  const assumptionConfig = (item: ProjectReportDto['presentation']['lineResults'][number]) => {
    if (item.priceOrRatio && item.method === '按收入比例') return `${item.priceOrRatio}% · ${item.months ?? 0} 个月`
    if (item.priceOrRatio && item.quantity) return `${item.priceOrRatio} × ${Number(item.quantity).toLocaleString('zh-CN')} · ${item.months ?? 0} 个月`
    if (item.method === '固定月金额') return `${item.months ?? 0} 个月 · 全期固定`
    return item.methodDescription
  }
  return <div className="workspace-view formal-report">
    {toolbar}
    <section className="report-cover v31-report-cover"><div><span>PROJECT FORECAST REPORT</span><h1>{report.project.name}</h1><p>{report.project.code || '无项目编码'} · {report.department?.name || '未指定申报部门'}</p></div><dl><div><dt>项目周期</dt><dd>{report.plan.startPeriod} 至 {report.operationEndPeriod}</dd></div><div><dt>测算方案</dt><dd>{report.plan.name}</dd></div><div><dt>结果口径</dt><dd>{display.basisLabel} · {unitLabel}</dd></div></dl></section>

    <section className="v31-kpi-grid" aria-label="核心指标">
      <article className="revenue"><span className="v31-kpi-icon"><CircleDollarSign size={17} /></span><div><span>收入</span><strong>{amountText(display.summary.revenue)} <small>{unitLabel}</small></strong><p>项目{display.basisLabel}收入</p></div></article>
      <article className="cost"><span className="v31-kpi-icon"><WalletCards size={17} /></span><div><span>成本</span><strong>{amountText(display.summary.cost)} <small>{unitLabel}</small></strong><p>项目{display.basisLabel}成本</p></div></article>
      <article className="profit"><span className="v31-kpi-icon"><ChartNoAxesCombined size={17} /></span><div><span>利润</span><strong>{amountText(display.summary.grossProfit)} <small>{unitLabel}</small></strong><p>收入减成本</p></div></article>
      <article className="margin"><span className="v31-kpi-icon"><BadgePercent size={17} /></span><div><span>利润率</span><strong>{formatPercent(display.summary.grossMargin)}</strong><p>利润除以收入</p></div></article>
      <article className="roi"><span className="v31-kpi-icon"><ChartNoAxesCombined size={17} /></span><div><span>ROI</span><strong>{formatPercent(display.summary.roi)}</strong><p>利润除以成本</p></div></article>
    </section>

    {display.unitEconomics && <section className="report-section v31-report-section unit-economics-section"><header><div><h2><Users size={16} />单用户单月经营指标</h2><p>按总额除以“{display.unitEconomics.basisName}”的各月合计计算</p></div></header><div className="unit-economics-grid"><article><span>单用户单月收入</span><b>{numberText(display.unitEconomics.revenuePerUnitPeriod)} 元</b></article><article><span>单用户单月成本</span><b>{numberText(display.unitEconomics.costPerUnitPeriod)} 元</b></article><article><span>单用户单月利润</span><b>{numberText(display.unitEconomics.profitPerUnitPeriod)} 元</b></article></div></section>}

    <section className="report-section v31-report-section"><header><div><h2>测算假设</h2><p>关键参数、测算方式与税口径，供审阅复核</p></div></header>
      {presentation.parameterResults.length > 0 && <div className="report-assumption-chips">{presentation.parameterResults.map((item) => <article key={item.code}><span>{item.name}</span><b>{item.inputMode === '全期固定' ? `${item.monthly[0]?.value ?? '—'} ${item.unit}` : `${item.monthly.filter((value) => value.value !== null).length} 个月已填`}</b><small>{item.code} · {item.inputMode}</small></article>)}</div>}
      <div className="report-assumption-table-wrap"><table className="report-assumption-table"><thead><tr><th>类型</th><th>指标分类</th><th>测算项</th><th>测算方式</th><th>主要配置</th><th>税率</th><th>{display.basisLabel}合计（{unitLabel}）</th></tr></thead><tbody>{display.lineResults.filter((item) => item.category === 'revenue' || item.category === 'cost').map((item) => <tr key={item.lineId}><td><span className={`report-line-type ${item.category}`}>{item.category === 'revenue' ? '收入' : '成本'}</span></td><td>{metricPathLabel(item.metricCode)}</td><td><b>{item.name}</b><small>{item.code}</small></td><td>{item.method}</td><td title={item.methodDescription}>{assumptionConfig(item)}</td><td>{new Decimal(item.taxRate).times(100).toFixed(2)}%</td><td>{amountText(item.displayTotal)}</td></tr>)}</tbody></table></div>
    </section>

    <div className="report-composition-grid">
      <section className="report-section v31-report-section"><header><div><h2>收入结构</h2><p>固定按4类收入展示，空分类仍保留</p></div></header><div className="v31-bar-list">{display.revenueMetricGroups.map((item) => <article key={item.metricCode}><div><b>{item.name}</b><span>{amountText(item.amount)} {unitLabel} · {shareText(item.share)}</span></div><div className="v31-bar-track"><i className="income" style={{ width: `${Math.max(0, Number(item.share ?? 0) * 100)}%` }} /></div><small>{item.items.length ? item.items.map((line) => line.name).join('、') : '当前方案暂不涉及该分类'}</small></article>)}</div></section>
      <section className="report-section v31-report-section"><header><div><h2>成本结构</h2><p>按5个成本大类及15个末级分类展示</p></div></header><div className="v31-bar-list metric-tree-report-list">{display.costMetricGroups.map((group) => <article key={group.metricCode} className="report-metric-major-group"><div><b>{group.name}</b><span>{amountText(group.amount)} {unitLabel} · {shareText(group.share)}</span></div><div className="v31-bar-track"><i className="cost" style={{ width: `${Math.max(0, Number(group.share ?? 0) * 100)}%` }} /></div><div className="report-metric-children">{group.children.map((item) => <div key={item.metricCode}><span><b>{item.name}</b><em>{amountText(item.amount)} {unitLabel}</em></span><small>{item.items.length ? item.items.map((line) => line.name).join('、') : '当前方案暂不涉及该分类'}</small></div>)}</div></article>)}</div></section>
    </div>

    <section className="report-section v31-report-section"><header><div><h2>年度收入、成本和利润分布</h2><p>按自然年汇总当前方案的{display.basisLabel}损益结果</p></div></header><div className="annual-report-list">{display.annualResults.map((item) => <article key={item.year}><b>{item.year}<small>年</small></b><div><p><span>收入</span><i className="income" style={{ width: `${Math.abs(Number(item.revenue)) / largestAnnual * 100}%` }} /><em>{amountText(item.revenue)} {unitLabel}</em></p><p><span>成本</span><i className="cost" style={{ width: `${Math.abs(Number(item.cost)) / largestAnnual * 100}%` }} /><em>{amountText(item.cost)} {unitLabel}</em></p></div><aside><strong>{amountText(item.grossProfit)} {unitLabel}</strong><span>利润率 {formatPercent(item.grossMargin)}</span></aside></article>)}</div></section>

    <section className={`report-verdict ${Number(display.summary.grossProfit) < 0 ? 'risk' : 'good'}`}><span>{Number(display.summary.grossProfit) < 0 ? '!' : '✓'}</span><div><h2>{display.conclusionTitle}</h2><p>{display.conclusionDescription}</p>{riskNotes.map((item) => <small key={item}>提示：{item}</small>)}</div></section>
    <section className="report-section v31-report-section report-source-note"><header><div><h2>口径与数据来源</h2></div></header><p>本报告读取当前方案最后一次成功计算形成的最终事实；当前按{display.basisLabel}口径、{unitLabel}展示。人工底稿调整已计入最终事实，但不会反向改变预测项公式或自动收付款计划。</p></section>
  </div>
}

function ProjectGuideModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const steps = [
    { title: '选择测算方案', copy: '先选择要维护的测算方案。每个方案拥有独立的期间、参数、预测项和结果；也可以在方案管理中新增、复制、重命名或归档方案。', image: guideProjectConfig, focus: { left: 13.2, top: 6.2, width: 26, height: 5.8 } },
    { title: '维护项目信息', copy: '点击编辑，维护项目名称、申报部门以及当前方案的开始和结束期间。项目编码由系统生成，不需要手工填写。', image: guideProjectInfo, focus: { left: 13.7, top: 12.5, width: 85.8, height: 14.5 } },
    { title: '设置参数与测算规则', copy: '在行项目表中新增参数、收入、成本或其他现金事项。选中预测项后，在右侧配置测算方式、税口径和收付款规则，左侧分月表会实时预览。', image: guideForecastRule, focus: { left: 70.4, top: 11.2, width: 29, height: 87.8 } },
    { title: '保存并计算', copy: '“保存”只保存项目和预测配置；“计算”会在需要时先保存，再生成当前方案最新的计算底稿和报告结果。', image: guideSaveCalculate, focus: { left: 74.9, top: 1.1, width: 24.3, height: 5.2 } },
    { title: '复核并调整底稿', copy: '计算底稿展示最终采用的分月基础数据。黄色叶子单元格可直接修改或从 Excel 粘贴；保存调整后，项目报告和跨项目报表立即更新，不需要再次计算。', image: guideAdjustmentReport, focus: { left: 35.3, top: 28.3, width: 58.2, height: 6.2 } },
    { title: '查看与下载报告', copy: '进入“项目报告”查看核心指标、结构和年度趋势。报告可切换含税或不含税、元或万元，并按当前视图导出 Excel 或打印为 PDF。', image: guideReportExport, focus: { left: 46.9, top: 13.2, width: 23.2, height: 4.8 } },
    { title: '准备 AI 分析素材', copy: '点击“AI 分析素材”查看并复制固定提示词，下载仅隐藏身份信息的脱敏 Excel，再交给可信的 AI 服务分析。财务金额仍为真实数据，请注意发送范围。', image: guideAiAnalysisMaterial, focus: { left: 16.4, top: 26.9, width: 67.2, height: 55.2 } },
  ]
  const current = steps[step]
  return <div className="modal-backdrop guide-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal-card project-guide-modal" role="dialog" aria-modal="true" aria-label="项目操作指引">
      <header className="modal-header"><div><h2>项目操作指引</h2><p>{step + 1} / {steps.length}</p></div><button className="icon-button" aria-label="关闭操作指引" onClick={onClose}><X size={16} /></button></header>
      <div className="project-guide-content"><div className="guide-illustration"><img src={current.image} alt={`${current.title}页面示例`} /><span className="guide-focus-box" style={{ left: `${current.focus.left}%`, top: `${current.focus.top}%`, width: `${current.focus.width}%`, height: `${current.focus.height}%` }}><b>{step + 1}</b></span></div><div className="guide-copy"><span>第 {step + 1} 步</span><h3>{current.title}</h3><p>{current.copy}</p></div></div>
      <footer className="modal-actions"><button className="btn" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>上一步</button><span className="guide-progress">{steps.map((_, index) => <i key={index} className={index === step ? 'active' : ''} />)}</span>{step < steps.length - 1 ? <button className="btn primary" onClick={() => setStep((value) => value + 1)}>下一步</button> : <button className="btn primary" onClick={onClose}>完成</button>}</footer>
    </section>
  </div>
}
