import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, BarChart3, ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen, Search } from 'lucide-react'
import type { PivotAxisDimension, PivotDimension, PivotMetadata, PivotRequest, PivotResponse, PivotTuple } from '../../shared/domain/types'
import type { ApiClient } from '../api/client'
import { gridSelectionText, useGridSelection, type GridCellPosition } from '../components/useGridSelection'
import type { AppSnapshot } from '../state/types'

const LABELS: Record<PivotDimension, string> = { project: '项目', plan: '方案', department: '申报部门', period: '期间', metric: '指标' }
const ALL_PROJECTS = '__all_projects__'
const ALL_DEPARTMENTS = '__all_departments__'
const PIVOT_PAGE_CACHE_KEY = 'amoya-project-report-pivot-v1'

interface Props { api: ApiClient; snapshot: AppSnapshot }
type Placement = 'rows' | 'columns' | 'pov'

function memberIds(metadata: PivotMetadata, dimension: PivotDimension, excludeVirtual = false) {
  return metadata.dimensions.find((item) => item.dimension === dimension)?.members
    .filter((item) => !excludeVirtual || !item.id.startsWith('__all_')).map((item) => item.id) ?? []
}

function plansForProject(metadata: PivotMetadata, projectId: string) {
  return metadata.dimensions.find((item) => item.dimension === 'plan')?.members
    .filter((item) => !item.id.startsWith('__all_') && (projectId === ALL_PROJECTS || item.parentId === projectId)) ?? []
}

function normalizeProjectPlanHierarchy(axis: PivotAxisDimension[]) {
  const projectIndex = axis.findIndex((item) => item.dimension === 'project')
  const planIndex = axis.findIndex((item) => item.dimension === 'plan')
  if (projectIndex < 0 || planIndex < 0 || planIndex === projectIndex + 1) return axis
  const pairStart = Math.min(projectIndex, planIndex)
  const project = axis[projectIndex]
  const plan = axis[planIndex]
  const rest = axis.filter((item) => item.dimension !== 'project' && item.dimension !== 'plan')
  rest.splice(pairStart, 0, project, plan)
  return rest
}

function defaultRequest(metadata: PivotMetadata): PivotRequest {
  return {
    rows: [
      { dimension: 'plan', memberIds: memberIds(metadata, 'plan', true) },
      { dimension: 'metric', memberIds: memberIds(metadata, 'metric', true) },
    ],
    columns: [{ dimension: 'period', memberIds: memberIds(metadata, 'period', true) }],
    pov: [
      { dimension: 'project', memberId: ALL_PROJECTS },
      { dimension: 'department', memberId: ALL_DEPARTMENTS },
    ],
    scenarioId: 'baseline',
  }
}

function cachedRequest(metadata: PivotMetadata): PivotRequest {
  const fallback = defaultRequest(metadata)
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PIVOT_PAGE_CACHE_KEY) ?? '') as PivotRequest
    if (!Array.isArray(parsed.rows) || !Array.isArray(parsed.columns) || !Array.isArray(parsed.pov)) return fallback
    const dimensions = [...parsed.rows, ...parsed.columns, ...parsed.pov].map((item) => item.dimension)
    if (!parsed.rows.length || !parsed.columns.length || dimensions.length !== 5 || new Set(dimensions).size !== 5 || dimensions.some((item) => !(item in LABELS))) return fallback
    if ([...parsed.rows, ...parsed.columns].some((item) => !Array.isArray(item.memberIds) || !item.memberIds.length)) return fallback
    if (parsed.pov.some((item) => typeof item.memberId !== 'string' || !item.memberId)) return fallback
    return { ...parsed, scenarioId: 'baseline' }
  } catch {
    return fallback
  }
}

function savePageCache(request: PivotRequest) {
  window.localStorage.setItem(PIVOT_PAGE_CACHE_KEY, JSON.stringify(request))
}

