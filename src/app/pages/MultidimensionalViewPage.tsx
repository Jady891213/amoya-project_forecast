import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight, BarChart3, Download, GripVertical, PanelRightClose, PanelRightOpen, Search } from 'lucide-react'
import type { PivotAxisDimension, PivotDimension, PivotMetadata, PivotPeriodLevel, PivotPlanLabelMode, PivotRequest, PivotResponse, PivotTuple } from '../../shared/domain/types'
import type { ApiClient } from '../api/client'
import { gridSelectionText, useGridSelection, type GridCellPosition } from '../components/useGridSelection'
import type { AppSnapshot } from '../state/types'
import { buildPivotHeaderRows, displayPivotTuples, visiblePivotRows } from '../../shared/reporting/pivotLayout'

const LABELS: Record<PivotDimension, string> = { project: '项目', plan: '方案', department: '申报部门', period: '期间', metric: '指标' }
const ALL_PROJECTS = '__all_projects__'
const ALL_DEPARTMENTS = '__all_departments__'
const PIVOT_PAGE_CACHE_KEY = 'amoya-project-report-pivot-v3'
const PIVOT_PLAN_LABEL_MODE_KEY = 'amoya-project-report-plan-label-mode'
const PERIOD_LEVEL_LABELS: Record<PivotPeriodLevel, string> = { month: '月度', quarter: '季度', year: '年度' }

interface Props { api: ApiClient; snapshot: AppSnapshot }
type Placement = 'rows' | 'columns' | 'pov'
interface PivotDragState { dimension: PivotDimension; x: number; y: number }
interface PivotDropTarget { placement: Placement; index: number }

function memberIds(metadata: PivotMetadata, dimension: PivotDimension, excludeVirtual = false) {
  return metadata.dimensions.find((item) => item.dimension === dimension)?.members
    .filter((item) => !excludeVirtual || !item.id.startsWith('__all_')).map((item) => item.id) ?? []
}

function periodMembers(metadata: PivotMetadata, level: PivotPeriodLevel) {
  const months = metadata.dimensions.find((item) => item.dimension === 'period')?.members ?? []
  if (level === 'month') return months
  const result = new Map<string, (typeof months)[number]>()
  months.forEach((member) => {
    const year = member.id.slice(0, 4)
    const quarter = Math.floor((Number(member.id.slice(5, 7)) - 1) / 3) + 1
    const id = level === 'year' ? year : `${year}-Q${quarter}`
    if (!result.has(id)) result.set(id, {
      id,
      label: level === 'year' ? `${year}年` : `${year}年 Q${quarter}`,
      sortKey: level === 'year' ? Number(year) : Number(year) * 10 + quarter,
    })
  })
  return [...result.values()].sort((left, right) => left.sortKey - right.sortKey)
}

function periodMemberMonths(id: string, level: PivotPeriodLevel) {
  if (level === 'month') return [id]
  const year = id.slice(0, 4)
  if (level === 'year') return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
  const quarter = Number(id.match(/-Q([1-4])$/)?.[1]) || 1
  const start = (quarter - 1) * 3 + 1
  return Array.from({ length: 3 }, (_, index) => `${year}-${String(start + index).padStart(2, '0')}`)
}

function convertPeriodSelection(metadata: PivotMetadata, ids: string[], from: PivotPeriodLevel, to: PivotPeriodLevel) {
  const selectedMonths = new Set(ids.flatMap((id) => periodMemberMonths(id, from)))
  return periodMembers(metadata, to).filter((member) => periodMemberMonths(member.id, to).some((month) => selectedMonths.has(month))).map((member) => member.id)
}

function plansForProject(metadata: PivotMetadata, projectId: string) {
  return metadata.dimensions.find((item) => item.dimension === 'plan')?.members
    .filter((item) => !item.id.startsWith('__all_') && (projectId === ALL_PROJECTS || item.parentId === projectId)) ?? []
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
    periodLevel: 'month',
    scenarioId: 'baseline',
  }
}

