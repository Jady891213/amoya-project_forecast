import Decimal from 'decimal.js'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArrowLeft,
  Calculator,
  Copy,
  Download,
  FileChartColumn,
  MoreHorizontal,
  Plus,
  Printer,
  Save,
  TableProperties,
  Trash2,
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
import { generatePeriods } from '../domain/periods'
import { FinancialGrid, type FinancialGridChange, type FinancialGridRow } from '../components/FinancialGrid'
import { formatPercent, formatWan } from '../ui/formatters'

const ReportCharts = lazy(async () => {
  const module = await import('../components/ReportCharts')
  return { default: module.ReportCharts }
})

type WorkspaceView = 'config' | 'calculation' | 'report'
type ConfigSection = 'profit' | 'cash' | 'parameters'

interface Props {
  api: ApiClient
  snapshot: AppSnapshot
  projectId: string
  view: WorkspaceView
  onNavigate: (path: string) => void
  onRefresh: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
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

export function ProjectWorkspacePage({ api, snapshot, projectId, view, onNavigate, onRefresh, onDirtyChange }: Props) {
  const [workspace, setWorkspace] = useState<ProjectWorkspace>()
  const [projectDraft, setProjectDraft] = useState<ProjectInput>()
  const [lines, setLines] = useState<ForecastLineDraft[]>([])
  const [parameters, setParameters] = useState<ProjectParameterDraft[]>([])
  const [cashRules, setCashRules] = useState<CashRuleDraft[]>([])
  const [overrides, setOverrides] = useState<ForecastOverrideDraft[]>([])
  const [section, setSection] = useState<ConfigSection>('profit')
  const [selectedLineId, setSelectedLineId] = useState('')
  const [selectedParameterId, setSelectedParameterId] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [report, setReport] = useState<ProjectReportDto>()
  const [reportRunId, setReportRunId] = useState('')

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
      customer: next.project.customer,
      departmentId: next.project.departmentId,
      owner: next.project.owner,
      startPeriod: next.project.startPeriod,
      durationMonths: next.project.durationMonths,
      remark: next.project.remark,
      modules: next.modules.filter((item) => !item.isCommon).map((item) => ({ code: item.code, name: item.name })),
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
    setSelectedLineId((current) => nextLines.some((line) => line.id === current) ? current : nextLines[0]?.id ?? '')
    setSelectedParameterId((current) => nextParameters.some((item) => item.id === current) ? current : nextParameters[0]?.id ?? '')
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
    if (view === 'config' || !workspace) return
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

  const projectPeriods = useMemo(() => projectDraft ? generatePeriods(projectDraft.startPeriod, projectDraft.durationMonths) : [], [projectDraft])
  const cashPeriods = useMemo(() => projectDraft ? generatePeriods(projectDraft.startPeriod, projectDraft.durationMonths + 36) : [], [projectDraft])
  const selectedLine = lines.find((line) => line.id === selectedLineId)
  const selectedParameter = parameters.find((item) => item.id === selectedParameterId)

  function normalizedForecast() {
    return {
      lines: lines.map((line) => ({
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

  async function save(manageBusy = true) {
    if (!workspace || !projectDraft) throw new Error('项目尚未加载')
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

  function addLine(category: ForecastCategory) {
    if (!workspace || projectPeriods.length === 0) return
    const common = workspace.modules.find((item) => item.isCommon) ?? workspace.modules[0]
    const id = `draft-${crypto.randomUUID()}`
    const periods = category === 'cash_inflow' || category === 'cash_outflow' ? cashPeriods : projectPeriods
    const line: ForecastLineDraft = {
      id,
      code: nextCode('LINE', lines.map((item) => item.code)),
      name: category === 'revenue' ? '新增收入项' : category === 'cost' ? '新增成本项' : category === 'cash_inflow' ? '新增收款项' : '新增付款项',
      category,
      businessModuleId: common?.id ?? '',
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
    setSelectedLineId(id); markDirty()
  }

  function duplicateLine() {
    if (!selectedLine) return
    const id = `draft-${crypto.randomUUID()}`
    const code = nextCode('LINE', lines.map((item) => item.code))
    const copy = { ...selectedLine, id, code, name: `${selectedLine.name} 副本`, sortOrder: lines.length + 1, monthlyValues: { ...selectedLine.monthlyValues } }
    setLines((current) => [...current, copy])
    const rule = cashRules.find((item) => item.sourceLineCode === selectedLine.code)
    if (rule) setCashRules((current) => [...current, { ...rule, id: undefined, sourceLineId: id, sourceLineCode: code, installments: rule.installments.map((item) => ({ ...item, id: undefined })) }])
    setSelectedLineId(id); markDirty()
  }

  function removeLine() {
    if (!selectedLine || !window.confirm(`删除“${selectedLine.name}”？`)) return
    setLines((current) => current.filter((item) => item.id !== selectedLine.id))
    setCashRules((current) => current.filter((item) => item.sourceLineCode !== selectedLine.code))
    setOverrides((current) => current.filter((item) => item.forecastLineId !== selectedLine.id))
    setSelectedLineId(''); markDirty()
  }

  function updateMonthly(changes: FinancialGridChange[]) {
    if (!selectedLine) return
    const values = { ...selectedLine.monthlyValues }
    changes.forEach((change) => { if (change.value) values[change.period] = change.value; else delete values[change.period] })
    patchLine(selectedLine.id ?? '', { monthlyValues: values })
  }

  function switchConfigSection(next: ConfigSection) {
    setSection(next)
    if (next === 'parameters') return
    const currentLine = lines.find((line) => line.id === selectedLineId)
    const belongsToSection = currentLine && (next === 'profit'
      ? currentLine.category === 'revenue' || currentLine.category === 'cost'
      : currentLine.category === 'cash_inflow' || currentLine.category === 'cash_outflow')
    if (!belongsToSection) {
      const firstLine = lines.find((line) => next === 'profit'
        ? line.category === 'revenue' || line.category === 'cost'
        : line.category === 'cash_inflow' || line.category === 'cash_outflow')
      setSelectedLineId(firstLine?.id ?? '')
    }
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

  const statusText = dirty ? '有未保存修改' : workspace.forecast.latestRun ? workspace.forecast.isResultCurrent ? '结果与当前配置一致' : '已保存，结果需要重新计算' : '已保存，等待计算'
  const filteredLines = lines.filter((line) => section === 'profit' ? line.category === 'revenue' || line.category === 'cost' : section === 'cash' ? line.category === 'cash_inflow' || line.category === 'cash_outflow' : false)
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
      <button className="back-btn" onClick={() => onNavigate('/projects')}><ArrowLeft size={15} />项目中心</button>
      <span className="project-title">{projectDraft.name}</span>
      <span className="project-version">基准场景 · 工作版</span>
      <span className={`workspace-save-state ${dirty ? 'dirty' : ''}`}>{statusText}</span>
      <div className="workspace-tabs">
        <button className={view === 'config' ? 'workspace-tab active' : 'workspace-tab'} onClick={() => onNavigate(`/projects/${projectId}/config`)}><Calculator size={14} />项目配置</button>
        <button className={view === 'calculation' ? 'workspace-tab active' : 'workspace-tab'} onClick={() => onNavigate(`/projects/${projectId}/calculation`)}><TableProperties size={14} />计算工作表</button>
        <button className={view === 'report' ? 'workspace-tab active' : 'workspace-tab'} onClick={() => onNavigate(`/projects/${projectId}/report`)}><FileChartColumn size={14} />项目报告</button>
      </div>
      <div className="workspace-head-actions">
        <button className="btn" disabled={busy || !dirty} onClick={() => void save()}><Save size={14} />保存</button>
        <button className="btn primary" disabled={busy} onClick={() => void calculate()}><Calculator size={14} />计算</button>
        <button className="btn icon-only" aria-label="更多项目操作" title="归档项目" onClick={() => void api.archive(projectId).then(() => onNavigate('/projects'))}><MoreHorizontal size={15} /></button>
      </div>
    </div>
    {message && <div className="workspace-message">{message}</div>}

    {view === 'config' && <div className="project-config-page">
      <ProjectInformationSection value={projectDraft} departments={snapshot.departments} onChange={(next) => { setProjectDraft(next); markDirty() }} />
      <section className="forecast-config-section">
        <div className="section-heading forecast-config-heading">
          <div><h2>测算配置</h2><p>选择配置类型，在右侧表格集中维护当前项目的预测明细。</p></div>
        </div>
        <div className="forecast-config-workbench">
          <nav className="forecast-config-switcher" aria-label="测算配置类型">
            <button className={section === 'profit' ? 'active' : ''} onClick={() => switchConfigSection('profit')}>
              <b>损益预测</b><span>收入与成本</span><i>{lines.filter((line) => line.category === 'revenue' || line.category === 'cost').length}</i>
            </button>
            <button className={section === 'cash' ? 'active' : ''} onClick={() => switchConfigSection('cash')}>
              <b>直接现金</b><span>直接收付款</span><i>{lines.filter((line) => line.category === 'cash_inflow' || line.category === 'cash_outflow').length}</i>
            </button>
            <button className={section === 'parameters' ? 'active' : ''} onClick={() => switchConfigSection('parameters')}>
              <b>项目参数</b><span>计算假设</span><i>{parameters.length}</i>
            </button>
          </nav>
          <div className="forecast-config-detail">
        {(section === 'profit' || section === 'cash') && <>
          <div className="forecast-toolbar compact-toolbar">
            <b>{section === 'profit' ? '损益预测行' : '直接现金计划'}</b><span className="spacer" />
            {section === 'profit' ? <><button className="btn" onClick={() => addLine('revenue')}><Plus size={14} />收入项</button><button className="btn" onClick={() => addLine('cost')}><Plus size={14} />成本项</button></> : <><button className="btn" onClick={() => addLine('cash_inflow')}><Plus size={14} />收款项</button><button className="btn" onClick={() => addLine('cash_outflow')}><Plus size={14} />付款项</button></>}
            <button className="btn" disabled={!selectedLine} onClick={duplicateLine}><Copy size={14} />复制行项目</button>
          </div>
          <div className={`forecast-split ${selectedLine ? 'panel-open' : ''}`}>
            <div className="forecast-main"><table className="data-table"><thead><tr><th>分类</th><th>行项目</th><th>预测方式</th><th>生效期间</th><th>主要配置</th></tr></thead><tbody>{filteredLines.map((line) => <tr key={line.id} className={line.id === selectedLineId ? 'selected-row' : ''} onClick={() => setSelectedLineId(line.id ?? '')}><td>{line.category === 'revenue' ? '收入' : line.category === 'cost' ? '成本' : line.category === 'cash_inflow' ? '收款' : '付款'}</td><td><b>{line.name}</b><small>{line.code}</small></td><td>{line.forecastMethod === 'fixed_monthly' ? '固定月金额' : line.forecastMethod === 'monthly_input' ? '逐月填写' : '公式计算'}</td><td>{line.startPeriod}—{line.endPeriod}</td><td>{line.forecastMethod === 'fixed_monthly' ? `${line.fixedMonthlyValue || '—'} 元/月` : line.forecastMethod === 'formula' ? line.formulaExpression || '未配置' : `${Object.keys(line.monthlyValues).length} 个月已填`}</td></tr>)}</tbody></table></div>
            {selectedLine && <LineEditor line={selectedLine} modules={workspace.modules} periods={selectedLine.category === 'cash_inflow' || selectedLine.category === 'cash_outflow' ? cashPeriods : projectPeriods} parameters={parameters} lines={lines} cashRule={cashRules.find((rule) => rule.sourceLineCode === selectedLine.code)} onPatch={(patch) => patchLine(selectedLine.id ?? '', patch)} onMonthlyChange={updateMonthly} onCashRuleChange={(rule) => { setCashRules((current) => current.some((item) => item.sourceLineCode === rule.sourceLineCode) ? current.map((item) => item.sourceLineCode === rule.sourceLineCode ? rule : item) : [...current, rule]); markDirty() }} onDelete={removeLine} />}
          </div>
        </>}
        {section === 'parameters' && <ParameterSection parameters={parameters} selectedId={selectedParameterId} periods={projectPeriods} onSelect={setSelectedParameterId} onChange={(next) => { setParameters(next); markDirty() }} />}
          </div>
        </div>
      </section>
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

function ProjectInformationSection({ value, departments, onChange }: { value: ProjectInput; departments: AppSnapshot['departments']; onChange: (next: ProjectInput) => void }) {
  const patch = (next: Partial<ProjectInput>) => onChange({ ...value, ...next })
  return <div className="project-information-page"><div className="section-heading"><div><h2>项目信息</h2><p>项目级属性和业务模块与预测配置统一保存。</p></div></div><div className="project-information-grid">
    <label>项目编码<input value={value.code ?? ''} onChange={(e) => patch({ code: e.target.value })} /></label>
    <label>项目名称<input value={value.name} onChange={(e) => patch({ name: e.target.value })} /></label>
    <label>客户<input value={value.customer} onChange={(e) => patch({ customer: e.target.value })} /></label>
    <label>所属部门<select value={value.departmentId} onChange={(e) => patch({ departmentId: e.target.value })}>{departments.filter((item) => item.status === 'active' || item.id === value.departmentId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>负责人<input value={value.owner} onChange={(e) => patch({ owner: e.target.value })} /></label>
    <label>开始期间<input type="month" value={value.startPeriod} onChange={(e) => patch({ startPeriod: e.target.value })} /></label>
    <label>项目周期（月）<input type="number" min={1} max={36} value={value.durationMonths} onChange={(e) => patch({ durationMonths: Number(e.target.value) })} /></label>
    <label className="project-remark">备注<input value={value.remark} onChange={(e) => patch({ remark: e.target.value })} /></label>
  </div><div className="module-editor"><b>业务模块</b><span className="readonly-mark">PUBLIC · 公共</span>{value.modules.map((module, index) => <span key={`${module.code}-${index}`}><input value={module.code} placeholder="编码" onChange={(e) => patch({ modules: value.modules.map((item, itemIndex) => itemIndex === index ? { ...item, code: e.target.value } : item) })} /><input value={module.name} placeholder="名称" onChange={(e) => patch({ modules: value.modules.map((item, itemIndex) => itemIndex === index ? { ...item, name: e.target.value } : item) })} /><button onClick={() => patch({ modules: value.modules.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={13} /></button></span>)}<button className="btn" onClick={() => patch({ modules: [...value.modules, { code: '', name: '' }] })}><Plus size={13} />添加模块</button></div></div>
}

function LineEditor({ line, modules, periods, parameters, lines, cashRule, onPatch, onMonthlyChange, onCashRuleChange, onDelete }: { line: ForecastLineDraft; modules: ProjectWorkspace['modules']; periods: string[]; parameters: ProjectParameterDraft[]; lines: ForecastLineDraft[]; cashRule?: CashRuleDraft; onPatch: (patch: Partial<ForecastLineDraft>) => void; onMonthlyChange: (changes: FinancialGridChange[]) => void; onCashRuleChange: (rule: CashRuleDraft) => void; onDelete: () => void }) {
  const isProfit = line.category === 'revenue' || line.category === 'cost'
  const monthlyRow: FinancialGridRow = { id: line.id ?? '', label: line.name, editable: true, values: line.monthlyValues }
  return <aside className="forecast-editor"><div className="editor-head"><b>行项目配置</b><button className="icon-button" onClick={onDelete}><Trash2 size={14} /></button></div><div className="editor-form">
    <label>行项目名称<input value={line.name} onChange={(e) => onPatch({ name: e.target.value })} /></label>
    <label>业务模块<select value={line.businessModuleId} onChange={(e) => onPatch({ businessModuleId: e.target.value })}>{modules.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>预测方式<select value={line.forecastMethod} onChange={(e) => onPatch({ forecastMethod: e.target.value as ForecastLineDraft['forecastMethod'] })}><option value="fixed_monthly">固定月金额</option><option value="monthly_input">逐月填写</option><option value="formula">公式计算</option></select></label>
    <div className="two-fields"><label>开始期间<select value={line.startPeriod} onChange={(e) => onPatch({ startPeriod: e.target.value })}>{periods.map((period) => <option key={period}>{period}</option>)}</select></label><label>结束期间<select value={line.endPeriod} onChange={(e) => onPatch({ endPeriod: e.target.value })}>{periods.map((period) => <option key={period}>{period}</option>)}</select></label></div>
    {line.forecastMethod === 'fixed_monthly' && <label>每月金额（元）<input value={line.fixedMonthlyValue ?? ''} onChange={(e) => onPatch({ fixedMonthlyValue: e.target.value })} /></label>}
    {line.forecastMethod === 'formula' && <><label>公式<textarea value={line.formulaExpression ?? ''} onChange={(e) => onPatch({ formulaExpression: e.target.value })} placeholder={'PARAM("PAR-001") * PARAM("PAR-002")'} /></label><small>可用参数：{parameters.map((item) => `${item.name}(${item.code})`).join('、') || '无'}<br />可用行：{lines.filter((item) => item.id !== line.id).map((item) => `${item.name}(${item.code})`).join('、') || '无'}</small></>}
    {line.forecastMethod === 'monthly_input' && <div className="editor-grid"><FinancialGrid ariaLabel="逐月预测输入" periods={periods.filter((period) => period >= line.startPeriod && period <= line.endPeriod)} rows={[monthlyRow]} onChange={onMonthlyChange} /></div>}
    {isProfit && <><div className="editor-divider">税与收付款</div><label>金额口径<select value={line.amountBasis} onChange={(e) => onPatch({ amountBasis: e.target.value as ForecastLineDraft['amountBasis'] })}><option value="tax_exclusive">未税</option><option value="tax_inclusive">含税</option><option value="non_taxable">免税</option></select></label><label>税率（%）<input value={line.taxRate ?? '0'} disabled={line.amountBasis === 'non_taxable'} onChange={(e) => onPatch({ taxRate: e.target.value })} /></label><label>收付款规则<select value={cashRule?.method ?? 'disabled'} onChange={(e) => onCashRuleChange({ ...(cashRule ?? { sourceLineId: line.id, sourceLineCode: line.code ?? '', delayMonths: 0, installments: [] }), method: e.target.value as CashRuleDraft['method'] })}><option value="disabled">不自动生成</option><option value="immediate">当月100%</option><option value="delayed">延后N个月</option><option value="installment">自定义分期</option></select></label>{cashRule?.method === 'delayed' && <label>延后月份<input type="number" min={0} max={36} value={cashRule.delayMonths} onChange={(e) => onCashRuleChange({ ...cashRule, delayMonths: Number(e.target.value) })} /></label>}</>}
    <label>假设说明<textarea value={line.assumption} onChange={(e) => onPatch({ assumption: e.target.value })} /></label>
  </div></aside>
}

function ParameterSection({ parameters, selectedId, periods, onSelect, onChange }: { parameters: ProjectParameterDraft[]; selectedId: string; periods: string[]; onSelect: (id: string) => void; onChange: (next: ProjectParameterDraft[]) => void }) {
  const selected = parameters.find((item) => item.id === selectedId)
  const patch = (values: Partial<ProjectParameterDraft>) => selected && onChange(parameters.map((item) => item.id === selected.id ? { ...item, ...values } : item))
  function add() { const parameter: ProjectParameterDraft = { id: `draft-${crypto.randomUUID()}`, code: nextCode('PAR', parameters.map((item) => item.code)), name: '新增参数', parameterType: 'fixed', valueType: 'number', unit: '', fixedValue: '', description: '', sortOrder: parameters.length + 1, monthlyValues: {} }; onChange([...parameters, parameter]); onSelect(parameter.id ?? '') }
  return <><div className="forecast-toolbar compact-toolbar"><b>项目参数</b><span className="spacer" /><button className="btn" onClick={add}><Plus size={14} />新增参数</button></div><div className={`forecast-split ${selected ? 'panel-open' : ''}`}><div className="forecast-main"><table className="data-table"><thead><tr><th>编码</th><th>参数名称</th><th>类型</th><th>单位</th><th>当前值</th></tr></thead><tbody>{parameters.map((item) => <tr key={item.id} onClick={() => onSelect(item.id ?? '')} className={item.id === selectedId ? 'selected-row' : ''}><td>{item.code}</td><td>{item.name}</td><td>{item.parameterType === 'fixed' ? '固定值' : '逐月值'}</td><td>{item.unit || '—'}</td><td>{item.parameterType === 'fixed' ? item.fixedValue || '—' : `${Object.keys(item.monthlyValues).length}个月已填`}</td></tr>)}</tbody></table></div>{selected && <aside className="forecast-editor"><div className="editor-head"><b>参数配置</b><button className="icon-button" onClick={() => { onChange(parameters.filter((item) => item.id !== selected.id)); onSelect('') }}><Trash2 size={14} /></button></div><div className="editor-form"><label>参数名称<input value={selected.name} onChange={(e) => patch({ name: e.target.value })} /></label><label>参数类型<select value={selected.parameterType} onChange={(e) => patch({ parameterType: e.target.value as ProjectParameterDraft['parameterType'] })}><option value="fixed">固定值</option><option value="monthly">逐月值</option></select></label><label>数值类型<select value={selected.valueType} onChange={(e) => patch({ valueType: e.target.value as ProjectParameterDraft['valueType'] })}><option value="currency">金额</option><option value="quantity">数量</option><option value="percentage">比例</option><option value="number">普通数值</option></select></label><label>单位<input value={selected.unit} onChange={(e) => patch({ unit: e.target.value })} /></label>{selected.parameterType === 'fixed' ? <label>固定值<input value={selected.fixedValue ?? ''} onChange={(e) => patch({ fixedValue: e.target.value })} /></label> : <FinancialGrid ariaLabel="逐月项目参数" periods={periods} rows={[{ id: selected.id ?? '', label: selected.name, editable: true, values: selected.monthlyValues }]} onChange={(changes) => { const values = { ...selected.monthlyValues }; changes.forEach((change) => { if (change.value) values[change.period] = change.value; else delete values[change.period] }); patch({ monthlyValues: values }) }} />}<label>说明<textarea value={selected.description} onChange={(e) => patch({ description: e.target.value })} /></label></div></aside>}</div></>
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
    <section className="report-cover"><div><span>项目测算报告</span><h1>{report.projectSnapshot.name}</h1><p>{report.projectSnapshot.code || '无项目编码'} · {report.projectSnapshot.customer || '未填写客户'} · {report.scenario.name} · {report.version.name}</p></div><dl><div><dt>经营期间</dt><dd>{report.projectSnapshot.startPeriod}—{report.operationEndPeriod}</dd></div><div><dt>计算批次</dt><dd>{report.calculationRun ? `RUN-${String(report.calculationRun.runNumber).padStart(4, '0')}` : '—'}</dd></div><div><dt>结果状态</dt><dd className={report.isBehindDraft ? 'risk' : 'good'}>{report.isBehindDraft ? '落后于当前配置' : '与当前配置一致'}</dd></div></dl></section>
    <section className="metrics-strip"><article><span>收入</span><strong>{formatWan(report.summary.revenue)} 万元</strong></article><article><span>成本</span><strong>{formatWan(report.summary.cost)} 万元</strong></article><article><span>毛利</span><strong>{formatWan(report.summary.grossProfit)} 万元</strong></article><article><span>毛利率</span><strong>{formatPercent(report.summary.grossMargin)}</strong></article><article><span>最大垫资</span><strong>{report.hasCashFacts ? `${formatWan(report.summary.maximumFunding)} 万元` : '暂无现金数据'}</strong></article><article><span>现金转正</span><strong>{report.hasCashFacts ? report.summary.cashPositiveLabel : '暂无现金数据'}</strong></article></section>
    <section className="report-section report-narrative"><h2>1. 测算概况与口径</h2>{report.measurementSummary.map((item) => <p key={item}>{item}</p>)}{report.riskNotes.map((item) => <p className="risk" key={item}>风险提示：{item}</p>)}</section>
    <section className="report-section"><h2>2. 损益、构成与现金趋势</h2><Suspense fallback={<div className="report-chart-loading">正在生成图表…</div>}><ReportCharts report={report} /></Suspense></section>
    <section className="report-section"><h2>3. 分月损益与现金流</h2><ReadOnlySummaryGrid report={report} /></section>
    <section className="report-section"><h2>4. 关键参数与人工覆盖</h2><div className="report-two-columns"><div><h3>关键参数</h3>{report.keyAssumptions.length ? report.keyAssumptions.map((item) => <p key={item.code}><b>{item.name}</b><span>{item.value} {item.unit}</span></p>) : <p>本批次无项目参数。</p>}</div><div><h3>人工覆盖</h3>{report.overrides.length ? report.overrides.map((item) => { const line = report.lineBreakdown.find((candidate) => candidate.lineId === item.forecastLineId); return <p key={`${item.forecastLineId}:${item.period}`}><b>{line?.lineName ?? item.forecastLineId} · {item.period}</b><span>{item.originalValue} → {item.overrideValue}</span></p> }) : <p>本批次无人工覆盖。</p>}</div></div></section>
    <section className="report-section"><h2>5. 指标公式与数据来源</h2><table className="data-table"><thead><tr><th>指标</th><th>类型</th><th>表达式</th><th>说明</th></tr></thead><tbody>{report.metricDefinitions.map((metric) => <tr key={metric.code}><td>{metric.name}<small>{metric.code}</small></td><td>{metric.metricType === 'base' ? '基础指标' : '系统计算'}</td><td><code>{metric.expression ?? '基础事实写入'}</code></td><td>{metric.description}</td></tr>)}</tbody></table></section>
  </div>
}
