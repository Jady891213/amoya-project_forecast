import Decimal from 'decimal.js'
import type { DatabaseClient } from '../../shared/database'
import type {
  BaseMetricCode,
  MetricCode,
  PivotAxisDimension,
  PivotDimension,
  PivotMetadata,
  PivotPeriodLevel,
  PivotRequest,
  PivotResponse,
  PivotTuple,
  PivotTupleMember,
} from '../../shared/domain/types'
import { descendantProfitLeafCodes } from '../../config/profitMetricHierarchy'

export const ALL_PROJECTS = '__all_projects__'
export const ALL_DEPARTMENTS = '__all_departments__'

const DIMENSIONS: PivotDimension[] = ['project', 'plan', 'department', 'period', 'metric']
const LABELS: Record<PivotDimension, string> = { project: '项目', plan: '方案', department: '申报部门', period: '期间', metric: '指标' }

interface FactRow {
  project_id: string
  project_name: string
  plan_id: string
  plan_name: string
  department_id: string
  department_name: string
  period: string
  metric_code: BaseMetricCode
  value_text: string
}

type Coordinate = Record<Exclude<PivotDimension, 'metric'>, PivotTupleMember>

function periodBucket(period: string, level: PivotPeriodLevel) {
  const year = period.slice(0, 4)
  if (level === 'year') return { id: year, label: `${year}年` }
  if (level === 'quarter') {
    const quarter = Math.floor((Number(period.slice(5, 7)) - 1) / 3) + 1
    return { id: `${year}-Q${quarter}`, label: `${year}年 Q${quarter}` }
  }
  return { id: period, label: period }
}

function expandPeriodSelection(memberIds: string[], level: PivotPeriodLevel) {
  if (level === 'month') return memberIds
  const periods: string[] = []
  memberIds.forEach((memberId) => {
    const year = Number(memberId.slice(0, 4))
    if (!Number.isInteger(year)) return
    if (level === 'year') {
      for (let month = 1; month <= 12; month += 1) periods.push(`${year}-${String(month).padStart(2, '0')}`)
      return
    }
    const quarter = Number(memberId.match(/-Q([1-4])$/)?.[1])
    if (!quarter) return
    const startMonth = (quarter - 1) * 3 + 1
    for (let month = startMonth; month < startMonth + 3; month += 1) periods.push(`${year}-${String(month).padStart(2, '0')}`)
  })
  return periods
}

export class PivotService {
  constructor(private readonly database: DatabaseClient) {}

  async metadata(): Promise<PivotMetadata> {
    const [projects, plans, departments, periods, metrics] = await Promise.all([
      this.database.query<{ id: string; name: string; status: string; updated_at: string }>('SELECT id, name, status, updated_at FROM dim_project ORDER BY name'),
      this.database.query<{ id: string; project_id: string; name: string; status: string; sort_order: number }>(
        `SELECT plan.id, plan.project_id, plan.name, plan.status, plan.sort_order
         FROM dim_plan plan
         JOIN dim_project project ON project.id = plan.project_id
         ORDER BY project.name, plan.sort_order, plan.name`,
      ),
      this.database.query<{ id: string; name: string; status: string }>('SELECT id, name, status FROM dim_department ORDER BY name'),
      this.database.query<{ period: string; sort_key: number }>("SELECT period, sort_key FROM dim_period WHERE period BETWEEN '2024-01' AND '2030-12' ORDER BY sort_key"),
      this.database.query<{ code: string; name: string; sort_order: number; parent_code: string | null; hierarchy_level: number; is_leaf: number }>('SELECT code, name, sort_order, parent_code, hierarchy_level, is_leaf FROM dim_metric ORDER BY sort_order'),
    ])
    return {
      scenario: { id: 'baseline', label: '基准场景' },
      dimensions: [
        { dimension: 'project', label: LABELS.project, members: [{ id: ALL_PROJECTS, label: '全部项目', sortKey: -1 }, ...projects.map((item, index) => ({ id: item.id, label: item.name, sortKey: index, status: item.status }))] },
        { dimension: 'plan', label: LABELS.plan, members: plans.map((item, index) => ({ id: item.id, label: item.name, parentId: item.project_id, sortKey: index, status: item.status })) },
        { dimension: 'department', label: LABELS.department, members: [{ id: ALL_DEPARTMENTS, label: '全部部门', sortKey: -1 }, ...departments.map((item, index) => ({ id: item.id, label: item.name, sortKey: index, status: item.status }))] },
        { dimension: 'period', label: LABELS.period, members: periods.map((item) => ({ id: item.period, label: item.period, sortKey: item.sort_key })) },
        { dimension: 'metric', label: LABELS.metric, members: metrics.map((item) => ({ id: item.code, label: item.name, parentId: item.parent_code ?? undefined, hierarchyLevel: item.hierarchy_level, isLeaf: Boolean(item.is_leaf), sortKey: item.sort_order })) },
      ],
    }
  }