export function projectPlanComparisonRequest(metadata: PivotMetadata, snapshot: AppSnapshot, projectId: string): PivotRequest | undefined {
  const plans = plansForProject(metadata, projectId).filter((item) => item.status !== 'archived')
  if (!plans.length) return undefined
  const projectPlans = snapshot.plans.filter((item) => item.projectId === projectId && item.status === 'active')
  const years = periodMembers(metadata, 'year').filter((member) => projectPlans.some((plan) => member.id >= plan.startPeriod.slice(0, 4) && member.id <= plan.endPeriod.slice(0, 4)))
  const metricMembers = metadata.dimensions.find((item) => item.dimension === 'metric')?.members ?? []
  return {
    rows: [{ dimension: 'metric', memberIds: metricMembers.filter((item) => !item.id.startsWith('__all_')).map((item) => item.id) }],
    columns: [
      { dimension: 'period', memberIds: years.length ? years.map((item) => item.id) : periodMembers(metadata, 'year').map((item) => item.id) },
      { dimension: 'plan', memberIds: plans.map((item) => item.id) },
    ],
    pov: [
      { dimension: 'project', memberId: projectId },
      { dimension: 'department', memberId: ALL_DEPARTMENTS },
    ],
    periodLevel: 'year',
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
    if (parsed.rows.some((item) => item.dimension === 'project') || parsed.columns.some((item) => item.dimension === 'project')) return fallback
    if (!parsed.pov.some((item) => item.dimension === 'project' && item.memberId === ALL_PROJECTS)) return fallback
    if ([...parsed.rows, ...parsed.columns].some((item) => !Array.isArray(item.memberIds) || !item.memberIds.length)) return fallback
    if (parsed.pov.some((item) => typeof item.memberId !== 'string' || !item.memberId)) return fallback
    return { ...parsed, periodLevel: ['month', 'quarter', 'year'].includes(parsed.periodLevel) ? parsed.periodLevel : 'month', scenarioId: 'baseline' }
  } catch {
    return fallback
  }
}

function savePageCache(request: PivotRequest) {
  window.localStorage.setItem(PIVOT_PAGE_CACHE_KEY, JSON.stringify(request))
}

