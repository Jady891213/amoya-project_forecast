import { useEffect, useMemo, useState } from 'react'
import { Calculator, FileChartColumn, Info, TableProperties } from 'lucide-react'
import type { DatabaseClient } from '../storage/types'
import type {
  MetricDefinition,
  MonthlyMetricRow,
  ProjectReport,
} from '../domain/types'
import type { AppSnapshot } from '../app/types'
import { ProjectReportService } from '../services/projectReportService'
import { formatPercent, formatReportPeriod, formatWan } from '../ui/formatters'
import { OriginBadge } from '../ui/OriginBadge'

type MonthlyField = keyof Omit<MonthlyMetricRow, 'period'>
type ViewMode = 'calculation' | 'report'

interface ReportTableMetric {
  field: MonthlyField
  code: string
  name: string
  format: 'currency' | 'percentage'
  total: (report: ProjectReport) => string | null
}

const profitRows: ReportTableMetric[] = [
  { field: 'revenue', code: 'revenue', name: '收入', format: 'currency', total: (r) => r.summary.revenue },
  { field: 'cost', code: 'cost', name: '成本', format: 'currency', total: (r) => r.summary.cost },
  { field: 'grossProfit', code: 'gross_profit', name: '毛利', format: 'currency', total: (r) => r.summary.grossProfit },
  { field: 'grossMargin', code: 'gross_margin', name: '毛利率', format: 'percentage', total: (r) => r.summary.grossMargin },
]
const cashRows: ReportTableMetric[] = [
  { field: 'cashInflow', code: 'cash_inflow', name: '现金流入', format: 'currency', total: (r) => r.summary.cashInflow },
  { field: 'cashOutflow', code: 'cash_outflow', name: '现金流出', format: 'currency', total: (r) => r.summary.cashOutflow },
  { field: 'netCashFlow', code: 'net_cash_flow', name: '净现金流', format: 'currency', total: (r) => r.summary.netCashFlow },
  { field: 'cumulativeCashFlow', code: 'cumulative_cash_flow', name: '累计现金流', format: 'currency', total: (r) => r.summary.cumulativeCashFlow },
]

function renderValue(value: string | null, format: ReportTableMetric['format']) {
  return format === 'percentage'
    ? formatPercent(value)
    : value === null ? '—' : formatWan(value)
}

function ReportTable({ title, report, rows }: { title: string; report: ProjectReport; rows: ReportTableMetric[] }) {
  const definition = (code: string): MetricDefinition | undefined =>
    report.metricDefinitions.find((metric) => metric.code === code)
  return (
    <section className="report-section">
      <div className="section-heading">
        <div><h2>{title}</h2><p className="muted">单位：万元；比例指标在当前筛选范围汇总后重算。</p></div>
      </div>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead><tr>
            <th className="sticky-column metric-column">指标</th>
            {report.monthly.map((month) => <th key={month.period}>{formatReportPeriod(month.period)}</th>)}
            <th className="total-column">项目周期</th>
          </tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.code}>
              <th className="sticky-column metric-column">
                <span>{row.name}</span>
                <small>{definition(row.code)?.metricType === 'base' ? '基础指标' : '系统计算'}</small>
              </th>
              {report.monthly.map((month) => (
                <td key={month.period} className="number-cell">{renderValue(month[row.field], row.format)}</td>
              ))}
              <td className="number-cell total-column">{renderValue(row.total(report), row.format)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  )
}

interface Props {
  database: DatabaseClient
  snapshot: AppSnapshot
  requestedProjectId: string
  view: ViewMode
}