  async build(request: PivotRequest): Promise<PivotResponse> {
    this.validate(request)
    const periodLevel = request.periodLevel ?? 'month'
    const placements = [...request.rows, ...request.columns]
    const pov = new Map(request.pov.map((item) => [item.dimension, item.memberId]))
    const selection = new Map(placements.map((item) => [item.dimension, item.memberIds]))
    const clauses = ["fact.scenario_id = 'baseline'"]
    const params: unknown[] = []
    const addValues = (column: string, values: string[]) => {
      if (!values.length) return
      clauses.push(`${column} IN (${values.map(() => '?').join(', ')})`)
      params.push(...values)
    }
    const selectedFor = (dimension: PivotDimension): string[] => {
      const axis = selection.get(dimension)
      if (axis) return axis
      const member = pov.get(dimension)
      return member ? [member] : []
    }
    const projectIds = selectedFor('project').filter((item) => item !== ALL_PROJECTS)
    const departmentIds = selectedFor('department').filter((item) => item !== ALL_DEPARTMENTS)
    addValues('fact.project_id', projectIds)
    addValues('fact.plan_id', selectedFor('plan'))
    addValues('fact.department_id', departmentIds)
    addValues('fact.period', expandPeriodSelection(selectedFor('period'), periodLevel))

    const facts = await this.database.query<FactRow>(
      `SELECT fact.project_id, project.name AS project_name,
              fact.plan_id, plan.name AS plan_name,
              fact.department_id, department.name AS department_name,
              fact.period, fact.metric_code, fact.value_text
       FROM fact_metric_value fact
       JOIN dim_project project ON project.id = fact.project_id
       JOIN dim_plan plan ON plan.id = fact.plan_id AND plan.project_id = fact.project_id
       JOIN dim_department department ON department.id = fact.department_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY project.name, plan.sort_order, plan.name, fact.period, fact.metric_code`,
      params,
    )

    const axisDimensions = placements.map((item) => item.dimension)
    const nonMetricDimensions = axisDimensions.filter((item): item is Exclude<PivotDimension, 'metric'> => item !== 'metric')
    const groups = new Map<string, { coordinates: Coordinate; metrics: Map<string, Decimal> }>()
    facts.forEach((fact) => {
      const coordinates: Coordinate = {
        project: { dimension: 'project', memberId: fact.project_id, label: fact.project_name },
        plan: { dimension: 'plan', memberId: fact.plan_id, label: fact.plan_name, parentId: fact.project_id },
        department: { dimension: 'department', memberId: fact.department_id, label: fact.department_name },
        period: (() => {
          const bucket = periodBucket(fact.period, periodLevel)
          return { dimension: 'period' as const, memberId: bucket.id, label: bucket.label }
        })(),
      }
      const key = nonMetricDimensions.map((dimension) => coordinates[dimension].memberId).join('\u001f')
      const group = groups.get(key) ?? { coordinates, metrics: new Map<string, Decimal>() }
      group.metrics.set(fact.metric_code, (group.metrics.get(fact.metric_code) ?? new Decimal(0)).plus(fact.value_text))
      groups.set(key, group)
    })

    const metricCodes = selectedFor('metric') as MetricCode[]
    const metadata = await this.metadata()
    const metricMetadata = metadata.dimensions.find((item) => item.dimension === 'metric')!
    const metricById = new Map(metricMetadata.members.map((item) => [item.id, item]))
    const rowTuples = new Map<string, PivotTuple>()
    const columnTuples = new Map<string, PivotTuple>()
    const cells: PivotResponse['cells'] = []
    const cumulativeByGroup = new Map<string, Decimal>()
    if (nonMetricDimensions.includes('period')) {
      const cumulativeBuckets = new Map<string, Array<[string, { coordinates: Coordinate; metrics: Map<string, Decimal> }]>>()
      groups.forEach((group, key) => {
        const bucketKey = nonMetricDimensions.filter((item) => item !== 'period').map((item) => group.coordinates[item].memberId).join('\u001f')
        const bucket = cumulativeBuckets.get(bucketKey) ?? []
        bucket.push([key, group]); cumulativeBuckets.set(bucketKey, bucket)
      })
      cumulativeBuckets.forEach((items) => {
        let cumulative = new Decimal(0)
        let hasCash = false
        items.sort((left, right) => left[1].coordinates.period.memberId.localeCompare(right[1].coordinates.period.memberId)).forEach(([key, group]) => {
          hasCash ||= group.metrics.has('cash_inflow') || group.metrics.has('cash_outflow')
          cumulative = cumulative.plus(group.metrics.get('cash_inflow') ?? 0).minus(group.metrics.get('cash_outflow') ?? 0)
          if (hasCash) cumulativeByGroup.set(key, cumulative)
        })
      })
    }
    const buildTuple = (axis: PivotAxisDimension[], coordinates: Coordinate, metricCode: MetricCode): PivotTuple => {
      const members = axis.map(({ dimension }) => {
        if (dimension === 'metric') {
          const metadata = metricById.get(metricCode)
          return {
            dimension,
            memberId: metricCode,
            label: metadata?.label ?? metricCode,
            parentId: metadata?.parentId,
            hierarchyLevel: metadata?.hierarchyLevel,
            isLeaf: metadata?.isLeaf,
          }
        }
        if (dimension === 'plan' && !axis.some((item) => item.dimension === 'project') && pov.get('project') === ALL_PROJECTS) {
          return { ...coordinates.plan, label: `${coordinates.project.label}（${coordinates.plan.label}）` }
        }
        return coordinates[dimension]
      })
      return { key: members.map((item) => `${item.dimension}:${item.memberId}`).join('\u001f'), members }
    }

    groups.forEach((group, groupKey) => {
      metricCodes.forEach((metricCode) => {
        const sumProfit = (code: string) => descendantProfitLeafCodes(code)
          .reduce((sum, leafCode) => sum.plus(group.metrics.get(leafCode) ?? 0), new Decimal(0))
        const revenueLeaves = descendantProfitLeafCodes('revenue')
        const costLeaves = descendantProfitLeafCodes('cost')
        const revenue = sumProfit('revenue')
        const cost = sumProfit('cost')
        const inflow = group.metrics.get('cash_inflow') ?? new Decimal(0)
        const outflow = group.metrics.get('cash_outflow') ?? new Decimal(0)
        const hasRevenue = revenueLeaves.some((code) => group.metrics.has(code))
        const hasCost = costLeaves.some((code) => group.metrics.has(code))
        const hasProfit = hasRevenue || hasCost
        const hasCash = group.metrics.has('cash_inflow') || group.metrics.has('cash_outflow')
        let value: Decimal | null
        if (metricCode === 'gross_profit') value = hasProfit ? revenue.minus(cost) : null
        else if (metricCode === 'gross_margin') value = !hasRevenue || revenue.isZero() ? null : revenue.minus(cost).div(revenue)
        else if (metricCode === 'net_cash_flow') value = hasCash ? inflow.minus(outflow) : null
        else if (metricCode === 'cumulative_cash_flow') value = cumulativeByGroup.get(groupKey) ?? (hasCash ? inflow.minus(outflow) : null)
        else {
          const leafCodes = descendantProfitLeafCodes(metricCode)
          value = leafCodes.length
            ? (leafCodes.some((code) => group.metrics.has(code)) ? sumProfit(metricCode) : null)
            : group.metrics.get(metricCode) ?? null
        }
        const row = buildTuple(request.rows, group.coordinates, metricCode)
        const column = buildTuple(request.columns, group.coordinates, metricCode)
        rowTuples.set(row.key, row)
        columnTuples.set(column.key, column)
        cells.push({ rowKey: row.key, columnKey: column.key, value: value?.toDecimalPlaces(6).toString() ?? null, valueType: metricCode === 'gross_margin' ? 'percentage' : 'currency' })
      })
    })
    const sortMaps = new Map(metadata.dimensions.map((dimension) => [dimension.dimension, new Map(dimension.members.map((member) => [member.id, member.sortKey]))]))
    const sortTuples = (tuples: PivotTuple[], axis: PivotAxisDimension[]) => {
      const selectionOrder = new Map(axis.map((item) => [item.dimension, new Map(item.memberIds.map((id, index) => [id, index]))]))
      return tuples.sort((left, right) => {
        for (let index = 0; index < Math.max(left.members.length, right.members.length); index += 1) {
          const leftMember = left.members[index]
          const rightMember = right.members[index]
          if (!leftMember || !rightMember) return left.members.length - right.members.length
          const requested = selectionOrder.get(leftMember.dimension)
          const difference = requested?.has(leftMember.memberId) && requested?.has(rightMember.memberId)
            ? (requested.get(leftMember.memberId) ?? 0) - (requested.get(rightMember.memberId) ?? 0)
            : (sortMaps.get(leftMember.dimension)?.get(leftMember.memberId) ?? Number.MAX_SAFE_INTEGER)
              - (sortMaps.get(rightMember.dimension)?.get(rightMember.memberId) ?? Number.MAX_SAFE_INTEGER)
          if (difference) return difference
        }
        return left.key.localeCompare(right.key)
      })
    }
    return { rowTuples: sortTuples([...rowTuples.values()], request.rows), columnTuples: sortTuples([...columnTuples.values()], request.columns), cells, sourceFactCount: facts.length }
  }