export function movePivotDimension(draft: PivotRequest, metadata: PivotMetadata, dimension: PivotDimension, target: Placement, targetIndex: number): PivotRequest {
  if (dimension === 'project') return draft
  const existingAxis = [...draft.rows, ...draft.columns].find((item) => item.dimension === dimension)
  const existingPov = draft.pov.find((item) => item.dimension === dimension)
  const rows = draft.rows.filter((item) => item.dimension !== dimension)
  const columns = draft.columns.filter((item) => item.dimension !== dimension)
  const visiblePov = draft.pov.filter((item) => item.dimension !== 'project' && item.dimension !== dimension)
  if (target === 'rows' || target === 'columns') {
    const axis = existingAxis ?? { dimension, memberIds: existingPov ? [existingPov.memberId] : memberIds(metadata, dimension, true) }
    const targetAxis = target === 'rows' ? rows : columns
    targetAxis.splice(Math.max(0, Math.min(targetIndex, targetAxis.length)), 0, axis)
  } else {
    const members = metadata.dimensions.find((item) => item.dimension === dimension)?.members ?? []
    const defaultMember = dimension === 'department'
      ? ALL_DEPARTMENTS
      : dimension === 'plan'
        ? plansForProject(metadata, ALL_PROJECTS)[0]?.id ?? ''
        : members.find((item) => !item.id.startsWith('__all_'))?.id ?? ''
    visiblePov.splice(Math.max(0, Math.min(targetIndex, visiblePov.length)), 0, existingPov ?? { dimension, memberId: existingAxis?.memberIds[0] ?? defaultMember })
  }
  return { ...draft, rows, columns, pov: [{ dimension: 'project', memberId: ALL_PROJECTS }, ...visiblePov] }
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

export function MultidimensionalViewPage({ api, snapshot }: Props) {
  const comparisonProjectId = new URLSearchParams(window.location.search).get('compareProjectId') ?? ''
  const [metadata, setMetadata] = useState<PivotMetadata>()
  const [draft, setDraft] = useState<PivotRequest>()
  const [executed, setExecuted] = useState<PivotRequest>()
  const [backgroundPov, setBackgroundPov] = useState<PivotRequest['pov']>([])
  const [result, setResult] = useState<PivotResponse>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [configurationOpen, setConfigurationOpen] = useState(!comparisonProjectId)
  const [hideNoDataRows, setHideNoDataRows] = useState(false)
  const [planLabelMode, setPlanLabelMode] = useState<PivotPlanLabelMode>(() => window.localStorage.getItem(PIVOT_PLAN_LABEL_MODE_KEY) === 'plan' ? 'plan' : 'project_plan')
  const [visibleRowKeys, setVisibleRowKeys] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)
  const [pointerDrag, setPointerDrag] = useState<PivotDragState>()
  const [dropTarget, setDropTarget] = useState<PivotDropTarget>()
  const pointerDragCleanupRef = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    let active = true
    void api.pivotMetadata().then((next) => {
      if (!active) return
      setMetadata(next)
      const initial = comparisonProjectId
        ? projectPlanComparisonRequest(next, snapshot, comparisonProjectId) ?? cachedRequest(next)
        : cachedRequest(next)
      setDraft(initial)
      setExecuted(initial)
      setBackgroundPov(initial.pov)
    }).catch((reason) => setError(reason instanceof Error ? reason.message : '项目报表元数据加载失败'))
    return () => { active = false }
  }, [api, comparisonProjectId, snapshot])

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
  const selectionComplete = Boolean(
    draft
      && draft.rows.length
      && draft.columns.length
      && [...draft.rows, ...draft.columns].every((item) => item.memberIds.length > 0),
  )
  useEffect(() => () => pointerDragCleanupRef.current?.(), [])
  useEffect(() => window.localStorage.setItem(PIVOT_PLAN_LABEL_MODE_KEY, planLabelMode), [planLabelMode])

  function startPointerDrag(event: ReactPointerEvent<HTMLButtonElement>, dimension: PivotDimension) {
    if (event.button !== 0 || !draft || !metadata) return
    event.preventDefault()
    pointerDragCleanupRef.current?.()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const targetAt = (x: number, y: number): PivotDropTarget | undefined => {
      const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-pivot-drop-placement]')
      const placement = element?.dataset.pivotDropPlacement as Placement | undefined
      const baseIndex = Number(element?.dataset.pivotDropIndex)
      const isDimensionRow = element?.classList.contains('pivot-dimension-config-row')
      const rect = isDimensionRow && element ? element.getBoundingClientRect() : undefined
      const index = isDimensionRow && rect && y > rect.top + rect.height / 2 ? baseIndex + 1 : baseIndex
      return placement && Number.isFinite(index) ? { placement, index } : undefined
    }
    const cleanup = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', cancel)
      handle.removeEventListener('lostpointercapture', cancel)
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      document.body.classList.remove('pivot-pointer-dragging')
      setPointerDrag(undefined)
      setDropTarget(undefined)
      pointerDragCleanupRef.current = undefined
    }
    const move = (nativeEvent: PointerEvent) => {
      nativeEvent.preventDefault()
      setPointerDrag((current) => current ? { ...current, x: nativeEvent.clientX, y: nativeEvent.clientY } : current)
      setDropTarget(targetAt(nativeEvent.clientX, nativeEvent.clientY))
    }
    const end = (nativeEvent: PointerEvent) => {
      const target = targetAt(nativeEvent.clientX, nativeEvent.clientY)
      if (target) {
        setDraft((current) => current ? movePivotDimension(current, metadata, dimension, target.placement, target.index) : current)
      }
      cleanup()
    }
    const cancel = () => cleanup()
    pointerDragCleanupRef.current = cleanup
    document.body.classList.add('pivot-pointer-dragging')
    handle.setPointerCapture(pointerId)
    handle.addEventListener('pointermove', move, { passive: false })
    handle.addEventListener('pointerup', end, { once: true })
    handle.addEventListener('pointercancel', cancel, { once: true })
    handle.addEventListener('lostpointercapture', cancel, { once: true })
    setPointerDrag({ dimension, x: event.clientX, y: event.clientY })
  }

  function updateAxis(dimension: PivotDimension, ids: string[]) {
    if (!draft || !metadata) return
    const replace = (axis: PivotAxisDimension[]) => axis.map((item) => item.dimension === dimension ? { ...item, memberIds: ids } : item)
    setDraft({ ...draft, rows: replace(draft.rows), columns: replace(draft.columns) })
  }

  function updatePeriodLevel(level: PivotPeriodLevel) {
    if (!draft || !metadata || level === draft.periodLevel) return
    const currentLevel = draft.periodLevel ?? 'month'
    const currentAxis = [...draft.rows, ...draft.columns].find((item) => item.dimension === 'period')
    const currentPov = draft.pov.find((item) => item.dimension === 'period')
    const currentIds = currentAxis?.memberIds ?? (currentPov ? [currentPov.memberId] : [])
    const mapped = convertPeriodSelection(metadata, currentIds, currentLevel, level)
    const fallback = periodMembers(metadata, level).map((item) => item.id)
    const nextIds = mapped.length ? mapped : fallback
    const replaceAxis = (axis: PivotAxisDimension[]) => axis.map((item) => item.dimension === 'period' ? { ...item, memberIds: nextIds } : item)
    const replacePov = (pov: PivotRequest['pov']) => pov.map((item) => item.dimension === 'period' ? { ...item, memberId: nextIds[0] ?? '' } : item)
    setDraft({ ...draft, periodLevel: level, rows: replaceAxis(draft.rows), columns: replaceAxis(draft.columns), pov: replacePov(draft.pov) })
  }

  function updateBackground(dimension: PivotDimension, memberId: string) {
    if (!metadata) return
    setBackgroundPov(backgroundPov.map((item) => item.dimension === dimension ? { ...item, memberId } : item))
  }

  function requestWithBackground(request: PivotRequest): PivotRequest {
    const projectPov: PivotRequest['pov'][number] = request.pov.find((item) => item.dimension === 'project')
      ?? { dimension: 'project', memberId: ALL_PROJECTS }
    return { ...request, pov: [projectPov, ...request.pov.filter((item) => item.dimension !== 'project')] }
  }

  async function exportCurrentView() {
    if (!executed || !result) return
    setExporting(true)
    setError('')
    try {
      await api.exportPivot({ request: executed, hideNoDataRows, visibleRowKeys, planLabelMode })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '项目报表下载失败')
    } finally {
      setExporting(false)
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
    const periodLevelChanged = draft.periodLevel !== executed?.periodLevel
    const next = requestWithBackground({ ...draft, pov: draft.pov.map((item) => item.dimension === 'period' && periodLevelChanged ? item : backgroundPov.find((candidate) => candidate.dimension === item.dimension) ?? item) })
    setDraft(next)
    setExecuted(structuredClone(next))
    setBackgroundPov(next.pov)
    savePageCache(next)
    setConfigurationOpen(false)
  }

  const visibleBackgroundPov = backgroundPov.filter((item) => item.dimension !== 'project')

  return <main className="page multidimensional-page">
    <div className="page-head"><div className="page-head-main"><h1>项目报表</h1><p>按方案、部门、期间和指标自由组织只读事实视图。</p></div><div className="page-head-actions"><span className="pivot-context"><BarChart3 size={14} />场景：基准场景</span></div></div>
    <div className={`page-body multidimensional-body pivot-report-workbench ${configurationOpen ? 'configuration-open' : 'configuration-closed'}`}>
      <section className="pivot-table-panel"><div className="pivot-table-head"><div className="pivot-background-controls">{executed && metadata && visibleBackgroundPov.length ? visibleBackgroundPov.map((item) => {
        const members = item.dimension === 'plan' ? plansForProject(metadata, ALL_PROJECTS) : item.dimension === 'period' ? periodMembers(metadata, executed?.periodLevel ?? 'month') : metadata.dimensions.find((dimension) => dimension.dimension === item.dimension)?.members ?? []
        return <label key={item.dimension}><span>{LABELS[item.dimension]}</span><select value={item.memberId} onChange={(event) => updateBackground(item.dimension, event.target.value)}>{members.map((member) => <option key={member.id} value={member.id}>{displayMemberLabel(metadata, item.dimension, member)}</option>)}</select></label>
      }) : <span className="pivot-no-background">无背景筛选</span>}</div><div className="pivot-table-head-actions">{executed && <><label className="pivot-display-toggle"><input type="checkbox" checked={hideNoDataRows} onChange={(event) => setHideNoDataRows(event.target.checked)} />隐藏无数据行</label><button className="btn" disabled={loading || exporting || !result?.rowTuples.length} onClick={() => void exportCurrentView()}><Download size={14} />{exporting ? '生成中' : '下载'}</button><span className="pivot-query-status">{backgroundChanged ? '条件已调整' : ''}</span><button className="btn primary" disabled={loading || !backgroundChanged} onClick={queryBackground}><Search size={14} />{loading ? '查询中' : '查询'}</button><button className="btn pivot-drawer-toggle" onClick={() => setConfigurationOpen((current) => !current)}>{configurationOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}{configurationOpen ? '收起配置' : '展开配置'}</button></>}</div></div>{error && <div className="page-alert error">{error}</div>}{!error && executed && metadata && <PivotGrid request={executed} result={result} metadata={metadata} hideNoDataRows={hideNoDataRows} onVisibleRowsChange={setVisibleRowKeys} planLabelMode={planLabelMode} onPlanLabelModeChange={setPlanLabelMode} />}</section>
      {draft && metadata && <aside className="pivot-config-drawer" aria-hidden={!configurationOpen}>
        <div className="pivot-config-drawer-head"><div><b>报表配置</b><span>设置背景、行轴和列轴</span></div><button type="button" aria-label="收起报表配置" onClick={() => setConfigurationOpen(false)}><PanelRightClose size={15} /></button></div>
        <div className="pivot-config-drawer-body">
          <PlacementArea title="1. 背景" placement="pov" dimensions={draft.pov.filter((item) => item.dimension !== 'project').map((item) => item.dimension)} metadata={metadata} request={draft} draggedDimension={pointerDrag?.dimension} dropTarget={dropTarget} onMembers={updateAxis} onPeriodLevel={updatePeriodLevel} onPointerDragStart={startPointerDrag} />
          <PlacementArea title="2. 行轴" placement="rows" dimensions={draft.rows.map((item) => item.dimension)} metadata={metadata} request={draft} draggedDimension={pointerDrag?.dimension} dropTarget={dropTarget} onMembers={updateAxis} onPeriodLevel={updatePeriodLevel} onPointerDragStart={startPointerDrag} />
          <div className="pivot-axis-swap-row"><button className="btn" title="交换行列" onClick={() => setDraft({ ...draft, rows: draft.columns, columns: draft.rows })}><ArrowLeftRight size={14} />交换行列</button></div>
          <PlacementArea title="3. 列轴" placement="columns" dimensions={draft.columns.map((item) => item.dimension)} metadata={metadata} request={draft} draggedDimension={pointerDrag?.dimension} dropTarget={dropTarget} onMembers={updateAxis} onPeriodLevel={updatePeriodLevel} onPointerDragStart={startPointerDrag} />
        </div>
        <div className="pivot-config-drawer-footer"><span>{!draft.rows.length || !draft.columns.length ? '行轴和列轴各需至少一个维度' : !selectionComplete ? '请至少选择一个成员' : changed ? '配置已修改' : '配置未修改'}</span><button className="btn primary" disabled={!selectionComplete || loading} onClick={confirmConfiguration}>确认</button></div>
      </aside>}
      {pointerDrag && createPortal(<div className="pivot-drag-ghost" style={{ left: pointerDrag.x + 12, top: pointerDrag.y + 12 }}><GripVertical size={15} /><span>{LABELS[pointerDrag.dimension]}</span></div>, document.body)}
    </div>
  </main>
}