export function ProjectReportPage({ database, snapshot, requestedProjectId, view }: Props) {
  const [businessModuleId, setBusinessModuleId] = useState('')
  const [report, setReport] = useState<ProjectReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const service = useMemo(() => new ProjectReportService(database), [database])
  const scenario = snapshot.scenarios.find(
    (item) => item.projectId === requestedProjectId && item.isDefault,
  )
  const version = snapshot.versions.find(
    (item) => item.projectId === requestedProjectId && item.status === 'working',
  )

  useEffect(() => setBusinessModuleId(''), [requestedProjectId])
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!scenario || !version) {
        setError('当前项目缺少基准场景或工作版')
        return
      }
      setLoading(true)
      setError('')
      try {
        const result = await service.build({
          projectId: requestedProjectId,
          scenarioId: scenario.id,
          versionId: version.id,
          businessModuleId: businessModuleId || undefined,
        })
        if (!cancelled) setReport(result)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '计算结果加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [businessModuleId, requestedProjectId, scenario, service, version])

  if (error) return <div className="page-alert workspace-alert">{error}</div>
  if (loading && !report) return <section className="loading-card">正在从 SQLite 读取事实并计算指标…</section>
  if (!report) return null

  return (
    <div className="workspace-view">
      <div className="report-toolbar">
        <div className="toolbar-title">
          {view === 'calculation' ? <TableProperties size={16} /> : <FileChartColumn size={16} />}
          <div>
            <b>{view === 'calculation' ? '计算表格' : '项目报表'}</b>
            <span>{view === 'calculation' ? 'Mock基础事实与系统计算指标只读预览' : '项目周期财务结果与指标说明'}</span>
          </div>
        </div>
        <span className="spacer" />
        <label>业务模块
          <select value={businessModuleId} onChange={(event) => setBusinessModuleId(event.target.value)}>
            <option value="">全部业务模块</option>
            {report.modules.map((module) => <option value={module.id} key={module.id}>{module.name}</option>)}
          </select>
        </label>
        <span className="readonly-mark">{report.scenario.name}</span>
        <span className="readonly-mark">{report.version.name}</span>
      </div>
      <div className="project-facts">
        <div><span>来源</span><OriginBadge origin={report.project.origin} /></div>
        <div><span>部门</span><strong>{report.department?.name ?? '未找到部门'}</strong></div>
        <div><span>场景</span><strong>{report.scenario.name}</strong></div>
        <div><span>版本</span><strong>{report.version.name}</strong></div>
        <div><span>基础事实</span><strong>{report.factCount} 条</strong></div>
      </div>
      {!report.hasFacts ? (
        <section className="empty-report-card workspace-empty">
          <Calculator size={34} />
          <h2>当前项目尚无事实数据</h2>
          <p>P0 不会为真实项目生成虚假结果。预测配置将在后续阶段把用户输入转换为同一套基础事实。</p>
        </section>
      ) : (
        <div className="report-scroll">
          {view === 'report' && (
            <section className="metrics-strip">
              <article className="metric-inline"><span>收入合计</span><strong>{formatWan(report.summary.revenue)}</strong></article>
              <article className="metric-inline"><span>成本合计</span><strong>{formatWan(report.summary.cost)}</strong></article>
              <article className="metric-inline"><span>毛利</span><strong>{formatWan(report.summary.grossProfit)}</strong></article>
              <article className="metric-inline"><span>毛利率</span><strong className="good">{formatPercent(report.summary.grossMargin)}</strong></article>
              <article className="metric-inline"><span>最大垫资</span><strong className="risk">{formatWan(report.summary.maximumFunding)}</strong></article>
              <article className="metric-inline"><span>现金转正期间</span><strong>{formatReportPeriod(report.summary.cashPositiveLabel)}</strong></article>
            </section>
          )}
          {view === 'calculation' && (
            <div className="calculation-note">
              <Info size={15} />
              当前表格读取 <code>fact_metric_value</code> 的基础指标，并即时计算毛利、毛利率、净现金流和累计现金流；页面不可编辑。
            </div>
          )}
          <ReportTable title="分月损益" report={report} rows={profitRows} />
          <ReportTable title="分月现金流" report={report} rows={cashRows} />
          {view === 'report' && (
            <section className="report-section metric-explanations">
              <div className="section-heading"><div><h2>指标公式与数据来源</h2><p className="muted">基础指标来自事实表；系统计算指标在本次查询中即时计算。</p></div></div>
              <div className="explanation-grid">
                {report.metricDefinitions.map((metric) => (
                  <article key={metric.code}>
                    <div className="explanation-title"><strong>{metric.name}</strong><span className={`metric-type metric-${metric.metricType}`}>{metric.metricType === 'base' ? '基础指标' : '系统计算'}</span></div>
                    <p><code>{metric.expression ?? '由基础事实写入'}</code></p>
                    <small>{metric.description}</small>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
