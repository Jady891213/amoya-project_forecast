import Decimal from 'decimal.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Calculator,
  CircleAlert,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { countPeriods, generatePeriodRange, generatePeriods } from '../../domain/periods'
import type {
  CalculationIssue,
  ForecastCategory,
  ForecastLineDraft,
  ForecastProjectState,
  ForecastProjectDraft,
  Project,
  Department,
  ProjectInput,
  ProjectModule,
  ProjectParameterDraft,
  ParameterValueType,
  CashRuleDraft,
  TaxAmountBasis,
} from '../../domain/types'
import type { DatabaseClient } from '../../storage/types'
import {
  CalculationService,
  previewForecastDraft,
} from '../../services/calculationService'
import { formatWan } from '../../ui/formatters'
import { ProjectInformationEditor } from '../../ui/ProjectInformationEditor'

interface Props {
  database: DatabaseClient
  project: Project
  departments: Department[]
  modules: ProjectModule[]
  onProjectSave: (input: ProjectInput) => Promise<void>
  onCalculated: () => Promise<void>
}

const categoryLabels: Record<ForecastCategory, string> = {
  revenue: '收入',
  cost: '成本',
  cash_inflow: '收款',
  cash_outflow: '付款',
}

const categoryPlaceholders: Record<ForecastCategory, string> = {
  revenue: '例如：云游戏收入',
  cost: '例如：服务器租赁费',
  cash_inflow: '例如：项目回款',
  cash_outflow: '例如：供应商付款',
}

const parameterValueTypeLabels: Record<ParameterValueType, string> = {
  currency: '金额',
  quantity: '数量',
  percentage: '比例',
  number: '普通数值',
}

function nextAvailableCode(
  prefix: 'LINE' | 'PAR',
  codes: Array<string | undefined>,
): string {
  const used = new Set(codes.filter(Boolean))
  let sequence = 1
  while (used.has(`${prefix}-${String(sequence).padStart(3, '0')}`)) {
    sequence += 1
  }
  return `${prefix}-${String(sequence).padStart(3, '0')}`
}

function toDrafts(state: ForecastProjectState): ForecastLineDraft[] {
  const valuesByLine = new Map<string, Record<string, string>>()
  state.values.forEach((value) => {
    const values = valuesByLine.get(value.lineId) ?? {}
    values[value.period] = value.value
    valuesByLine.set(value.lineId, values)
  })
  return state.lines.map((line) => ({
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
    amountBasis: line.amountBasis,
    taxRate: new Decimal(line.taxRate || 0).times(100).toString(),
    assumption: line.assumption,
    sortOrder: line.sortOrder,
    monthlyValues: valuesByLine.get(line.id) ?? {},
  }))
}

function toParameterDrafts(
  state: ForecastProjectState,
): ProjectParameterDraft[] {
  const valuesByParameter = new Map<string, Record<string, string>>()
  state.parameterValues.forEach((value) => {
    const values = valuesByParameter.get(value.parameterId) ?? {}
    const parameter = state.parameters.find(
      (item) => item.id === value.parameterId,
    )
    values[value.period] =
      parameter?.valueType === 'percentage'
        ? new Decimal(value.value).times(100).toString()
        : value.value
    valuesByParameter.set(value.parameterId, values)
  })
  return state.parameters.map((parameter) => ({
    id: parameter.id,
    code: parameter.code,
    name: parameter.name,
    parameterType: parameter.parameterType,
    valueType: parameter.valueType,
    unit: parameter.unit,
    fixedValue:
      parameter.valueType === 'percentage' && parameter.fixedValue
        ? new Decimal(parameter.fixedValue).times(100).toString()
        : parameter.fixedValue ?? '',
    description: parameter.description,
    sortOrder: parameter.sortOrder,
    monthlyValues: valuesByParameter.get(parameter.id) ?? {},
  }))
}

function toCashRuleDrafts(state: ForecastProjectState): CashRuleDraft[] {
  const ruleByLineId = new Map(
    state.cashRules.map((rule) => [rule.sourceLineId, rule]),
  )
  return state.lines
    .filter((line) => line.category === 'revenue' || line.category === 'cost')
    .map((line) => {
      const rule = ruleByLineId.get(line.id)
      return {
        id: rule?.id,
        sourceLineId: line.id,
        sourceLineCode: line.code,
        method: rule?.method ?? 'disabled',
        delayMonths: rule?.delayMonths ?? 0,
        installments:
          rule?.installments.map((item) => ({
            id: item.id,
            sequence: item.sequence,
            offsetMonths: item.offsetMonths,
            ratio: new Decimal(item.ratio).times(100).toString(),
          })) ?? [],
      }
    })
}

function humanFormula(
  expression: string,
  parameters: ProjectParameterDraft[],
  lines: ForecastLineDraft[],
): string {
  const parameterNames = new Map(
    parameters.map((parameter) => [parameter.code, parameter.name]),
  )
  const lineNames = new Map(lines.map((line) => [line.code, line.name]))
  return expression
    .replace(
      /PARAM\(\s*"([^"]+)"\s*\)/gi,
      (_, code: string) => parameterNames.get(code) || code,
    )
    .replace(
      /LINE\(\s*"([^"]+)"\s*\)/gi,
      (_, code: string) => lineNames.get(code) || code,
    )
    .replaceAll('*', ' × ')
    .replaceAll('/', ' ÷ ')
}

function totalValue(
  draft: ForecastLineDraft,
  projectPeriods: string[],
): string {
  if (draft.forecastMethod === 'formula') return '0'
  const start = projectPeriods.indexOf(draft.startPeriod)
  const end = projectPeriods.indexOf(draft.endPeriod)
  if (start < 0 || end < start) return '0'
  try {
    if (draft.forecastMethod === 'fixed_monthly') {
      if (!draft.fixedMonthlyValue?.trim()) return '0'
      return new Decimal(draft.fixedMonthlyValue)
        .times(end - start + 1)
        .toString()
    }
    return projectPeriods
      .slice(start, end + 1)
      .reduce((sum, period) => {
        const rawValue = draft.monthlyValues[period]?.trim()
        return rawValue ? sum.plus(rawValue) : sum
      }, new Decimal(0))
      .toString()
  } catch {
    return '0'
  }
}

