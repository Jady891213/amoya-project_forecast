import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, BarChart3, RefreshCw, Search, X } from 'lucide-react'
import type { PivotDimension, PivotRequest, PivotResponse } from '../../shared/domain/types'
import type { ApiClient } from '../api/client'
import type { AppSnapshot } from '../state/types'

const DIMENSION_LABELS: Record<PivotDimension, string> = {
  project: '项目',
  department: '申报部门',
  version: '版本',
  period: '期间',
  metric: '指标',
}

const METRICS = [
  ['revenue', '收入'],
  ['cost', '成本'],
  ['gross_profit', '毛利'],
  ['gross_margin', '毛利率'],
  ['cash_inflow', '项目收款'],
  ['cash_outflow', '项目付款'],
  ['net_cash_flow', '项目净现金流'],
] as const
const METRIC_LABEL_ORDER = new Map<string, number>(METRICS.map(([, label], index) => [label, index]))

const PRESETS: Array<{ id: string; name: string; description: string; rows: PivotDimension[]; columns: PivotDimension[] }> = [
  { id: 'project-version', name: '项目 × 版本', description: '跨项目比较同一指标，也可查看同项目不同方案。', rows: ['project', 'metric'], columns: ['version'] },
  { id: 'version-period', name: '版本分月', description: '按版本展开期间，适合比较同一项目的方案走势。', rows: ['metric'], columns: ['version', 'period'] },
  { id: 'project-period', name: '项目分月', description: '项目和版本放在行轴，期间和指标放在列轴。', rows: ['project', 'version'], columns: ['period', 'metric'] },
]

interface Props {
  api: ApiClient
  snapshot: AppSnapshot
}