  private validate(request: PivotRequest) {
    if (request.scenarioId !== 'baseline') throw this.invalid('当前仅支持基准场景')
    if (!request.rows.length || !request.columns.length) throw this.invalid('行轴和列轴都不能为空')
    const all = [...request.rows.map((item) => item.dimension), ...request.columns.map((item) => item.dimension), ...request.pov.map((item) => item.dimension)]
    if (all.length !== DIMENSIONS.length || new Set(all).size !== DIMENSIONS.length || all.some((item) => !DIMENSIONS.includes(item))) throw this.invalid('每个维度必须且只能位于行轴、列轴或POV之一')
    if ([...request.rows, ...request.columns].some((item) => !item.memberIds.length)) throw this.invalid('行列维度至少选择一个成员')
    const planPov = request.pov.find((item) => item.dimension === 'plan')
    if (planPov && (!planPov.memberId || planPov.memberId.startsWith('__all_'))) throw this.invalid('POV中的方案必须选择一个具体成员')
    const periodLevel = request.periodLevel ?? 'month'
    if (!['month', 'quarter', 'year'].includes(periodLevel)) throw this.invalid('期间层级必须为月、季度或年度')
    const periodMembers = request.rows.find((item) => item.dimension === 'period')?.memberIds
      ?? request.columns.find((item) => item.dimension === 'period')?.memberIds
      ?? [request.pov.find((item) => item.dimension === 'period')?.memberId ?? '']
    const pattern = periodLevel === 'month' ? /^\d{4}-(0[1-9]|1[0-2])$/ : periodLevel === 'quarter' ? /^\d{4}-Q[1-4]$/ : /^\d{4}$/
    if (periodMembers.some((item) => !pattern.test(item))) throw this.invalid('期间成员与所选层级不匹配')
  }

  private invalid(message: string) { return Object.assign(new Error(message), { code: 'INVALID_REQUEST' }) }
}
