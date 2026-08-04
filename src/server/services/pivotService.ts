import Decimal from 'decimal.js'
import type { DatabaseClient } from '../../app/storage/types'
import type { PivotCell, PivotDimension, PivotRequest, PivotResponse } from '../../shared/domain/types'

const ALLOWED_DIMENSIONS = new Set<PivotDimension>(['project', 'department', 'version', 'period', 'metric'])
const DEFAULT_METRICS = ['revenue', 'cost', 'gross_profit', 'gross_margin', 'cash_inflow', 'cash_outflow', 'net_cash_flow']
const METRIC_LABELS: Record<string, string> = {
  revenue: '收入', cost: '成本', gross_profit: '毛利', gross_margin: '毛利率',
  cash_inflow: '项目收款', cash_outflow: '项目付款', net_cash_flow: '项目净现金流',
}

interface FactPivotRow {
  project_id: string
  project_name: string
  department_id: string
  department_name: string
  version_id: string
  version_name: string
  period: string
  metric_code: 'revenue' | 'cost' | 'cash_inflow' | 'cash_outflow'
  value_text: string
}

type Coordinate = Record<Exclude<PivotDimension, 'metric'>, string>

export class PivotService {
  constructor(private readonly database: DatabaseClient) {}

  async build(request: PivotRequest): Promise<PivotResponse> {
    const dimensions = [...request.rows, ...request.columns]
    if (!request.rows.length || !request.columns.length) throw this.invalid('行轴和列轴都不能为空')
    if (new Set(dimensions).size !== dimensions.length || dimensions.some((item) => !ALLOWED_DIMENSIONS.has(item))) {
      throw this.invalid('透视维度存在重复或不受支持')
    }
    if (!dimensions.includes('metric')) throw this.invalid('行轴或列轴必须包含指标')
    const clauses = ["fact.scenario_id = 'baseline'"]
    const params: unknown[] = []
    const addList = (column: string, values?: string[]) => {
      if (!values?.length) return
      clauses.push(`${column} IN (${values.map(() => '?').join(', ')})`)
      params.push(...values)
    }
    addList('fact.project_id', request.filters?.projectIds)
    addList('fact.department_id', request.filters?.departmentIds)
    addList('fact.version_id', request.filters?.versionIds)
    if (request.filters?.periodStart) { clauses.push('fact.period >= ?'); params.push(request.filters.periodStart) }
    if (request.filters?.periodEnd) { clauses.push('fact.period <= ?'); params.push(request.filters.periodEnd) }
    const facts = await this.database.query<FactPivotRow>(
      `SELECT fact.project_id, project.name AS project_name,
              fact.department_id, department.name AS department_name,
              fact.version_id, COALESCE(relation.display_name, version.name) AS version_name,
              fact.period, fact.metric_code, fact.value_text
       FROM fact_metric_value fact
       JOIN dim_project project ON project.id = fact.project_id
       JOIN dim_department department ON department.id = fact.department_id
       JOIN dim_version version ON version.id = fact.version_id
       LEFT JOIN rel_project_version relation
         ON relation.project_id = fact.project_id AND relation.version_id = fact.version_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY project.name, version_name, fact.period, fact.metric_code`,
      params,
    )
    const nonMetricDimensions = dimensions.filter((item): item is Exclude<PivotDimension, 'metric'> => item !== 'metric')
    const groups = new Map<string, { coordinates: Partial<Coordinate>; metrics: Map<string, Decimal> }>()
    facts.forEach((fact) => {
      const coordinates: Coordinate = {
        project: fact.project_name,
        department: fact.department_name,
        version: fact.version_name,
        period: fact.period,
      }
      const key = nonMetricDimensions.map((dimension) => coordinates[dimension]).join('\u001f')
      const group = groups.get(key) ?? { coordinates, metrics: new Map<string, Decimal>() }
      group.metrics.set(fact.metric_code, (group.metrics.get(fact.metric_code) ?? new Decimal(0)).plus(fact.value_text))
      groups.set(key, group)
    })
    const metricCodes = (request.filters?.metricCodes?.length ? request.filters.metricCodes : DEFAULT_METRICS)
      .filter((code) => METRIC_LABELS[code])
    const cells: PivotCell[] = []
    groups.forEach((group) => {
      metricCodes.forEach((metricCode) => {
        const revenue = group.metrics.get('revenue') ?? new Decimal(0)
        const cost = group.metrics.get('cost') ?? new Decimal(0)
        const inflow = group.metrics.get('cash_inflow') ?? new Decimal(0)
        const outflow = group.metrics.get('cash_outflow') ?? new Decimal(0)
        let value: Decimal | null
        if (metricCode === 'gross_profit') value = revenue.minus(cost)
        else if (metricCode === 'gross_margin') value = revenue.isZero() ? null : revenue.minus(cost).div(revenue)
        else if (metricCode === 'net_cash_flow') value = inflow.minus(outflow)
        else value = group.metrics.get(metricCode) ?? new Decimal(0)
        const label = (dimension: PivotDimension) => dimension === 'metric'
          ? METRIC_LABELS[metricCode]
          : String(group.coordinates[dimension] ?? '全部')
        const rowLabels = request.rows.map(label)
        const columnLabels = request.columns.map(label)
        cells.push({
          rowKey: rowLabels.join('\u001f'), rowLabels,
          columnKey: columnLabels.join('\u001f'), columnLabels,
          value: value?.toDecimalPlaces(6).toString() ?? null,
          valueType: metricCode === 'gross_margin' ? 'percentage' : 'currency',
        })
      })
    })
    return { rows: request.rows, columns: request.columns, cells, sourceFactCount: facts.length }
  }

  private invalid(message: string) {
    return Object.assign(new Error(message), { code: 'INVALID_REQUEST' })
  }
}