function formatValue(value: string | null, valueType: 'currency' | 'percentage') {
  if (value === null) return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  if (valueType === 'percentage') return `${(numeric * 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
  return (numeric / 10000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function MultidimensionalViewPage({ api, snapshot }: Props) {
  const initialRequest: PivotRequest = {
    rows: [...PRESETS[0].rows],
    columns: [...PRESETS[0].columns],
    filters: { metricCodes: METRICS.map(([code]) => code) },
  }
  const [draftRequest, setDraftRequest] = useState<PivotRequest>(initialRequest)
  const [request, setRequest] = useState<PivotRequest>(initialRequest)
  const [queryRevision, setQueryRevision] = useState(0)
  const [result, setResult] = useState<PivotResponse>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void api.pivot(request).then((next) => {
      if (!cancelled) setResult(next)
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof TypeError
        ? '无法连接本地数据服务，请重新启动应用后再查询。'
        : reason instanceof Error ? reason.message : '多维视图查询失败')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [api, queryRevision, request])

  const table = useMemo(() => {
    const rowMap = new Map<string, string[]>()
    const columnMap = new Map<string, string[]>()
    const cellMap = new Map<string, PivotResponse['cells'][number]>()
    result?.cells.forEach((cell) => {
      rowMap.set(cell.rowKey, cell.rowLabels)
      columnMap.set(cell.columnKey, cell.columnLabels)
      cellMap.set(`${cell.rowKey}\u001e${cell.columnKey}`, cell)
    })
    const compare = (dimensions: PivotDimension[]) => (
      left: [string, string[]], right: [string, string[]],
    ) => {
      for (let index = 0; index < dimensions.length; index += 1) {
        const leftLabel = left[1][index] ?? ''
        const rightLabel = right[1][index] ?? ''
        const difference = dimensions[index] === 'metric'
          ? (METRIC_LABEL_ORDER.get(leftLabel) ?? 999) - (METRIC_LABEL_ORDER.get(rightLabel) ?? 999)
          : leftLabel.localeCompare(rightLabel, 'zh-CN', { numeric: true })
        if (difference) return difference
      }
      return 0
    }
    return {
      rows: [...rowMap.entries()].sort(compare(request.rows)),
      columns: [...columnMap.entries()].sort(compare(request.columns)),
      cellMap,
    }
  }, [request.columns, request.rows, result])

  function applyPreset(preset: typeof PRESETS[number]) {
    const firstProjectId = snapshot.projects.find((item) => item.status === 'calculating')?.id
    setDraftRequest((current) => ({
      ...current,
      rows: [...preset.rows],
      columns: [...preset.columns],
      filters: {
        ...current.filters,
        projectIds: preset.id === 'version-period'
          ? current.filters?.projectIds?.length ? current.filters.projectIds : firstProjectId ? [firstProjectId] : undefined
          : current.filters?.projectIds,
      },
    }))
  }

  function addDimension(axis: 'rows' | 'columns', dimension: PivotDimension) {
    if (!dimension || draftRequest.rows.includes(dimension) || draftRequest.columns.includes(dimension)) return
    setDraftRequest((current) => ({ ...current, [axis]: [...current[axis], dimension] }))
  }

  function removeDimension(axis: 'rows' | 'columns', dimension: PivotDimension) {
    if (dimension === 'metric' && [...draftRequest.rows, ...draftRequest.columns].filter((item) => item === 'metric').length === 1) return
    if (draftRequest[axis].length === 1) return
    setDraftRequest((current) => ({ ...current, [axis]: current[axis].filter((item) => item !== dimension) }))
  }

  function toggleMetric(code: string) {
    const selected = draftRequest.filters?.metricCodes ?? []
    const next = selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code]
    if (!next.length) return
    setDraftRequest((current) => ({ ...current, filters: { ...current.filters, metricCodes: next } }))
  }

  function runQuery() {
    setRequest({
      ...draftRequest,
      rows: [...draftRequest.rows],
      columns: [...draftRequest.columns],
      filters: { ...draftRequest.filters },
    })
    setQueryRevision((current) => current + 1)
  }

  const used = new Set([...draftRequest.rows, ...draftRequest.columns])
  const available = (Object.keys(DIMENSION_LABELS) as PivotDimension[]).filter((item) => !used.has(item))
  const queryChanged = JSON.stringify(draftRequest) !== JSON.stringify(request)

  return <main className="page multidimensional-page">
    <div className="page-head">
      <div className="page-head-main"><h1>多维测算</h1><p>基于已计算的事实数据，比较不同项目、版本和期间；这里只读，不修改项目配置。</p></div>
      <div className="page-head-actions"><span className="pivot-context"><BarChart3 size={14} />场景：基准场景</span><button className="btn" disabled={loading} onClick={runQuery}><RefreshCw size={14} />刷新</button></div>
    </div>
    <div className="page-body multidimensional-body">
      <section className="pivot-control-panel">
        <div className="pivot-presets"><b>预置视图</b>{PRESETS.map((preset) => <button key={preset.id} className={draftRequest.rows.join() === preset.rows.join() && draftRequest.columns.join() === preset.columns.join() ? 'active' : ''} title={preset.description} onClick={() => applyPreset(preset)}>{preset.name}</button>)}</div>
        <div className="pivot-axis-editor">
          <AxisField title="行轴" dimensions={draftRequest.rows} available={available} onAdd={(dimension) => addDimension('rows', dimension)} onRemove={(dimension) => removeDimension('rows', dimension)} />
          <button className="pivot-swap" title="交换行列" aria-label="交换行列" onClick={() => setDraftRequest((current) => ({ ...current, rows: current.columns, columns: current.rows }))}><ArrowLeftRight size={16} /></button>
          <AxisField title="列轴" dimensions={draftRequest.columns} available={available} onAdd={(dimension) => addDimension('columns', dimension)} onRemove={(dimension) => removeDimension('columns', dimension)} />
        </div>
        <div className="pivot-filters">
          <label>项目<select aria-label="项目筛选" value={draftRequest.filters?.projectIds?.[0] ?? ''} onChange={(event) => setDraftRequest((current) => ({ ...current, filters: { ...current.filters, projectIds: event.target.value ? [event.target.value] : undefined } }))}><option value="">全部项目</option>{snapshot.projects.filter((item) => item.status === 'calculating').map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label>开始期间<input type="month" value={draftRequest.filters?.periodStart ?? ''} onChange={(event) => setDraftRequest((current) => ({ ...current, filters: { ...current.filters, periodStart: event.target.value || undefined } }))} /></label>
          <label>结束期间<input type="month" value={draftRequest.filters?.periodEnd ?? ''} onChange={(event) => setDraftRequest((current) => ({ ...current, filters: { ...current.filters, periodEnd: event.target.value || undefined } }))} /></label>
          <div className="pivot-metric-filter"><span>指标</span>{METRICS.map(([code, label]) => <button key={code} className={draftRequest.filters?.metricCodes?.includes(code) ? 'active' : ''} onClick={() => toggleMetric(code)}>{label}</button>)}</div>
          <div className="pivot-query-actions">{queryChanged && <span>条件已调整</span>}<button className="btn primary" disabled={loading} onClick={runQuery}><Search size={14} />{loading ? '查询中' : '查询'}</button></div>
        </div>
      </section>

      <section className="pivot-table-panel">
        <div className="pivot-table-head"><div><b>事实数据透视表</b><span>金额单位：万元 · 比例：%</span></div><span>{loading ? '正在刷新…' : `读取 ${result?.sourceFactCount ?? 0} 条基础事实`}</span></div>
        {error && <div className="page-alert error">{error}</div>}
        {!error && <div className="pivot-table-scroll"><table className="data-table pivot-table"><thead><tr><th className="pivot-row-axis-head">{request.rows.map((item) => DIMENSION_LABELS[item]).join(' / ')}</th>{table.columns.map(([key, labels]) => <th key={key}>{labels.map((label) => <span key={label}>{label}</span>)}</th>)}</tr></thead><tbody>{table.rows.map(([rowKey, labels]) => <tr key={rowKey}><th>{labels.map((label, index) => <span key={`${label}:${index}`} className={index === labels.length - 1 ? 'pivot-row-primary' : ''}>{label}</span>)}</th>{table.columns.map(([columnKey]) => { const cell = table.cellMap.get(`${rowKey}\u001e${columnKey}`); return <td key={columnKey}>{cell ? formatValue(cell.value, cell.valueType) : '—'}</td> })}</tr>)}{!loading && !table.rows.length && <tr><td colSpan={Math.max(2, table.columns.length + 1)} className="empty-cell">当前筛选范围尚无已计算事实。请先在项目中完成计算，或调整筛选条件。</td></tr>}</tbody></table></div>}
      </section>
    </div>
  </main>
}

function AxisField({ title, dimensions, available, onAdd, onRemove }: {
  title: string
  dimensions: PivotDimension[]
  available: PivotDimension[]
  onAdd: (dimension: PivotDimension) => void
  onRemove: (dimension: PivotDimension) => void
}) {
  return <div className="pivot-axis-field"><b>{title}</b><div>{dimensions.map((dimension) => <span key={dimension}>{DIMENSION_LABELS[dimension]}<button aria-label={`移除${DIMENSION_LABELS[dimension]}`} onClick={() => onRemove(dimension)}><X size={12} /></button></span>)}<select aria-label={`${title}添加维度`} value="" onChange={(event) => onAdd(event.target.value as PivotDimension)}><option value="">＋ 添加维度</option>{available.map((dimension) => <option key={dimension} value={dimension}>{DIMENSION_LABELS[dimension]}</option>)}</select></div></div>
}