function methodSummary(
  draft: ForecastLineDraft,
  projectPeriods: string[],
  parameters: ProjectParameterDraft[] = [],
  lines: ForecastLineDraft[] = [],
): string {
  if (draft.forecastMethod === 'formula') {
    return draft.formulaExpression?.trim()
      ? humanFormula(draft.formulaExpression, parameters, lines)
      : '未配置公式'
  }
  if (draft.forecastMethod === 'fixed_monthly') {
    try {
      return draft.fixedMonthlyValue?.trim()
        ? `${formatWan(draft.fixedMonthlyValue)} 万元/月`
        : '未填写固定月金额'
    } catch {
      return '固定月金额格式错误'
    }
  }
  const start = projectPeriods.indexOf(draft.startPeriod)
  const end = projectPeriods.indexOf(draft.endPeriod)
  const active = start >= 0 && end >= start
    ? projectPeriods.slice(start, end + 1)
    : []
  const filled = active.filter(
    (period) => draft.monthlyValues[period]?.trim(),
  ).length
  return `${active.length}个月已填写 ${filled}个月`
}

export function ForecastConfigPage({
  database,
  project,
  departments,
  modules,
  onProjectSave,
  onCalculated,
}: Props) {
  const service = useMemo(() => new CalculationService(database), [database])
  const projectPeriods = useMemo(
    () => generatePeriodRange(project.startPeriod, project.endPeriod),
    [project.endPeriod, project.startPeriod],
  )
  const cashPeriods = useMemo(
    () => generatePeriods(project.startPeriod, countPeriods(project.startPeriod, project.endPeriod) + 36),
    [project.endPeriod, project.startPeriod],
  )
  const publicModule =
    modules.find((module) => module.isCommon) ?? modules[0]
  const [drafts, setDrafts] = useState<ForecastLineDraft[]>([])
  const [parameterDrafts, setParameterDrafts] = useState<
    ProjectParameterDraft[]
  >([])
  const [cashRuleDrafts, setCashRuleDrafts] = useState<CashRuleDraft[]>([])
  const [activeSection, setActiveSection] = useState<
    'profit' | 'cash' | 'parameters'
  >(
    'profit',
  )
  const [linePanelSection, setLinePanelSection] = useState<'amount' | 'cash'>(
    'amount',
  )
  const [selectedId, setSelectedId] = useState('')
  const [selectedParameterId, setSelectedParameterId] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [issues, setIssues] = useState<CalculationIssue[]>([])
  const [message, setMessage] = useState('')
  const [resultState, setResultState] = useState<ForecastProjectState>()

  const hydrate = useCallback((state: ForecastProjectState, selectedIndex = 0) => {
    const nextDrafts = toDrafts(state)
    const nextParameters = toParameterDrafts(state)
    const nextCashRules = toCashRuleDrafts(state)
    setResultState(state)
    setDrafts(nextDrafts)
    setParameterDrafts(nextParameters)
    setCashRuleDrafts(nextCashRules)
    setSelectedId(nextDrafts[selectedIndex]?.id ?? nextDrafts[0]?.id ?? '')
    setSelectedParameterId(
      nextParameters[0]?.id ?? nextParameters[0]?.code ?? '',
    )
    setDirty(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const state = await service.getProjectState(project.id)
        if (!cancelled) hydrate(state)
      } catch (reason) {
        if (!cancelled) {
          setMessage(reason instanceof Error ? reason.message : '预测配置加载失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [hydrate, project.id, service])

  const selectedIndex = drafts.findIndex((draft) => draft.id === selectedId)
  const selected = selectedIndex >= 0 ? drafts[selectedIndex] : undefined
  const selectedParameterIndex = parameterDrafts.findIndex(
    (parameter) =>
      (parameter.id ?? parameter.code) === selectedParameterId,
  )
  const selectedParameter =
    selectedParameterIndex >= 0
      ? parameterDrafts[selectedParameterIndex]
      : undefined
  const selectedCashRule = selected?.code
    ? cashRuleDrafts.find((rule) => rule.sourceLineCode === selected.code)
    : undefined

  const normalizedLineDrafts = () =>
    drafts.map((draft) => ({
      ...draft,
      taxRate:
        draft.category === 'revenue' || draft.category === 'cost'
          ? new Decimal(draft.taxRate || 0).div(100).toString()
          : '0',
    }))

  const projectDraft = (): ForecastProjectDraft => ({
    lines: normalizedLineDrafts(),
    parameters: parameterDrafts,
    cashRules: cashRuleDrafts.map((rule) => ({
      ...rule,
      installments: rule.installments.map((item) => ({
        ...item,
        ratio: new Decimal(item.ratio || 0).div(100).toString(),
      })),
    })),
  })

  function changeSelected(patch: Partial<ForecastLineDraft>) {
    if (selectedIndex < 0) return
    setDrafts((current) =>
      current.map((draft, index) =>
        index === selectedIndex ? { ...draft, ...patch } : draft,
      ),
    )
    setDirty(true)
    setIssues([])
    setMessage('')
  }

  function addLine(category: ForecastCategory) {
    if (!publicModule) {
      setMessage('当前项目缺少公共业务模块')
      return
    }
    const draft: ForecastLineDraft = {
      id: `draft-${crypto.randomUUID()}`,
      code: nextAvailableCode('LINE', drafts.map((item) => item.code)),
      name: '',
      category,
      businessModuleId: publicModule.id,
      forecastMethod: 'fixed_monthly',
      startPeriod: projectPeriods[0],
      endPeriod: projectPeriods[projectPeriods.length - 1],
      fixedMonthlyValue: '',
      formulaExpression: '',
      amountBasis:
        category === 'revenue' || category === 'cost'
          ? 'tax_exclusive'
          : 'non_taxable',
      taxRate: '0',
      assumption: '',
      sortOrder: drafts.length + 1,
      monthlyValues: {},
    }
    setDrafts((current) => [...current, draft])
    if (category === 'revenue' || category === 'cost') {
      setCashRuleDrafts((current) => [
        ...current,
        {
          sourceLineId: draft.id,
          sourceLineCode: draft.code ?? '',
          method: 'immediate',
          delayMonths: 0,
          installments: [],
        },
      ])
    }
    setSelectedId(draft.id ?? '')
    setDirty(true)
    setIssues([])
  }

  function changeSelectedParameter(patch: Partial<ProjectParameterDraft>) {
    if (selectedParameterIndex < 0) return
    setParameterDrafts((current) =>
      current.map((parameter, index) =>
        index === selectedParameterIndex
          ? { ...parameter, ...patch }
          : parameter,
      ),
    )
    setDirty(true)
    setIssues([])
    setMessage('')
  }

  function changeSelectedCashRule(patch: Partial<CashRuleDraft>) {
    if (!selected?.code) return
    setCashRuleDrafts((current) => {
      const found = current.some(
        (rule) => rule.sourceLineCode === selected.code,
      )
      if (!found) {
        return [
          ...current,
          {
            sourceLineId: selected.id,
            sourceLineCode: selected.code ?? '',
            method: 'disabled',
            delayMonths: 0,
            installments: [],
            ...patch,
          },
        ]
      }
      return current.map((rule) =>
        rule.sourceLineCode === selected.code
          ? { ...rule, ...patch }
          : rule,
      )
    })
    setDirty(true)
    setIssues([])
    setMessage('')
  }

  function addParameter() {
    const code = nextAvailableCode(
      'PAR',
      parameterDrafts.map((parameter) => parameter.code),
    )
    const parameter: ProjectParameterDraft = {
      id: `draft-${crypto.randomUUID()}`,
      code,
      name: '',
      parameterType: 'fixed',
      valueType: 'number',
      unit: '',
      fixedValue: '',
      description: '',
      sortOrder: parameterDrafts.length + 1,
      monthlyValues: {},
    }
    setParameterDrafts((current) => [...current, parameter])
    setSelectedParameterId(parameter.id ?? code)
    setDirty(true)
    setMessage('')
  }

  function removeSelectedParameter() {
    if (selectedParameterIndex < 0 || !selectedParameter) return
    const code = selectedParameter.code ?? ''
    const referencedBy = drafts.find((draft) =>
      new RegExp(
        `PARAM\\(\\s*"${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*\\)`,
        'i',
      ).test(draft.formulaExpression ?? ''),
    )
    if (referencedBy) {
      setMessage(`参数正在被行项目“${referencedBy.name || referencedBy.code}”引用，不能删除`)
      return
    }
    if (!window.confirm(`确认删除参数“${selectedParameter.name || code}”？`)) {
      return
    }
    const next = parameterDrafts.filter(
      (_, index) => index !== selectedParameterIndex,
    )
    setParameterDrafts(next)
    setSelectedParameterId(
      next[Math.min(selectedParameterIndex, next.length - 1)]?.id ??
        next[0]?.code ??
        '',
    )
    setDirty(true)
  }

  function moveSelectedParameter(direction: -1 | 1) {
    if (selectedParameterIndex < 0) return
    const targetIndex = selectedParameterIndex + direction
    if (targetIndex < 0 || targetIndex >= parameterDrafts.length) return
    const next = [...parameterDrafts]
    ;[next[selectedParameterIndex], next[targetIndex]] = [
      next[targetIndex],
      next[selectedParameterIndex],
    ]
    setParameterDrafts(
      next.map((parameter, index) => ({
        ...parameter,
        sortOrder: index + 1,
      })),
    )
    setDirty(true)
  }

  function removeSelected() {
    if (selectedIndex < 0 || !selected) return
    const referencedBy = drafts.find(
      (draft) =>
        draft.id !== selected.id &&
        selected.code &&
        new RegExp(
          `LINE\\(\\s*"${selected.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*\\)`,
          'i',
        ).test(draft.formulaExpression ?? ''),
    )
    if (referencedBy) {
      setMessage(`行项目正在被“${referencedBy.name || referencedBy.code}”引用，不能删除`)
      return
    }
    if (!window.confirm(`确认删除行项目“${selected.name || '未命名行项目'}”？`)) {
      return
    }
    const next = drafts.filter((_, index) => index !== selectedIndex)
    setDrafts(next)
    if (selected.code) {
      setCashRuleDrafts((current) =>
        current.filter((rule) => rule.sourceLineCode !== selected.code),
      )
    }
    setSelectedId(next[Math.min(selectedIndex, next.length - 1)]?.id ?? '')
    setDirty(true)
    setIssues([])
  }

  function moveSelected(direction: -1 | 1) {
    if (selectedIndex < 0) return
    const targetIndex = selectedIndex + direction
    if (targetIndex < 0 || targetIndex >= drafts.length) return
    const next = [...drafts]
    ;[next[selectedIndex], next[targetIndex]] = [
      next[targetIndex],
      next[selectedIndex],
    ]
    setDrafts(next.map((draft, index) => ({ ...draft, sortOrder: index + 1 })))
    setDirty(true)
  }

  async function saveDraftOnly() {
    setSaving(true)
    setIssues([])
    setMessage('')
    try {
      const selectedPosition = Math.max(selectedIndex, 0)
      const state = await service.saveDraft(project.id, projectDraft())
      hydrate(state, selectedPosition)
      setMessage('预测配置草稿已保存')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function saveAndCalculate() {
    setSaving(true)
    setIssues([])
    setMessage('')
    try {
      const result = await service.saveAndCalculate(project.id, projectDraft())
      setIssues(result.issues)
      const state = await service.getProjectState(project.id)
      hydrate(state, Math.max(selectedIndex, 0))
      if (!result.success) {
        setMessage(`计算未通过：发现 ${result.run.issueCount} 个问题`)
        return
      }
      setMessage(
        `计算完成：批次 RUN-${String(result.run.runNumber).padStart(4, '0')}`,
      )
      await onCalculated()
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '计算失败')
    } finally {
      setSaving(false)
    }
  }

  function appendFormulaToken(token: string) {
    if (!selected) return
    const current = selected.formulaExpression?.trim() ?? ''
    changeSelected({
      formulaExpression: current ? `${current} ${token}` : token,
    })
  }

  function applyFormulaTemplate(type: 'price_quantity' | 'line_ratio') {
    if (!selected) return
    if (type === 'price_quantity') {
      const price = parameterDrafts.find((parameter) =>
        /单价|价格|月费/.test(parameter.name),
      )
      const quantity = parameterDrafts.find((parameter) =>
        /数量|用户|客户|户数/.test(parameter.name),
      )
      if (!price?.code || !quantity?.code) {
        setMessage('请先建立名称中包含“单价/价格”和“数量/用户”的项目参数')
        return
      }
      changeSelected({
        formulaExpression: `PARAM("${price.code}") * PARAM("${quantity.code}")`,
      })
      return
    }
    const upstream = drafts.find(
      (draft) =>
        draft.id !== selected.id &&
        draft.category === 'revenue' &&
        draft.code,
    )
    const ratio = parameterDrafts.find(
      (parameter) =>
        parameter.valueType === 'percentage' || /比例|分成/.test(parameter.name),
    )
    if (!upstream?.code || !ratio?.code) {
      setMessage('请先建立一个收入行项目和一个比例参数')
      return
    }
    changeSelected({
      formulaExpression: `LINE("${upstream.code}") * PARAM("${ratio.code}")`,
    })
  }

  const formulaDependencies = selected?.formulaExpression
    ? [
        ...selected.formulaExpression.matchAll(
          /(PARAM|LINE)\(\s*"([^"]+)"\s*\)/gi,
        ),
      ].map((matched) => {
        const code = matched[2].toUpperCase()
        return matched[1].toUpperCase() === 'PARAM'
          ? parameterDrafts.find((parameter) => parameter.code === code)?.name ??
              code
          : drafts.find((draft) => draft.code === code)?.name ?? code
      })
    : []
  const draftPreview = useMemo(
    () =>
      previewForecastDraft(project, modules, {
        lines: normalizedLineDrafts(),
        parameters: parameterDrafts,
        cashRules: cashRuleDrafts.map((rule) => ({
          ...rule,
          installments: rule.installments.map((item) => ({
            ...item,
            ratio: new Decimal(item.ratio || 0).div(100).toString(),
          })),
        })),
      }),
    [cashRuleDrafts, drafts, modules, parameterDrafts, project],
  )
  const selectedPreviewValues = selected
    ? draftPreview.values.filter((value) => value.lineId === selected.id)
    : []
  const selectedPreviewIssues = selected
    ? draftPreview.issues.filter((issue) => issue.lineId === selected.id)
    : []
  const selectedCashPreview = selected
    ? draftPreview.cashValues.filter(
        (value) => value.sourceLineId === selected.id,
      )
    : []
  const visibleDrafts = drafts.filter((draft) =>
    activeSection === 'profit'
      ? draft.category === 'revenue' || draft.category === 'cost'
      : activeSection === 'cash'
        ? draft.category === 'cash_inflow' || draft.category === 'cash_outflow'
        : false,
  )
  const selectedPeriods =
    selected?.category === 'cash_inflow' || selected?.category === 'cash_outflow'
      ? cashPeriods
      : projectPeriods

  function switchSection(section: 'profit' | 'cash' | 'parameters') {
    setActiveSection(section)
    if (section === 'parameters') return
    const first = drafts.find((draft) =>
      section === 'profit'
        ? draft.category === 'revenue' || draft.category === 'cost'
        : draft.category === 'cash_inflow' || draft.category === 'cash_outflow',
    )
    setSelectedId(first?.id ?? '')
    setLinePanelSection('amount')
  }

  if (loading) {
    return <section className="loading-card">正在读取预测配置…</section>
  }

  return (
    <div className="forecast-workspace">
      <ProjectInformationEditor
        project={project}
        departments={departments}
        modules={modules}
        onSave={onProjectSave}
      />
      <div className="forecast-section-tabs">
        <button
          className={activeSection === 'profit' ? 'active' : ''}
          onClick={() => switchSection('profit')}
        >
          损益行项目
          <span>{drafts.filter((item) => item.category === 'revenue' || item.category === 'cost').length}</span>
        </button>
        <button
          className={activeSection === 'cash' ? 'active' : ''}
          onClick={() => switchSection('cash')}
        >
          直接现金计划
          <span>{drafts.filter((item) => item.category === 'cash_inflow' || item.category === 'cash_outflow').length}</span>
        </button>
        <button
          className={activeSection === 'parameters' ? 'active' : ''}
          onClick={() => switchSection('parameters')}
        >
          项目参数
          <span>{parameterDrafts.length}</span>
        </button>
      </div>
      <div className="forecast-toolbar">
        <div className="toolbar-title">
          <Calculator size={16} />
          <div>
            <b>
              {activeSection === 'profit'
                ? '损益行项目'
                : activeSection === 'cash'
                  ? '直接现金计划'
                  : '项目参数'}
            </b>
            <span>
              {activeSection === 'profit'
                ? '维护收入成本、税口径和自动收付款规则'
                : activeSection === 'cash'
                  ? '维护不由损益规则生成的直接收款和付款计划'
                  : '维护公式可引用的固定值和逐月业务参数'}
            </span>
          </div>
        </div>
        <div className="forecast-status">
          {dirty ? (
            <span className="status-warning"><CircleAlert size={13} />配置尚未保存</span>
          ) : resultState?.latestRun ? (
            <span className={resultState.isResultCurrent ? 'status-current' : 'status-warning'}>
              {resultState.isResultCurrent ? '结果与配置一致' : '结果需要重新计算'}
            </span>
          ) : (
            <span className="status-neutral">尚未计算</span>
          )}
        </div>
        <span className="spacer" />
        {activeSection === 'profit' ? (
          <>
            <button className="btn" onClick={() => addLine('revenue')} disabled={saving}>
              <Plus size={14} />新增收入项
            </button>
            <button className="btn" onClick={() => addLine('cost')} disabled={saving}>
              <Plus size={14} />新增成本项
            </button>
          </>
        ) : activeSection === 'cash' ? (
          <>
            <button className="btn" onClick={() => addLine('cash_inflow')} disabled={saving}>
              <Plus size={14} />新增收款项
            </button>
            <button className="btn" onClick={() => addLine('cash_outflow')} disabled={saving}>
              <Plus size={14} />新增付款项
            </button>
          </>
        ) : (
          <button className="btn" onClick={addParameter} disabled={saving}>
            <Plus size={14} />新增项目参数
          </button>
        )}
        <button className="btn" onClick={() => void saveDraftOnly()} disabled={saving || !dirty}>
          <Save size={14} />保存草稿
        </button>
        <button className="btn primary" onClick={() => void saveAndCalculate()} disabled={saving}>
          <Calculator size={14} />保存并计算
        </button>
      </div>

      {(message || issues.length > 0) && (
        <div className={`forecast-message ${issues.some((issue) => issue.severity === 'error') ? 'error' : ''}`}>
          <span>{message}</span>
          {issues.slice(0, 3).map((issue, index) => (
            <span key={`${issue.lineId}-${issue.period}-${index}`}>
              {issue.severity === 'warning' ? '提示' : '错误'}：{issue.message}
            </span>
          ))}
          {issues.length > 3 && <span>另有 {issues.length - 3} 个问题</span>}
        </div>
      )}

      {activeSection !== 'parameters' ? (
      <div className={`forecast-editor ${selected ? 'panel-open' : ''}`}>
        <section className="forecast-table-panel">
          <table className="forecast-table">
            <thead>
              <tr>
                <th style={{ width: 72 }}>分类</th>
                <th style={{ width: 190 }}>行项目名称</th>
                <th style={{ width: 130 }}>业务模块</th>
                <th style={{ width: 120 }}>预测方式</th>
                <th>主要配置</th>
                <th style={{ width: 145 }}>生效期间</th>
                <th style={{ width: 110 }}>预测合计</th>
                <th style={{ width: 90 }}>完整性</th>
              </tr>
            </thead>
            <tbody>
              {visibleDrafts.map((draft) => {
                const linePeriods =
                  draft.category === 'cash_inflow' ||
                  draft.category === 'cash_outflow'
                    ? cashPeriods
                    : projectPeriods
                const activeMonths =
                  linePeriods.indexOf(draft.endPeriod) -
                  linePeriods.indexOf(draft.startPeriod) +
                  1
                const filled =
                  draft.forecastMethod === 'fixed_monthly'
                    ? Boolean(draft.fixedMonthlyValue?.trim())
                    : linePeriods
                        .filter(
                          (period) =>
                            period >= draft.startPeriod &&
                            period <= draft.endPeriod,
                        )
                        .filter((period) => draft.monthlyValues[period]?.trim())
                        .length
                return (
                  <tr
                    key={draft.id}
                    className={draft.id === selectedId ? 'selected' : ''}
                    onClick={() => {
                      setSelectedId(draft.id ?? '')
                      setLinePanelSection('amount')
                    }}
                  >
                    <td><span className={`forecast-category ${draft.category}`}>{categoryLabels[draft.category]}</span></td>
                    <td><strong>{draft.name || '未命名行项目'}</strong><small>{draft.code || '保存后生成编码'}</small></td>
                    <td>{modules.find((module) => module.id === draft.businessModuleId)?.name ?? '—'}</td>
                    <td>
                      {draft.forecastMethod === 'fixed_monthly'
                        ? '固定月金额'
                        : draft.forecastMethod === 'monthly_input'
                          ? '逐月填写'
                          : '公式计算'}
                    </td>
                    <td>
                      <span>
                        {methodSummary(
                          draft,
                          linePeriods,
                          parameterDrafts,
                          drafts,
                        )}
                      </span>
                      {(draft.category === 'revenue' ||
                        draft.category === 'cost') && (
                        <small>
                          {draft.amountBasis === 'tax_inclusive'
                            ? '含税'
                            : draft.amountBasis === 'non_taxable'
                              ? '免税'
                              : '未税'}
                          {' · '}
                          {cashRuleDrafts.find(
                            (rule) => rule.sourceLineCode === draft.code,
                          )?.method === 'immediate'
                            ? '当月收付'
                            : cashRuleDrafts.find(
                                  (rule) =>
                                    rule.sourceLineCode === draft.code,
                                )?.method === 'delayed'
                              ? '延后收付'
                              : cashRuleDrafts.find(
                                    (rule) =>
                                      rule.sourceLineCode === draft.code,
                                  )?.method === 'installment'
                                ? '分期收付'
                                : '不自动生成现金'}
                        </small>
                      )}
                    </td>
                    <td>{draft.startPeriod}—{draft.endPeriod}</td>
                    <td className="number-cell">
                      {draft.forecastMethod === 'formula'
                        ? '计算后生成'
                        : formatWan(totalValue(draft, linePeriods))}
                    </td>
                    <td>
                      <span className={filled ? 'complete-mark' : 'incomplete-mark'}>
                        {draft.forecastMethod === 'formula'
                          ? draft.formulaExpression?.trim() ? '已配置' : '待配置'
                          : draft.forecastMethod === 'monthly_input'
                          ? `${filled}/${Math.max(activeMonths, 0)}个月`
                          : filled ? '已填写' : '待填写'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {visibleDrafts.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    {activeSection === 'profit'
                      ? '当前还没有损益行项目，请新增收入或成本项'
                      : '当前没有直接现金计划；损益行仍可通过规则自动生成现金流'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {selected && (
          <aside className="forecast-side-panel">
            <div className="forecast-panel-head">
              <div><b>行项目配置</b><span>{selected.code || '尚未保存'}</span></div>
              <button className="icon-button" aria-label="关闭配置面板" onClick={() => setSelectedId('')}><X size={16} /></button>
            </div>
            {(selected.category === 'revenue' ||
              selected.category === 'cost') && (
              <div className="line-config-tabs line-config-tabs-fixed">
                <button
                  className={linePanelSection === 'amount' ? 'active' : ''}
                  onClick={() => setLinePanelSection('amount')}
                >
                  金额与公式
                </button>
                <button
                  className={linePanelSection === 'cash' ? 'active' : ''}
                  onClick={() => setLinePanelSection('cash')}
                >
                  税与收付款
                </button>
              </div>
            )}
            <div className="forecast-panel-body">
              <label>行项目名称
                <input
                  value={selected.name}
                  onChange={(event) => changeSelected({ name: event.target.value })}
                  placeholder={categoryPlaceholders[selected.category]}
                />
              </label>
              <div className="forecast-form-row">
                <label>系统分类
                  <select
                    value={selected.category}
                    onChange={(event) =>
                      changeSelected({ category: event.target.value as ForecastCategory })
                    }
                  >
                    {activeSection === 'profit' ? (
                      <>
                        <option value="revenue">收入</option>
                        <option value="cost">成本</option>
                      </>
                    ) : (
                      <>
                        <option value="cash_inflow">收款</option>
                        <option value="cash_outflow">付款</option>
                      </>
                    )}
                  </select>
                </label>
                <label>业务模块
                  <select
                    value={selected.businessModuleId}
                    onChange={(event) => changeSelected({ businessModuleId: event.target.value })}
                  >
                    {modules.map((module) => <option value={module.id} key={module.id}>{module.name}</option>)}
                  </select>
                </label>
              </div>
              {(selected.category === 'cash_inflow' ||
                selected.category === 'cash_outflow' ||
                linePanelSection === 'amount') ? (
                <>
              <label>预测方式
                <select
                  value={selected.forecastMethod}
                  onChange={(event) =>
                    changeSelected({
                      forecastMethod: event.target.value as ForecastLineDraft['forecastMethod'],
                    })
                  }
                >
                  <option value="fixed_monthly">固定月金额</option>
                  <option value="monthly_input">逐月填写</option>
                  <option value="formula">公式计算</option>
                </select>
              </label>
              <div className="forecast-form-row">
                <label>开始期间
                  <select value={selected.startPeriod} onChange={(event) => changeSelected({ startPeriod: event.target.value })}>
                    {selectedPeriods.map((period) => <option key={period}>{period}</option>)}
                  </select>
                </label>
                <label>结束期间
                  <select value={selected.endPeriod} onChange={(event) => changeSelected({ endPeriod: event.target.value })}>
                    {selectedPeriods.map((period) => <option key={period}>{period}</option>)}
                  </select>
                </label>
              </div>
              {selected.forecastMethod === 'fixed_monthly' ? (
                <label>每月金额（元）
                  <input
                    type="number"
                    step="any"
                    value={selected.fixedMonthlyValue ?? ''}
                    onChange={(event) => changeSelected({ fixedMonthlyValue: event.target.value })}
                    placeholder="例如：200000"
                  />
                  <small>周期合计：{formatWan(totalValue(selected, selectedPeriods))} 万元</small>
                </label>
              ) : selected.forecastMethod === 'monthly_input' ? (
                <div className="monthly-input-section">
                  <div className="monthly-input-head">
                    <b>逐月金额（元）</b>
                    <span>空白月份按0计算</span>
                  </div>
                  <div className="monthly-value-list">
                    {selectedPeriods
                      .filter(
                        (period) =>
                          period >= selected.startPeriod &&
                          period <= selected.endPeriod,
                      )
                      .map((period) => (
                        <label key={period}>
                          <span>{period}</span>
                          <input
                            type="number"
                            step="any"
                            value={selected.monthlyValues[period] ?? ''}
                            placeholder="0"
                            onChange={(event) =>
                              changeSelected({
                                monthlyValues: {
                                  ...selected.monthlyValues,
                                  [period]: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                  </div>
                </div>
              ) : (
                <div className="formula-editor-section">
                  <div className="formula-template-row">
                    <button
                      className="btn compact"
                      onClick={() => applyFormulaTemplate('price_quantity')}
                    >
                      单价 × 数量
                    </button>
                    <button
                      className="btn compact"
                      onClick={() => applyFormulaTemplate('line_ratio')}
                    >
                      收入 × 比例
                    </button>
                  </div>
                  <label>公式表达式
                    <textarea
                      rows={4}
                      value={selected.formulaExpression ?? ''}
                      onChange={(event) =>
                        changeSelected({
                          formulaExpression: event.target.value,
                        })
                      }
                      placeholder={'例如：PARAM("PAR-001") * PARAM("PAR-002")'}
                    />
                  </label>
                  <div className="formula-reference-picker">
                    <span>插入参数</span>
                    {parameterDrafts.map((parameter) => (
                      <button
                        className="reference-chip"
                        key={parameter.id ?? parameter.code}
                        onClick={() =>
                          appendFormulaToken(`PARAM("${parameter.code}")`)
                        }
                      >
                        {parameter.name || parameter.code}
                      </button>
                    ))}
                  </div>
                  <div className="formula-reference-picker">
                    <span>插入行项目</span>
                    {drafts
                      .filter((draft) => draft.id !== selected.id)
                      .map((draft) => (
                        <button
                          className="reference-chip"
                          key={draft.id ?? draft.code}
                          onClick={() =>
                            appendFormulaToken(`LINE("${draft.code}")`)
                          }
                        >
                          {draft.name || draft.code}
                        </button>
                      ))}
                  </div>
                  <div className="formula-operator-row">
                    {['+', '-', '*', '/', '(', ')', '20%'].map((operator) => (
                      <button
                        className="operator-button"
                        key={operator}
                        onClick={() => appendFormulaToken(operator)}
                      >
                        {operator === '*' ? '×' : operator === '/' ? '÷' : operator}
                      </button>
                    ))}
                  </div>
                  <div className="formula-preview-card">
                    <span>公式说明</span>
                    <strong>
                      {selected.formulaExpression?.trim()
                        ? humanFormula(
                            selected.formulaExpression,
                            parameterDrafts,
                            drafts,
                          )
                        : '尚未配置公式'}
                    </strong>
                    <small>
                      {formulaDependencies.length > 0
                        ? `引用：${formulaDependencies.join('、')}`
                        : '选择参数或其他行项目构成公式；结果按期间计算。'}
                    </small>
                    {selectedPreviewIssues.some(
                      (issue) => issue.severity === 'error',
                    ) ? (
                      <small className="formula-preview-error">
                        {
                          selectedPreviewIssues.find(
                            (issue) => issue.severity === 'error',
                          )?.message
                        }
                      </small>
                    ) : selectedPreviewValues.length > 0 ? (
                      <div className="formula-month-preview">
                        {selectedPreviewValues.slice(0, 6).map((value) => (
                          <span key={value.period}>
                            <small>{value.period}</small>
                            <b>{formatWan(value.value)} 万元</b>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
              <label>假设说明
                <textarea
                  rows={4}
                  value={selected.assumption}
                  onChange={(event) => changeSelected({ assumption: event.target.value })}
                  placeholder="填写金额来源、业务假设或复核说明"
                />
              </label>
                </>
              ) : (
                <div className="cash-rule-editor">
                  <div className="forecast-form-row">
                    <label>金额口径
                      <select
                        value={selected.amountBasis ?? 'tax_exclusive'}
                        onChange={(event) =>
                          changeSelected({
                            amountBasis: event.target.value as TaxAmountBasis,
                            taxRate:
                              event.target.value === 'non_taxable'
                                ? '0'
                                : selected.taxRate,
                          })
                        }
                      >
                        <option value="tax_exclusive">未税金额</option>
                        <option value="tax_inclusive">含税金额</option>
                        <option value="non_taxable">免税/不计税</option>
                      </select>
                    </label>
                    <label>税率（%）
                      <input
                        type="number"
                        min="0"
                        max="99.999999"
                        step="any"
                        disabled={selected.amountBasis === 'non_taxable'}
                        value={selected.taxRate ?? '0'}
                        onChange={(event) =>
                          changeSelected({ taxRate: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <label>收付款方式
                    <select
                      value={selectedCashRule?.method ?? 'disabled'}
                      onChange={(event) =>
                        changeSelectedCashRule({
                          method: event.target.value as CashRuleDraft['method'],
                        })
                      }
                    >
                      <option value="disabled">不自动生成</option>
                      <option value="immediate">当月100%</option>
                      <option value="delayed">延后N个月100%</option>
                      <option value="installment">分期收付款</option>
                    </select>
                  </label>
                  {selectedCashRule?.method === 'delayed' && (
                    <label>延后月份
                      <input
                        type="number"
                        min="0"
                        max="36"
                        step="1"
                        value={selectedCashRule.delayMonths}
                        onChange={(event) =>
                          changeSelectedCashRule({
                            delayMonths: Number(event.target.value),
                          })
                        }
                      />
                      <small>以损益确认期间为第0个月，最多延后36个月。</small>
                    </label>
                  )}
                  {selectedCashRule?.method === 'installment' && (
                    <div className="installment-editor">
                      <div className="monthly-input-head">
                        <b>分期计划</b>
                        <button
                          className="btn compact"
                          disabled={selectedCashRule.installments.length >= 12}
                          onClick={() =>
                            changeSelectedCashRule({
                              installments: [
                                ...selectedCashRule.installments,
                                {
                                  sequence:
                                    selectedCashRule.installments.length + 1,
                                  offsetMonths:
                                    selectedCashRule.installments.length,
                                  ratio: '',
                                },
                              ],
                            })
                          }
                        >
                          <Plus size={13} />增加一期
                        </button>
                      </div>
                      {selectedCashRule.installments.map((item, index) => (
                        <div className="installment-row" key={item.id ?? index}>
                          <span>第{index + 1}期</span>
                          <label>偏移月
                            <input
                              type="number"
                              min="0"
                              max="36"
                              value={item.offsetMonths}
                              onChange={(event) =>
                                changeSelectedCashRule({
                                  installments:
                                    selectedCashRule.installments.map(
                                      (current, currentIndex) =>
                                        currentIndex === index
                                          ? {
                                              ...current,
                                              offsetMonths: Number(
                                                event.target.value,
                                              ),
                                            }
                                          : current,
                                    ),
                                })
                              }
                            />
                          </label>
                          <label>比例%
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="any"
                              value={item.ratio}
                              onChange={(event) =>
                                changeSelectedCashRule({
                                  installments:
                                    selectedCashRule.installments.map(
                                      (current, currentIndex) =>
                                        currentIndex === index
                                          ? {
                                              ...current,
                                              ratio: event.target.value,
                                            }
                                          : current,
                                    ),
                                })
                              }
                            />
                          </label>
                          <button
                            className="icon-button"
                            aria-label={`删除第${index + 1}期`}
                            onClick={() =>
                              changeSelectedCashRule({
                                installments:
                                  selectedCashRule.installments
                                    .filter((_, currentIndex) => currentIndex !== index)
                                    .map((current, currentIndex) => ({
                                      ...current,
                                      sequence: currentIndex + 1,
                                    })),
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      <small>
                        比例合计：
                        {selectedCashRule.installments
                          .reduce(
                            (sum, item) =>
                              sum.plus(item.ratio || 0),
                            new Decimal(0),
                          )
                          .toString()}
                        %
                      </small>
                    </div>
                  )}
                  <div className="tax-preview-card">
                    <span>金额换算预览</span>
                    {selectedPreviewValues[0] ? (
                      <>
                        <b>
                          未税 {formatWan(selectedPreviewValues[0].netValue)} 万元
                          · 税额 {formatWan(selectedPreviewValues[0].taxValue)} 万元
                        </b>
                        <small>
                          含税结算额 {formatWan(selectedPreviewValues[0].grossValue)} 万元
                        </small>
                      </>
                    ) : (
                      <small>先完成金额或公式配置后显示。</small>
                    )}
                  </div>
                  <div className="cash-schedule-preview">
                    <span>按月结算预览</span>
                    {selectedCashPreview.slice(0, 8).map((value, index) => (
                      <div key={`${value.sourcePeriod}-${value.settlementPeriod}-${index}`}>
                        <small>{value.sourcePeriod} → {value.settlementPeriod}</small>
                        <b>{formatWan(value.value)} 万元</b>
                      </div>
                    ))}
                    {selectedCashRule?.method !== 'disabled' &&
                      selectedCashPreview.length === 0 && (
                        <small>当前规则尚未生成有效现金计划，请检查金额和分期配置。</small>
                      )}
                  </div>
                </div>
              )}
            </div>
            <div className="forecast-panel-actions">
              <div>
                <button className="icon-button" aria-label="上移行项目" title="上移" disabled={selectedIndex <= 0} onClick={() => moveSelected(-1)}><ArrowUp size={15} /></button>
                <button className="icon-button" aria-label="下移行项目" title="下移" disabled={selectedIndex >= drafts.length - 1} onClick={() => moveSelected(1)}><ArrowDown size={15} /></button>
              </div>
              <button className="btn danger" onClick={removeSelected}><Trash2 size={14} />删除行项目</button>
            </div>
          </aside>
        )}
      </div>
      ) : (
        <div
          className={`forecast-editor ${selectedParameter ? 'panel-open' : ''}`}
        >
          <section className="forecast-table-panel">
            <table className="forecast-table parameter-table">
              <thead>
                <tr>
                  <th style={{ width: 190 }}>参数名称</th>
                  <th style={{ width: 100 }}>参数类型</th>
                  <th style={{ width: 100 }}>数值类型</th>
                  <th style={{ width: 90 }}>单位</th>
                  <th>当前配置</th>
                  <th style={{ width: 100 }}>引用状态</th>
                </tr>
              </thead>
              <tbody>
                {parameterDrafts.map((parameter) => {
                  const referenceCount = drafts.filter((draft) =>
                    new RegExp(
                      `PARAM\\(\\s*"${(parameter.code ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*\\)`,
                      'i',
                    ).test(draft.formulaExpression ?? ''),
                  ).length
                  const configured =
                    parameter.parameterType === 'fixed'
                      ? parameter.fixedValue?.trim()
                        ? parameter.valueType === 'percentage'
                          ? `${parameter.fixedValue}%`
                          : `${parameter.fixedValue} ${parameter.unit}`.trim()
                        : '尚未填写'
                      : `${projectPeriods.filter((period) => parameter.monthlyValues[period]?.trim()).length}/${projectPeriods.length}个月已填写`
                  return (
                    <tr
                      key={parameter.id ?? parameter.code}
                      className={
                        (parameter.id ?? parameter.code) === selectedParameterId
                          ? 'selected'
                          : ''
                      }
                      onClick={() =>
                        setSelectedParameterId(
                          parameter.id ?? parameter.code ?? '',
                        )
                      }
                    >
                      <td>
                        <strong>{parameter.name || '未命名参数'}</strong>
                        <small>{parameter.code}</small>
                      </td>
                      <td>
                        {parameter.parameterType === 'fixed'
                          ? '固定值'
                          : '逐月值'}
                      </td>
                      <td>{parameterValueTypeLabels[parameter.valueType]}</td>
                      <td>{parameter.unit || '—'}</td>
                      <td>{configured}</td>
                      <td>
                        <span className={referenceCount ? 'complete-mark' : 'status-neutral'}>
                          {referenceCount ? `${referenceCount}处引用` : '未引用'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {parameterDrafts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      当前还没有项目参数。可新增用户数、单价、比例或其他业务驱动。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {selectedParameter && (
            <aside className="forecast-side-panel">
              <div className="forecast-panel-head">
                <div>
                  <b>项目参数配置</b>
                  <span>{selectedParameter.code}</span>
                </div>
                <button
                  className="icon-button"
                  aria-label="关闭参数配置面板"
                  onClick={() => setSelectedParameterId('')}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="forecast-panel-body">
                <label>参数名称
                  <input
                    value={selectedParameter.name}
                    onChange={(event) =>
                      changeSelectedParameter({ name: event.target.value })
                    }
                    placeholder="例如：注册用户数"
                  />
                </label>
                <div className="forecast-form-row">
                  <label>参数类型
                    <select
                      value={selectedParameter.parameterType}
                      onChange={(event) =>
                        changeSelectedParameter({
                          parameterType: event.target
                            .value as ProjectParameterDraft['parameterType'],
                        })
                      }
                    >
                      <option value="fixed">固定值</option>
                      <option value="monthly">逐月值</option>
                    </select>
                  </label>
                  <label>数值类型
                    <select
                      value={selectedParameter.valueType}
                      onChange={(event) =>
                        changeSelectedParameter({
                          valueType: event.target.value as ParameterValueType,
                        })
                      }
                    >
                      {Object.entries(parameterValueTypeLabels).map(
                        ([value, label]) => (
                          <option value={value} key={value}>{label}</option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
                <label>单位
                  <input
                    value={selectedParameter.unit}
                    onChange={(event) =>
                      changeSelectedParameter({ unit: event.target.value })
                    }
                    placeholder={
                      selectedParameter.valueType === 'percentage'
                        ? '%'
                        : '例如：元、户、个'
                    }
                  />
                </label>
                {selectedParameter.parameterType === 'fixed' ? (
                  <label>
                    {selectedParameter.valueType === 'percentage'
                      ? '固定比例（%）'
                      : '固定值'}
                    <input
                      type="number"
                      step="any"
                      value={selectedParameter.fixedValue ?? ''}
                      onChange={(event) =>
                        changeSelectedParameter({
                          fixedValue: event.target.value,
                        })
                      }
                      placeholder={
                        selectedParameter.valueType === 'percentage'
                          ? '例如：20'
                          : '请输入数值'
                      }
                    />
                    {selectedParameter.valueType === 'percentage' && (
                      <small>输入 20 表示 20%，数据库规范值保存为 0.2。</small>
                    )}
                  </label>
                ) : (
                  <div className="monthly-input-section">
                    <div className="monthly-input-head">
                      <b>逐月参数值</b>
                      <span>公式引用期间不能为空</span>
                    </div>
                    <div className="monthly-value-list">
                      {projectPeriods.map((period) => (
                        <label key={period}>
                          <span>{period}</span>
                          <input
                            type="number"
                            step="any"
                            value={selectedParameter.monthlyValues[period] ?? ''}
                            placeholder={
                              selectedParameter.valueType === 'percentage'
                                ? '0%'
                                : '未填写'
                            }
                            onChange={(event) =>
                              changeSelectedParameter({
                                monthlyValues: {
                                  ...selectedParameter.monthlyValues,
                                  [period]: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <label>参数说明
                  <textarea
                    rows={4}
                    value={selectedParameter.description}
                    onChange={(event) =>
                      changeSelectedParameter({
                        description: event.target.value,
                      })
                    }
                    placeholder="说明参数来源、单位和业务口径"
                  />
                </label>
              </div>
              <div className="forecast-panel-actions">
                <div>
                  <button
                    className="icon-button"
                    aria-label="上移参数"
                    disabled={selectedParameterIndex <= 0}
                    onClick={() => moveSelectedParameter(-1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="下移参数"
                    disabled={
                      selectedParameterIndex >= parameterDrafts.length - 1
                    }
                    onClick={() => moveSelectedParameter(1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                </div>
                <button
                  className="btn danger"
                  onClick={removeSelectedParameter}
                >
                  <Trash2 size={14} />删除参数
                </button>
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  )
}