function projectName(metadata: PivotMetadata, projectId?: string) {
  return metadata.dimensions.find((item) => item.dimension === 'project')?.members.find((project) => project.id === projectId)?.label ?? ''
}

function displayMemberLabel(metadata: PivotMetadata, dimension: PivotDimension, member: { label: string; parentId?: string }) {
  return dimension === 'plan' ? `${projectName(metadata, member.parentId)}（${member.label}）` : member.label
}

interface PlacementAreaProps {
  title: string
  placement: Placement
  dimensions: PivotDimension[]
  metadata: PivotMetadata
  request: PivotRequest
  draggedDimension?: PivotDimension
  dropTarget?: PivotDropTarget
  onMembers: (dimension: PivotDimension, ids: string[]) => void
  onPeriodLevel: (level: PivotPeriodLevel) => void
  onPointerDragStart: (event: ReactPointerEvent<HTMLButtonElement>, dimension: PivotDimension) => void
}

function PlacementArea({ title, placement, dimensions, metadata, request, draggedDimension, dropTarget, onMembers, onPeriodLevel, onPointerDragStart }: PlacementAreaProps) {
  const tailActive = dropTarget?.placement === placement && dropTarget.index === dimensions.length
  return <section className="pivot-config-section"><div className="pivot-config-section-head"><b>{title}</b><span>{placement === 'pov' ? '成员在表格顶部选择' : `${dimensions.length} 个维度，拖拽调整层级`}</span></div><div data-pivot-drop-placement={placement} data-pivot-drop-index={dimensions.length} className={`pivot-config-list ${draggedDimension ? 'drag-active' : ''} ${tailActive ? 'drop-target' : ''}`}>{dimensions.map((dimension, index) => {
    const axis = [...request.rows, ...request.columns].find((item) => item.dimension === dimension)
    const rowActive = dropTarget?.placement === placement && dropTarget.index === index
    return <div data-pivot-drop-placement={placement} data-pivot-drop-index={index} className={`pivot-dimension-config-row ${draggedDimension === dimension ? 'dragging' : ''} ${rowActive ? 'drop-target' : ''}`} key={dimension}><button type="button" className="pivot-drag-handle" aria-label={`拖动${LABELS[dimension]}`} title="按住拖动调整位置" onPointerDown={(event) => onPointerDragStart(event, dimension)}><GripVertical size={16} /></button>{placement === 'pov' ? <div className="pivot-background-dimension"><b>{LABELS[dimension]}</b>{dimension === 'period' ? <select aria-label="期间层级" value={request.periodLevel} onChange={(event) => onPeriodLevel(event.target.value as PivotPeriodLevel)}><option value="month">月度</option><option value="quarter">季度</option><option value="year">年度</option></select> : <span>表格顶部选择成员</span>}</div> : axis && <AxisDimensionChip dimension={dimension} axis={axis} metadata={metadata} periodLevel={request.periodLevel} onMembers={onMembers} onPeriodLevel={onPeriodLevel} />}</div>
  })}</div></section>
}