function formatValue(value: string | null, valueType: 'currency' | 'percentage', unit = 10_000, decimals = 2, grouping = true, negativeStyle: 'minus' | 'parentheses' = 'minus') {
  if (value === null) return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  const scaled = valueType === 'percentage' ? number * 100 : number / unit
  const formatted = Math.abs(scaled).toLocaleString(grouping ? 'zh-CN' : 'en-US', { useGrouping: grouping, minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  if (scaled < 0) return negativeStyle === 'parentheses' ? `(${formatted})${valueType === 'percentage' ? '%' : ''}` : `-${formatted}${valueType === 'percentage' ? '%' : ''}`
  return `${formatted}${valueType === 'percentage' ? '%' : ''}`
}

export function MultidimensionalViewPage({ api }: Props) {
  const [metadata, setMetadata] = useState<PivotMetadata>()
  const [draft, setDraft] = useState<PivotRequest>()
  const [executed, setExecuted] = useState<PivotRequest>()
  const [backgroundPov, setBackgroundPov] = useState<PivotRequest['pov']>([])
  const [result, setResult] = useState<PivotResponse>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [configurationOpen, setConfigurationOpen] = useState(true)
  const [hideNoDataRows, setHideNoDataRows] = useState(false)

  useEffect(() => {
    let active = true
    void api.pivotMetadata().then((next) => {
      if (!active) return
      setMetadata(next)
      const initial = cachedRequest(next)
      setDraft(initial)
      setExecuted(initial)
      setBackgroundPov(initial.pov)
    }).catch((reason) => setError(reason instanceof Error ? reason.message : '项目报表元数据加载失败'))
    return () => { active = false }
  }, [api])

  useEffect(() => {
    if (!executed) return
    let active = true
    setLoading(true); setError('')
    void api.pivot(executed).then((next) => { if (active) setResult(next) })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '项目报表查询失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, executed])

  const changed = Boolean(draft && executed && JSON.stringify(draft) !== JSON.stringify(executed))
  const backgroundChanged = Boolean(executed && JSON.stringify(backgroundPov) !== JSON.stringify(executed.pov))
  const selectionComplete = Boolean(draft && [...draft.rows, ...draft.columns].every((item) => item.memberIds.length > 0))
  const placement = (dimension: PivotDimension): Placement => draft?.rows.some((item) => item.dimension === dimension) ? 'rows' : draft?.columns.some((item) => item.dimension === dimension) ? 'columns' : 'pov'

  function move(dimension: PivotDimension, target: Placement) {
    if (!draft || !metadata || placement(dimension) === target) return
    const rows = draft.rows.filter((item) => item.dimension !== dimension)
    const columns = draft.columns.filter((item) => item.dimension !== dimension)
    const pov = draft.pov.filter((item) => item.dimension !== dimension)
    if (target === 'rows' || target === 'columns') {
      const projectPov = pov.find((item) => item.dimension === 'project')?.memberId ?? ALL_PROJECTS
      const axis = { dimension, memberIds: dimension === 'plan' ? plansForProject(metadata, projectPov).map((item) => item.id) : memberIds(metadata, dimension, true) }
      target === 'rows' ? rows.push(axis) : columns.push(axis)
    } else {
      const members = metadata.dimensions.find((item) => item.dimension === dimension)?.members ?? []
      const projectPov = pov.find((item) => item.dimension === 'project')?.memberId ?? ALL_PROJECTS
      const defaultMember = dimension === 'project' ? ALL_PROJECTS : dimension === 'department' ? ALL_DEPARTMENTS : dimension === 'plan' ? plansForProject(metadata, projectPov)[0]?.id ?? '' : members.find((item) => !item.id.startsWith('__all_'))?.id ?? ''
      pov.push({ dimension, memberId: defaultMember })
    }
    if (!rows.length || !columns.length) return
    setDraft({ ...draft, rows: normalizeProjectPlanHierarchy(rows), columns: normalizeProjectPlanHierarchy(columns), pov })
  }

  function updateAxis(dimension: PivotDimension, ids: string[]) {
    if (!draft || !metadata) return
    const replace = (axis: PivotAxisDimension[]) => axis.map((item) => item.dimension === dimension ? { ...item, memberIds: ids } : item)
    let rows = replace(draft.rows)
    let columns = replace(draft.columns)
    if (dimension === 'project') {
      const validPlanIds = plansForProject(metadata, ALL_PROJECTS).filter((item) => ids.includes(item.parentId ?? '')).map((item) => item.id)
      rows = rows.map((item) => item.dimension === 'plan' ? { ...item, memberIds: validPlanIds } : item)
      columns = columns.map((item) => item.dimension === 'plan' ? { ...item, memberIds: validPlanIds } : item)
    }
    setDraft({ ...draft, rows, columns })
  }

  function updateBackground(dimension: PivotDimension, memberId: string) {
    if (!metadata) return
    let next = backgroundPov.map((item) => item.dimension === dimension ? { ...item, memberId } : item)
    if (dimension === 'project') {
      const planIds = plansForProject(metadata, memberId).map((item) => item.id)
      next = next.map((item) => item.dimension === 'plan' && !planIds.includes(item.memberId) ? { ...item, memberId: planIds[0] ?? '' } : item)
    }
    setBackgroundPov(next)
  }

  function requestWithBackground(request: PivotRequest) {
    if (!metadata) return request
    const projectMember = request.pov.find((item) => item.dimension === 'project')?.memberId ?? ALL_PROJECTS
    const planIds = plansForProject(metadata, projectMember).map((item) => item.id)
    return {
      ...request,
      rows: request.rows.map((item) => item.dimension === 'plan' ? { ...item, memberIds: planIds } : item),
      columns: request.columns.map((item) => item.dimension === 'plan' ? { ...item, memberIds: planIds } : item),
      pov: request.pov.map((item) => item.dimension === 'plan' && !planIds.includes(item.memberId) ? { ...item, memberId: planIds[0] ?? '' } : item),
    }
  }

  function queryBackground() {
    if (!executed) return
    const next = requestWithBackground({ ...executed, pov: backgroundPov })
    setExecuted(next)
    setDraft((current) => current ? { ...current, rows: next.rows, columns: next.columns, pov: next.pov } : current)
    setBackgroundPov(next.pov)
    savePageCache(next)
  }

  function confirmConfiguration() {
    if (!draft || !selectionComplete) return
    const next = requestWithBackground({ ...draft, pov: draft.pov.map((item) => backgroundPov.find((candidate) => candidate.dimension === item.dimension) ?? item) })
    setDraft(next)
    setExecuted(structuredClone(next))
    setBackgroundPov(next.pov)
    savePageCache(next)
    setConfigurationOpen(false)
  }

  function reorderAxis(dimension: PivotDimension, direction: -1 | 1) {
    if (!draft) return
    const reorder = (axis: PivotAxisDimension[]) => {
      const index = axis.findIndex((item) => item.dimension === dimension)
      if (index < 0 || index + direction < 0 || index + direction >= axis.length) return axis
      const next = [...axis]
      const [item] = next.splice(index, 1)
      next.splice(index + direction, 0, item)
      return normalizeProjectPlanHierarchy(next)
    }
    setDraft({ ...draft, rows: reorder(draft.rows), columns: reorder(draft.columns) })
  }

  return <main className="page multidimensional-page">
    <div className="page-head"><div className="page-head-main"><h1>项目报表</h1><p>按方案、项目、部门、期间和指标自由组织只读事实视图。</p></div><div className="page-head-actions"><span className="pivot-context"><BarChart3 size={14} />场景：基准场景</span></div></div>
    <div className={`page-body multidimensional-body pivot-report-workbench ${configurationOpen ? 'configuration-open' : 'configuration-closed'}`}>
      <section className="pivot-table-panel"><div className="pivot-table-head"><div className="pivot-background-controls">{executed && metadata && backgroundPov.length ? backgroundPov.map((item) => {
        const projectMember = backgroundPov.find((candidate) => candidate.dimension === 'project')?.memberId ?? ALL_PROJECTS
        const members = item.dimension === 'plan' ? plansForProject(metadata, projectMember) : metadata.dimensions.find((dimension) => dimension.dimension === item.dimension)?.members ?? []
        return <label key={item.dimension}><span>{LABELS[item.dimension]}</span><select value={item.memberId} onChange={(event) => updateBackground(item.dimension, event.target.value)}>{members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}</select></label>
      }) : <span className="pivot-no-background">无背景筛选</span>}</div><div className="pivot-table-head-actions">{executed && <><label className="pivot-display-toggle"><input type="checkbox" checked={hideNoDataRows} onChange={(event) => setHideNoDataRows(event.target.checked)} />隐藏无数据行</label><span className="pivot-query-status">{backgroundChanged ? '条件已调整' : ''}</span><button className="btn primary" disabled={loading || !backgroundChanged} onClick={queryBackground}><Search size={14} />{loading ? '查询中' : '查询'}</button><button className="btn pivot-drawer-toggle" onClick={() => setConfigurationOpen((current) => !current)}>{configurationOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}{configurationOpen ? '收起配置' : '展开配置'}</button></>}</div></div>{error && <div className="page-alert error">{error}</div>}{!error && executed && <PivotGrid request={executed} result={result} hideNoDataRows={hideNoDataRows} />}</section>
      {draft && metadata && <aside className="pivot-config-drawer" aria-hidden={!configurationOpen}>
        <div className="pivot-config-drawer-head"><div><b>报表配置</b><span>设置背景、行轴和列轴</span></div><button type="button" aria-label="收起报表配置" onClick={() => setConfigurationOpen(false)}><PanelRightClose size={15} /></button></div>
        <div className="pivot-config-drawer-body">
          <section className="pivot-config-section"><div className="pivot-config-section-head"><b>1. 背景</b><span>成员在表格顶部选择</span></div><div className="pivot-config-list">{draft.pov.map((item) => <div className="pivot-background-config-row" key={item.dimension}><b>{LABELS[item.dimension]}</b><select className="pivot-placement-select" value="pov" onChange={(event) => move(item.dimension, event.target.value as Placement)}><option value="pov">背景</option><option value="rows">行轴</option><option value="columns">列轴</option></select></div>)}</div></section>
          <AxisArea title="2. 行轴" placement="rows" dimensions={draft.rows.map((item) => item.dimension)} metadata={metadata} request={draft} onMove={move} onMembers={updateAxis} onReorder={reorderAxis} />
          <div className="pivot-axis-swap-row"><button className="btn" title="交换行列" onClick={() => setDraft({ ...draft, rows: draft.columns, columns: draft.rows })}><ArrowLeftRight size={14} />交换行列</button></div>
          <AxisArea title="3. 列轴" placement="columns" dimensions={draft.columns.map((item) => item.dimension)} metadata={metadata} request={draft} onMove={move} onMembers={updateAxis} onReorder={reorderAxis} />
        </div>
        <div className="pivot-config-drawer-footer"><span>{!selectionComplete ? '请至少选择一个成员' : changed ? '配置已修改' : '配置未修改'}</span><button className="btn primary" disabled={!selectionComplete || loading} onClick={confirmConfiguration}>确认</button></div>
      </aside>}
    </div>
  </main>
}

function AxisArea({ title, placement, dimensions, metadata, request, onMove, onMembers, onReorder }: { title: string; placement: Placement; dimensions: PivotDimension[]; metadata: PivotMetadata; request: PivotRequest; onMove: (dimension: PivotDimension, target: Placement) => void; onMembers: (dimension: PivotDimension, ids: string[]) => void; onReorder: (dimension: PivotDimension, direction: -1 | 1) => void }) {
  return <section className="pivot-config-section"><div className="pivot-config-section-head"><b>{title}</b><span>{dimensions.length} 个维度，顺序决定表头层级</span></div><div className="pivot-config-list">{dimensions.map((dimension) => {
    const axis = [...request.rows, ...request.columns].find((item) => item.dimension === dimension)!
    return <div className="pivot-axis-config-row" key={dimension}><AxisDimensionChip dimension={dimension} axis={axis} axisIndex={dimensions.indexOf(dimension)} axisCount={dimensions.length} metadata={metadata} onMembers={onMembers} onReorder={onReorder} /><select className="pivot-placement-select" aria-label={`移动${LABELS[dimension]}`} value={placement} onChange={(event) => onMove(dimension, event.target.value as Placement)}><option value="rows">行轴</option><option value="columns">列轴</option><option value="pov">背景</option></select></div>
  })}<select className="pivot-add-dimension" value="" onChange={(event) => event.target.value && onMove(event.target.value as PivotDimension, placement)}><option value="">＋ 添加维度</option>{(['project', 'plan', 'department', 'period', 'metric'] as PivotDimension[]).filter((item) => !dimensions.includes(item)).map((item) => <option key={item} value={item}>{LABELS[item]}</option>)}</select></div></section>
}

function AxisDimensionChip({ dimension, axis, axisIndex, axisCount, metadata, onMembers, onReorder }: { dimension: PivotDimension; axis: PivotAxisDimension; axisIndex: number; axisCount: number; metadata: PivotMetadata; onMembers: (dimension: PivotDimension, ids: string[]) => void; onReorder: (dimension: PivotDimension, direction: -1 | 1) => void }) {
  const [searchText, setSearchText] = useState('')
  const members = metadata.dimensions.find((item) => item.dimension === dimension)?.members.filter((item) => !item.id.startsWith('__all_')) ?? []
  const selectedIndexes = axis.memberIds.map((id) => members.findIndex((member) => member.id === id)).filter((index) => index >= 0).sort((a, b) => a - b)
  const rangeStart = selectedIndexes[0] ?? 0
  const rangeEnd = selectedIndexes.at(-1) ?? Math.max(0, members.length - 1)
  const filtered = members.filter((member) => member.label.toLowerCase().includes(searchText.trim().toLowerCase()) || (member.parentId ? metadata.dimensions.find((item) => item.dimension === 'project')?.members.find((project) => project.id === member.parentId)?.label.includes(searchText.trim()) : false))
  const applyPeriodRange = (start: number, end: number) => onMembers(dimension, members.slice(Math.min(start, end), Math.max(start, end) + 1).map((item) => item.id))
  const projectName = (projectId?: string) => metadata.dimensions.find((item) => item.dimension === 'project')?.members.find((project) => project.id === projectId)?.label ?? ''
  const groupedPlans = dimension === 'plan' ? [...new Set(filtered.map((item) => item.parentId ?? ''))].map((parentId) => ({ parentId, members: filtered.filter((item) => item.parentId === parentId) })) : []
  const renderMember = (member: (typeof members)[number]) => <label key={member.id}><input type="checkbox" checked={axis.memberIds.includes(member.id)} onChange={() => onMembers(dimension, axis.memberIds.includes(member.id) ? axis.memberIds.filter((id) => id !== member.id) : [...axis.memberIds, member.id])} /><span>{member.label}</span></label>
  return <details className="pivot-dimension-chip"><summary>{LABELS[dimension]}（{dimension === 'period' && axis.memberIds.length ? `${members[rangeStart]?.label}—${members[rangeEnd]?.label}，${axis.memberIds.length}期` : axis.memberIds.length}）</summary><div className="pivot-member-popover">
    <div className="pivot-member-actions"><button disabled={axisIndex === 0} onClick={() => onReorder(dimension, -1)}><ChevronLeft size={13} />前移</button><button disabled={axisIndex === axisCount - 1} onClick={() => onReorder(dimension, 1)}>后移<ChevronRight size={13} /></button><span /><button onClick={() => onMembers(dimension, filtered.map((item) => item.id))}>全选</button><button onClick={() => onMembers(dimension, [])}>清空</button></div>
    {dimension === 'period' && <div className="pivot-period-range"><select value={rangeStart} onChange={(event) => applyPeriodRange(Number(event.target.value), rangeEnd)}>{members.map((member, index) => <option key={member.id} value={index}>{member.label}</option>)}</select><span>至</span><select value={rangeEnd} onChange={(event) => applyPeriodRange(rangeStart, Number(event.target.value))}>{members.map((member, index) => <option key={member.id} value={index}>{member.label}</option>)}</select></div>}
    {dimension !== 'period' && <label className="pivot-member-search"><Search size={13} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={`搜索${LABELS[dimension]}`} /></label>}
    <div className="pivot-member-list">{dimension === 'plan' ? groupedPlans.map((group) => <div className="pivot-member-group" key={group.parentId}><b>{projectName(group.parentId)}</b>{group.members.map(renderMember)}</div>) : filtered.map(renderMember)}</div>
  </div></details>
}

function spanLength(tuples: PivotTuple[], tupleIndex: number, level: number) {
  const target = tuples[tupleIndex]
  let count = 1
  for (let index = tupleIndex + 1; index < tuples.length; index += 1) {
    if (target.members.slice(0, level + 1).some((member, i) => member.memberId !== tuples[index].members[i]?.memberId)) break
    count += 1
  }
  return count
}

function isRepeated(tuples: PivotTuple[], tupleIndex: number, level: number) {
  if (!tupleIndex) return false
  return tuples[tupleIndex].members.slice(0, level + 1).every((member, i) => member.memberId === tuples[tupleIndex - 1].members[i]?.memberId)
}

function PivotGrid({ request, result, hideNoDataRows }: { request: PivotRequest; result?: PivotResponse; hideNoDataRows: boolean }) {
  const [unit, setUnit] = useState(10_000)
  const [decimals, setDecimals] = useState(2)
  const [grouping, setGrouping] = useState(true)
  const [negativeStyle, setNegativeStyle] = useState<'minus' | 'parentheses'>('minus')
  const allRows = result?.rowTuples ?? []
  const columns = result?.columnTuples ?? []
  const root = useRef<HTMLDivElement>(null)
  const cells = useMemo(() => new Map(result?.cells.map((cell) => [`${cell.rowKey}\u001e${cell.columnKey}`, cell]) ?? []), [result])
  const rows = useMemo(
    () => hideNoDataRows
      ? allRows.filter((row) => columns.some((column) => {
        const cell = cells.get(`${row.key}\u001e${column.key}`)
        return cell?.value !== null && cell?.value !== '' && cell?.value !== undefined
      }))
      : allRows,
    [allRows, cells, columns, hideNoDataRows],
  )
  const selection = useGridSelection(rows.length, columns.length, { initialSelection: false })

  function focusCell(position: GridCellPosition, extend = false) {
    selection.selectCell(position, extend)
    const next = {
      row: Math.max(0, Math.min(rows.length - 1, position.row)),
      column: Math.max(0, Math.min(columns.length - 1, position.column)),
    }
    requestAnimationFrame(() => {
      root.current?.querySelector<HTMLElement>(`[data-cell="${next.row}:${next.column}"]`)?.focus()
    })
  }

  function selectionText() {
    if (!selection.bounds) return ''
    return gridSelectionText(
      selection.bounds,
      (rowIndex, columnIndex) => cells.get(`${rows[rowIndex]?.key}\u001e${columns[columnIndex]?.key}`)?.value ?? '',
    )
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!selection.focus) return
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      Tab: [0, event.shiftKey ? -1 : 1],
      Enter: [event.shiftKey ? -1 : 1, 0],
    }
    const delta = deltas[event.key]
    if (!delta) return
    event.preventDefault()
    focusCell(
      { row: selection.focus.row + delta[0], column: selection.focus.column + delta[1] },
      event.shiftKey && event.key.startsWith('Arrow'),
    )
  }

  if (!result || !allRows.length || !columns.length) return <div className="pivot-empty">当前条件下没有已计算事实。</div>
  return <><div className="pivot-format-toolbar"><label>单位<select value={unit} onChange={(event) => setUnit(Number(event.target.value))}><option value={1}>元</option><option value={1000}>千元</option><option value={10000}>万元</option></select></label><label>小数<select value={decimals} onChange={(event) => setDecimals(Number(event.target.value))}><option value={0}>0 位</option><option value={1}>1 位</option><option value={2}>2 位</option><option value={4}>4 位</option></select></label><label><input type="checkbox" checked={grouping} onChange={(event) => setGrouping(event.target.checked)} />千分位</label><label>负数<select value={negativeStyle} onChange={(event) => setNegativeStyle(event.target.value as 'minus' | 'parentheses')}><option value="minus">-1,234.56</option><option value="parentheses">(1,234.56)</option></select></label><span>{hideNoDataRows ? `显示 ${rows.length} 行 · ` : ''}{result.sourceFactCount} 条数据</span></div>{rows.length ? <div
    className="pivot-table-scroll unified-grid-selection"
    ref={root}
    role="grid"
    aria-label="项目报表数据表格"
    tabIndex={-1}
    onKeyDown={onKeyDown}
    onMouseUp={selection.endDrag}
    onCopy={(event) => {
      if (!selection.bounds) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', selectionText())
    }}
  ><table className="pivot-table pivot-grid"><thead>{request.columns.map((axis, level) => <tr key={axis.dimension}>{level === 0 && request.rows.map((rowAxis) => <th key={rowAxis.dimension} rowSpan={request.columns.length} className="pivot-corner" onMouseDown={() => { selection.selectAll(); root.current?.focus() }}>{LABELS[rowAxis.dimension]}</th>)}{columns.map((tuple, index) => {
    if (isRepeated(columns, index, level)) return null
    const span = spanLength(columns, index, level)
    return <th key={`${tuple.key}:${level}`} colSpan={span} onMouseDown={() => { selection.selectColumns(index, index + span - 1); root.current?.focus() }}>{tuple.members[level]?.label}</th>
  })}</tr>)}</thead><tbody>{rows.map((row, rowIndex) => <tr key={row.key}>{request.rows.map((axis, level) => {
    if (isRepeated(rows, rowIndex, level)) return null
    const span = spanLength(rows, rowIndex, level)
    return <th key={axis.dimension} rowSpan={span} onMouseDown={() => { selection.selectRows(rowIndex, rowIndex + span - 1); root.current?.focus() }}>{row.members[level]?.label}</th>
  })}{columns.map((column, columnIndex) => {
    const cell = cells.get(`${row.key}\u001e${column.key}`)
    const isSelected = selection.isSelected(rowIndex, columnIndex)
    return <td
      key={column.key}
      data-cell={`${rowIndex}:${columnIndex}`}
      tabIndex={rowIndex === selection.focus?.row && columnIndex === selection.focus?.column ? 0 : -1}
      className={isSelected ? 'selected grid-selected-cell' : ''}
      aria-selected={isSelected}
      onMouseDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        selection.startDrag({ row: rowIndex, column: columnIndex }, event.shiftKey)
        requestAnimationFrame(() => {
          root.current?.querySelector<HTMLElement>(`[data-cell="${rowIndex}:${columnIndex}"]`)?.focus()
        })
      }}
      onMouseEnter={() => {
        if (selection.dragging.current) selection.extendSelection({ row: rowIndex, column: columnIndex })
      }}
      onMouseUp={selection.endDrag}
    >{cell ? formatValue(cell.value, cell.valueType, unit, decimals, grouping, negativeStyle) : '—'}</td>
  })}</tr>)}</tbody></table></div> : <div className="pivot-empty">没有包含数据的行。</div>}</>
}
