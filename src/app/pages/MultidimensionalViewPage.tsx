import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, BarChart3, ChevronLeft, ChevronRight, Copy, Search } from 'lucide-react'
import type { PivotAxisDimension, PivotDimension, PivotMetadata, PivotRequest, PivotResponse, PivotTuple } from '../../shared/domain/types'
import type { ApiClient } from '../api/client'
import type { AppSnapshot } from '../state/types'

const LABELS: Record<PivotDimension, string> = { project: '项目', plan: '方案', department: '申报部门', period: '期间', metric: '指标' }
const ALL_PROJECTS = '__all_projects__'
const ALL_DEPARTMENTS = '__all_departments__'

interface Props { api: ApiClient; snapshot: AppSnapshot }
type Placement = 'rows' | 'columns' | 'pov'
type CellPoint = { row: number; column: number }

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
  const [result, setResult] = useState<PivotResponse>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void api.pivotMetadata().then((next) => {
      if (!active) return
      setMetadata(next)
      const initial = defaultRequest(next)
      setDraft(initial)
      setExecuted(initial)
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

  function updatePov(dimension: PivotDimension, memberId: string) {
    if (!draft) return
    let next = { ...draft, pov: draft.pov.map((item) => item.dimension === dimension ? { ...item, memberId } : item) }
    if (dimension === 'project') {
      const planIds = plansForProject(metadata!, memberId).map((item) => item.id)
      next = {
        ...next,
        rows: next.rows.map((item) => item.dimension === 'plan' ? { ...item, memberIds: planIds } : item),
        columns: next.columns.map((item) => item.dimension === 'plan' ? { ...item, memberIds: planIds } : item),
        pov: next.pov.map((item) => item.dimension === 'plan' && !planIds.includes(item.memberId) ? { ...item, memberId: planIds[0] ?? '' } : item),
      }
    }
    setDraft(next)
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
    <div className="page-body multidimensional-body">
      {draft && metadata && <section className="pivot-control-panel">
        <div className="pivot-axis-editor">
          <AxisArea title="行轴" placement="rows" dimensions={draft.rows.map((item) => item.dimension)} metadata={metadata} request={draft} onMove={move} onMembers={updateAxis} onReorder={reorderAxis} />
          <button className="pivot-swap" title="交换行列" onClick={() => setDraft({ ...draft, rows: draft.columns, columns: draft.rows })}><ArrowLeftRight size={16} /></button>
          <AxisArea title="列轴" placement="columns" dimensions={draft.columns.map((item) => item.dimension)} metadata={metadata} request={draft} onMove={move} onMembers={updateAxis} onReorder={reorderAxis} />
        </div>
        <div className="pivot-pov-row"><b>POV</b>{draft.pov.map((item) => <label key={item.dimension}>{LABELS[item.dimension]}<select value={item.memberId} onChange={(event) => updatePov(item.dimension, event.target.value)}>{metadata.dimensions.find((d) => d.dimension === item.dimension)?.members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}</select><select className="pivot-placement-select" value="pov" onChange={(event) => move(item.dimension, event.target.value as Placement)}><option value="pov">POV</option><option value="rows">行轴</option><option value="columns">列轴</option></select></label>)}</div>
        <div className="pivot-query-actions">{!selectionComplete ? <span>请至少选择一个成员</span> : changed && <span>条件已调整</span>}<button className="btn primary" disabled={loading || !selectionComplete || !changed && Boolean(result)} onClick={() => setExecuted(structuredClone(draft))}><Search size={14} />{loading ? '查询中' : '查询'}</button></div>
      </section>}
      <section className="pivot-table-panel"><div className="pivot-table-head"><div><b>事实数据透视表</b><span>金额单位：万元 · 比例：%</span></div><span>{loading ? '正在查询…' : `读取 ${result?.sourceFactCount ?? 0} 条基础事实`}</span></div>{error && <div className="page-alert error">{error}</div>}{!error && executed && <PivotGrid request={executed} result={result} />}</section>
    </div>
  </main>
}

function AxisArea({ title, placement, dimensions, metadata, request, onMove, onMembers, onReorder }: { title: string; placement: Placement; dimensions: PivotDimension[]; metadata: PivotMetadata; request: PivotRequest; onMove: (dimension: PivotDimension, target: Placement) => void; onMembers: (dimension: PivotDimension, ids: string[]) => void; onReorder: (dimension: PivotDimension, direction: -1 | 1) => void }) {
  return <div className="pivot-axis-field"><b>{title}</b><div>{dimensions.map((dimension) => {
    const axis = [...request.rows, ...request.columns].find((item) => item.dimension === dimension)!
    return <AxisDimensionChip key={dimension} dimension={dimension} axis={axis} axisIndex={dimensions.indexOf(dimension)} axisCount={dimensions.length} metadata={metadata} onMembers={onMembers} onReorder={onReorder} />
  })}<select value="" onChange={(event) => event.target.value && onMove(event.target.value as PivotDimension, placement)}><option value="">＋ 添加维度</option>{(['project', 'plan', 'department', 'period', 'metric'] as PivotDimension[]).filter((item) => !dimensions.includes(item)).map((item) => <option key={item} value={item}>{LABELS[item]}</option>)}</select>{dimensions.map((dimension) => <select key={`${dimension}:move`} className="pivot-placement-select" aria-label={`移动${LABELS[dimension]}`} value={placement} onChange={(event) => onMove(dimension, event.target.value as Placement)}><option value="rows">{LABELS[dimension]} → 行轴</option><option value="columns">{LABELS[dimension]} → 列轴</option><option value="pov">{LABELS[dimension]} → POV</option></select>)}</div></div>
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

function PivotGrid({ request, result }: { request: PivotRequest; result?: PivotResponse }) {
  const [anchor, setAnchor] = useState<CellPoint>()
  const [focus, setFocus] = useState<CellPoint>()
  const dragging = useRef(false)
  const [unit, setUnit] = useState(10_000)
  const [decimals, setDecimals] = useState(2)
  const [grouping, setGrouping] = useState(true)
  const [negativeStyle, setNegativeStyle] = useState<'minus' | 'parentheses'>('minus')
  const rows = result?.rowTuples ?? []
  const columns = result?.columnTuples ?? []
  const cells = useMemo(() => new Map(result?.cells.map((cell) => [`${cell.rowKey}\u001e${cell.columnKey}`, cell]) ?? []), [result])
  const selected = (row: number, column: number) => anchor && focus && row >= Math.min(anchor.row, focus.row) && row <= Math.max(anchor.row, focus.row) && column >= Math.min(anchor.column, focus.column) && column <= Math.max(anchor.column, focus.column)

  useEffect(() => {
    const up = () => { dragging.current = false }
    window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up)
  }, [])
  useEffect(() => {
    const copy = (event: ClipboardEvent) => {
      if (!anchor || !focus || !result) return
      const r0 = Math.min(anchor.row, focus.row), r1 = Math.max(anchor.row, focus.row), c0 = Math.min(anchor.column, focus.column), c1 = Math.max(anchor.column, focus.column)
      const columnHeaders = request.columns.map((_, level) => [
        ...request.rows.map((axis, index) => level === request.columns.length - 1 ? LABELS[axis.dimension] : ''),
        ...columns.slice(c0, c1 + 1).map((column) => column.members[level]?.label ?? ''),
      ].join('\t'))
      const lines = [...columnHeaders, ...rows.slice(r0, r1 + 1).map((row) => [...row.members.map((member) => member.label), ...columns.slice(c0, c1 + 1).map((column) => { const cell = cells.get(`${row.key}\u001e${column.key}`); return cell?.value ?? '' })].join('\t'))]
      event.clipboardData?.setData('text/plain', lines.join('\n')); event.preventDefault()
    }
    document.addEventListener('copy', copy); return () => document.removeEventListener('copy', copy)
  }, [anchor, focus, result, rows, columns, cells])

  if (!result || !rows.length || !columns.length) return <div className="pivot-empty">当前条件下没有已计算事实。</div>
  return <><div className="pivot-format-toolbar"><label>单位<select value={unit} onChange={(event) => setUnit(Number(event.target.value))}><option value={1}>元</option><option value={1000}>千元</option><option value={10000}>万元</option></select></label><label>小数<select value={decimals} onChange={(event) => setDecimals(Number(event.target.value))}><option value={0}>0 位</option><option value={1}>1 位</option><option value={2}>2 位</option><option value={4}>4 位</option></select></label><label><input type="checkbox" checked={grouping} onChange={(event) => setGrouping(event.target.checked)} />千分位</label><label>负数<select value={negativeStyle} onChange={(event) => setNegativeStyle(event.target.value as 'minus' | 'parentheses')}><option value="minus">-1,234.56</option><option value="parentheses">(1,234.56)</option></select></label></div><div className="pivot-table-scroll"><table className="pivot-table pivot-grid"><thead>{request.columns.map((axis, level) => <tr key={axis.dimension}>{level === 0 && request.rows.map((rowAxis) => <th key={rowAxis.dimension} rowSpan={request.columns.length} className="pivot-corner" onMouseDown={() => { setAnchor({ row: 0, column: 0 }); setFocus({ row: rows.length - 1, column: columns.length - 1 }) }}>{LABELS[rowAxis.dimension]}</th>)}{columns.map((tuple, index) => {
    if (isRepeated(columns, index, level)) return null
    const span = spanLength(columns, index, level)
    return <th key={`${tuple.key}:${level}`} colSpan={span} onMouseDown={() => { setAnchor({ row: 0, column: index }); setFocus({ row: rows.length - 1, column: index + span - 1 }) }}>{tuple.members[level]?.label}</th>
  })}</tr>)}</thead><tbody>{rows.map((row, rowIndex) => <tr key={row.key}>{request.rows.map((axis, level) => {
    if (isRepeated(rows, rowIndex, level)) return null
    const span = spanLength(rows, rowIndex, level)
    return <th key={axis.dimension} rowSpan={span} onMouseDown={() => { setAnchor({ row: rowIndex, column: 0 }); setFocus({ row: rowIndex + span - 1, column: columns.length - 1 }) }}>{row.members[level]?.label}</th>
  })}{columns.map((column, columnIndex) => { const cell = cells.get(`${row.key}\u001e${column.key}`); return <td key={column.key} className={selected(rowIndex, columnIndex) ? 'selected' : ''} onMouseDown={(event) => { event.preventDefault(); dragging.current = true; if (event.shiftKey && anchor) setFocus({ row: rowIndex, column: columnIndex }); else { setAnchor({ row: rowIndex, column: columnIndex }); setFocus({ row: rowIndex, column: columnIndex }) } }} onMouseEnter={() => { if (dragging.current) setFocus({ row: rowIndex, column: columnIndex }) }}>{cell ? formatValue(cell.value, cell.valueType, unit, decimals, grouping, negativeStyle) : '—'}</td>})}</tr>)}</tbody></table><div className="pivot-copy-hint"><Copy size={13} />拖拽或 Shift 选择单元格，按 Ctrl/Cmd+C 复制到 Excel</div></div></>
}