function AxisDimensionChip({ dimension, axis, metadata, periodLevel, onMembers, onPeriodLevel }: { dimension: PivotDimension; axis: PivotAxisDimension; metadata: PivotMetadata; periodLevel: PivotPeriodLevel; onMembers: (dimension: PivotDimension, ids: string[]) => void; onPeriodLevel: (level: PivotPeriodLevel) => void }) {
  const [searchText, setSearchText] = useState('')
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>()
  const members = dimension === 'period' ? periodMembers(metadata, periodLevel) : metadata.dimensions.find((item) => item.dimension === dimension)?.members.filter((item) => !item.id.startsWith('__all_')) ?? []
  const selectedIndexes = axis.memberIds.map((id) => members.findIndex((member) => member.id === id)).filter((index) => index >= 0).sort((a, b) => a - b)
  const rangeStart = selectedIndexes[0] ?? 0
  const rangeEnd = selectedIndexes.at(-1) ?? Math.max(0, members.length - 1)
  const filtered = members.filter((member) => member.label.toLowerCase().includes(searchText.trim().toLowerCase()) || (member.parentId ? metadata.dimensions.find((item) => item.dimension === 'project')?.members.find((project) => project.id === member.parentId)?.label.includes(searchText.trim()) : false))
  const applyPeriodRange = (start: number, end: number) => onMembers(dimension, members.slice(Math.min(start, end), Math.max(start, end) + 1).map((item) => item.id))
  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const height = Math.min(window.innerHeight * 0.68, 620)
      const top = Math.max(12, Math.min(rect.top, window.innerHeight - height - 12))
      setPopoverStyle({ top, right: Math.max(12, window.innerWidth - rect.left + 10), height })
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (!triggerRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    return () => document.removeEventListener('pointerdown', closeOnOutside)
  }, [open])
  const metricDescendants = (memberId: string) => {
    if (dimension !== 'metric') return [memberId]
    const result = [memberId]
    for (let index = 0; index < result.length; index += 1) {
      members.filter((candidate) => candidate.parentId === result[index]).forEach((candidate) => result.push(candidate.id))
    }
    return result
  }
  const renderMember = (member: (typeof members)[number]) => {
    const branch = metricDescendants(member.id)
    const branchSelected = branch.every((id) => axis.memberIds.includes(id))
    const toggleBranch = () => onMembers(dimension, branchSelected
      ? axis.memberIds.filter((id) => !branch.includes(id))
      : [...new Set([...axis.memberIds, ...branch])])
    return <label key={member.id} className={dimension === 'metric' ? 'pivot-metric-member' : undefined} style={dimension === 'metric' ? { paddingLeft: 8 + (member.hierarchyLevel ?? 0) * 18 } : undefined}><input type="checkbox" checked={axis.memberIds.includes(member.id)} onChange={() => onMembers(dimension, axis.memberIds.includes(member.id) ? axis.memberIds.filter((id) => id !== member.id) : [...axis.memberIds, member.id])} /><span>{displayMemberLabel(metadata, dimension, member)}</span>{dimension === 'metric' && !member.isLeaf && <button type="button" className="pivot-select-branch" onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleBranch() }}>{branchSelected ? '清空分支' : '选择分支'}</button>}</label>
  }
  const summary = dimension === 'period' && axis.memberIds.length
    ? `${PERIOD_LEVEL_LABELS[periodLevel]} · ${members[rangeStart]?.label}—${members[rangeEnd]?.label}，${axis.memberIds.length}期`
    : `${axis.memberIds.length} 个成员`
  const popover = open && popoverStyle ? createPortal(<div ref={popoverRef} className={`pivot-member-popover pivot-member-popover-floating ${dimension === 'period' ? 'period-level-enabled' : ''}`} style={popoverStyle}>
    <div className="pivot-member-popover-head"><div><b>{LABELS[dimension]}</b><span>已选 {axis.memberIds.length} / {members.length}</span></div><div className="pivot-member-actions"><button type="button" onClick={() => onMembers(dimension, filtered.map((item) => item.id))}>全选结果</button><button type="button" onClick={() => onMembers(dimension, [])}>清空</button></div></div>
    <label className="pivot-member-search"><Search size={14} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={`搜索${LABELS[dimension]}`} autoFocus /></label>
    {dimension === 'period' && <div className="pivot-period-level" role="group" aria-label="期间层级">{(['month', 'quarter', 'year'] as PivotPeriodLevel[]).map((level) => <button type="button" className={periodLevel === level ? 'active' : ''} key={level} onClick={() => onPeriodLevel(level)}>{PERIOD_LEVEL_LABELS[level]}</button>)}</div>}
    {dimension === 'period' && <div className="pivot-period-range"><select value={rangeStart} onChange={(event) => applyPeriodRange(Number(event.target.value), rangeEnd)}>{members.map((member, index) => <option key={member.id} value={index}>{member.label}</option>)}</select><span>至</span><select value={rangeEnd} onChange={(event) => applyPeriodRange(rangeStart, Number(event.target.value))}>{members.map((member, index) => <option key={member.id} value={index}>{member.label}</option>)}</select></div>}
    <div className="pivot-member-list">{filtered.length ? filtered.map(renderMember) : <div className="pivot-member-empty">没有匹配的成员</div>}</div>
  </div>, document.body) : null
  return <div className="pivot-dimension-chip"><button ref={triggerRef} type="button" className="pivot-dimension-chip-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span>{LABELS[dimension]}</span><small>{summary}</small></button>{popover}</div>
}

function PivotGrid({ request, result, metadata, hideNoDataRows, onVisibleRowsChange, planLabelMode, onPlanLabelModeChange }: { request: PivotRequest; result?: PivotResponse; metadata: PivotMetadata; hideNoDataRows: boolean; onVisibleRowsChange: (keys: string[]) => void; planLabelMode: PivotPlanLabelMode; onPlanLabelModeChange: (mode: PivotPlanLabelMode) => void }) {
  const [unit, setUnit] = useState(10_000)
  const [decimals, setDecimals] = useState(2)
  const [grouping, setGrouping] = useState(true)
  const [negativeStyle, setNegativeStyle] = useState<'minus' | 'parentheses'>('minus')
  const [collapsedMetrics, setCollapsedMetrics] = useState<Set<string>>(() => new Set())
  const allRows = result?.rowTuples ?? []
  const columns = result?.columnTuples ?? []
  const root = useRef<HTMLDivElement>(null)
  const cells = useMemo(() => new Map(result?.cells.map((cell) => [`${cell.rowKey}\u001e${cell.columnKey}`, cell]) ?? []), [result])
  const metricMembers = useMemo(() => metadata.dimensions.find((item) => item.dimension === 'metric')?.members ?? [], [metadata])
  const metricById = useMemo(() => new Map(metricMembers.map((member) => [member.id, member])), [metricMembers])
  const selectedMetricIds = request.rows.find((item) => item.dimension === 'metric')?.memberIds ?? []
  const hasSelectedDescendant = (memberId: string) => selectedMetricIds.some((candidateId) => {
    let current = metricById.get(candidateId)
    while (current?.parentId) {
      if (current.parentId === memberId) return true
      current = metricById.get(current.parentId)
    }
    return false
  })
  const hiddenByCollapsedParent = (row: PivotTuple) => {
    const metric = row.members.find((member) => member.dimension === 'metric')
    let current = metric?.parentId ? metricById.get(metric.parentId) : undefined
    while (current) {
      if (collapsedMetrics.has(current.id)) return true
      current = current.parentId ? metricById.get(current.parentId) : undefined
    }
    return false
  }
  const rows = useMemo(
    () => visiblePivotRows(
      allRows.filter((row) => !hiddenByCollapsedParent(row)),
      columns,
      (rowKey, columnKey) => cells.get(`${rowKey}\u001e${columnKey}`)?.value,
      hideNoDataRows,
    ),
    [allRows, cells, columns, hideNoDataRows, collapsedMetrics, metricById],
  )
  useEffect(() => onVisibleRowsChange(rows.map((row) => row.key)), [onVisibleRowsChange, rows])
  const displayColumns = useMemo(() => displayPivotTuples(columns, metadata, planLabelMode), [columns, metadata, planLabelMode])
  const displayRows = useMemo(() => displayPivotTuples(rows, metadata, planLabelMode), [rows, metadata, planLabelMode])
  const columnHeaderRows = useMemo(() => buildPivotHeaderRows(displayColumns, request.columns.length), [displayColumns, request.columns.length])
  const rowHeaderRows = useMemo(() => buildPivotHeaderRows(displayRows, request.rows.length), [displayRows, request.rows.length])
  const rowHeaderByPosition = useMemo(() => new Map(rowHeaderRows.flat().map((header) => [`${header.tupleIndex}:${header.level}`, header])), [rowHeaderRows])
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
  return <><div className="pivot-format-toolbar"><label>方案显示<select value={planLabelMode} onChange={(event) => onPlanLabelModeChange(event.target.value as PivotPlanLabelMode)}><option value="project_plan">项目（方案）</option><option value="plan">仅方案</option></select></label><label>单位<select value={unit} onChange={(event) => setUnit(Number(event.target.value))}><option value={1}>元</option><option value={1000}>千元</option><option value={10000}>万元</option></select></label><label>小数<select value={decimals} onChange={(event) => setDecimals(Number(event.target.value))}><option value={0}>0 位</option><option value={1}>1 位</option><option value={2}>2 位</option><option value={4}>4 位</option></select></label><label><input type="checkbox" checked={grouping} onChange={(event) => setGrouping(event.target.checked)} />千分位</label><label>负数<select value={negativeStyle} onChange={(event) => setNegativeStyle(event.target.value as 'minus' | 'parentheses')}><option value="minus">-1,234.56</option><option value="parentheses">(1,234.56)</option></select></label><span>{hideNoDataRows ? `显示 ${rows.length} 行 · ` : ''}{result.sourceFactCount} 条数据</span></div>{rows.length ? <div
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
  ><table className="pivot-table pivot-grid"><thead>{request.columns.map((axis, level) => <tr key={axis.dimension}>{level === 0 && request.rows.map((rowAxis) => <th key={rowAxis.dimension} rowSpan={request.columns.length} className="pivot-corner" onMouseDown={() => { selection.selectAll(); root.current?.focus() }}>{LABELS[rowAxis.dimension]}</th>)}{columnHeaderRows[level].map((header) => <th key={`${header.memberId}:${level}:${header.tupleIndex}`} colSpan={header.span} onMouseDown={() => { selection.selectColumns(header.tupleIndex, header.tupleIndex + header.span - 1); root.current?.focus() }}>{header.label}</th>)}</tr>)}</thead><tbody>{rows.map((row, rowIndex) => <tr key={row.key}>{request.rows.map((axis, level) => {
    const header = rowHeaderByPosition.get(`${rowIndex}:${level}`)
    if (!header) return null
    const member = displayRows[rowIndex]?.members[level]
    const isMetric = axis.dimension === 'metric'
    const canCollapse = isMetric && member && hasSelectedDescendant(member.memberId)
    return <th key={axis.dimension} rowSpan={header.span} className={isMetric ? 'pivot-metric-row-head' : undefined} onMouseDown={() => { selection.selectRows(rowIndex, rowIndex + header.span - 1); root.current?.focus() }}><div style={isMetric ? { paddingLeft: (member?.hierarchyLevel ?? 0) * 14 } : undefined}>{canCollapse && <button type="button" className="pivot-tree-toggle" aria-label={`${collapsedMetrics.has(member.memberId) ? '展开' : '收起'}${member.label}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setCollapsedMetrics((current) => { const next = new Set(current); if (next.has(member.memberId)) next.delete(member.memberId); else next.add(member.memberId); return next }) }}>{collapsedMetrics.has(member.memberId) ? '›' : '⌄'}</button>}<span>{member?.label}</span></div></th>
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
