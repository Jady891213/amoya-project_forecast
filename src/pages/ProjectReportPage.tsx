import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Calculator, FileChartColumn, Info, TableProperties } from 'lucide-react'
import type { DatabaseClient } from '../storage/types'
import type {
  MetricDefinition,
  MonthlyMetricRow,
  ProjectReport,
  ForecastLineBreakdown,
  ForecastProjectState,
} from '../domain/types'
import type { AppSnapshot } from '../app/types'
import { ProjectReportService } from '../services/projectReportService'
import { CalculationService } from '../services/calculationService'
import { ForecastLineValueRepository } from '../repositories/forecastLineValueRepository'
import {
  formatDateTime,
  formatPercent,
  formatReportPeriod,
  formatWan,
} from '../ui/formatters'

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
  onReturnToForecast: () => void
}

export function ProjectReportPage({
  database,
  snapshot,
  requestedProjectId,
  view,
  onReturnToForecast,
}: Props) {
  const [businessModuleId, setBusinessModuleId] = useState('')
  const [report, setReport] = useState<ProjectReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [forecastState, setForecastState] = useState<ForecastProjectState>()
  const [lineBreakdown, setLineBreakdown] = useState<ForecastLineBreakdown[]>([])
  const service = useMemo(() => new ProjectReportService(database), [database])
  const calculation = useMemo(() => new CalculationService(database), [database])
  const lineValues = useMemo(
    () => new ForecastLineValueRepository(database),
    [database],
  )
  const scenario = snapshot.scenarios.find((item) => item.isDefault)
  const version = snapshot.versions.find((item) => item.status === 'working')

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
        const state = await calculation.getProjectState(requestedProjectId)
        const breakdown = state.latestRun
          ? await lineValues.listBreakdown(
              state.latestRun.id,
              businessModuleId || undefined,
            )
          : []
        if (!cancelled) {
          setReport(result)
          setForecastState(state)
          setLineBreakdown(breakdown)
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '计算结果加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [
    businessModuleId,
    calculation,
    lineValues,
    requestedProjectId,
    scenario,
    service,
    version,
  ])

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
            <span>{view === 'calculation' ? '基础事实与系统计算指标只读预览' : '项目周期财务结果与指标说明'}</span>
          </div>
        </div>
        <span className="spacer" />
        {view === 'calculation' && (
          <button className="btn" onClick={onReturnToForecast}>
            <ArrowLeft size={14} />返回预测配置
          </button>
        )}
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
        <div><span>部门</span><strong>{report.department?.name ?? '未找到部门'}</strong></div>
        <div><span>场景</span><strong>{report.scenario.name}</strong></div>
        <div><span>版本</span><strong>{report.version.name}</strong></div>
        <div><span>基础事实</span><strong>{report.factCount} 条</strong></div>
        <div>
          <span>计算批次</span>
          <strong>
            {forecastState?.latestRun
              ? `RUN-${String(forecastState.latestRun.runNumber).padStart(4, '0')}`
              : '历史结果'}
          </strong>
        </div>
        {forecastState?.latestRun && (
          <div>
            <span>最后计算</span>
            <strong>{formatDateTime(forecastState.latestRun.completedAt)}</strong>
          </div>
        )}
        {forecastState?.latestRun && (
          <div>
            <span>结果状态</span>
            <strong className={forecastState.isResultCurrent ? 'good' : 'risk'}>
              {forecastState.isResultCurrent ? '与配置一致' : '配置已变更'}
            </strong>
          </div>
        )}
      </div>
      {!report.hasFacts ? (
        <section className="empty-report-card workspace-empty">
          <Calculator size={34} />
          <h2>当前项目尚无事实数据</h2>
          <p>请返回预测配置新增收入或成本行项目，并执行“保存并计算”。</p>
        </section>
      ) : (
        <div className="report-scroll">
          {view === 'report' && (
            <section className="metrics-strip">
              <article className="metric-inline"><span>收入合计</span><strong>{formatWan(report.summary.revenue)}</strong></article>
              <article className="metric-inline"><span>成本合计</span><strong>{formatWan(report.summary.cost)}</strong></article>
              <article className="metric-inline"><span>毛利</span><strong>{formatWan(report.summary.grossProfit)}</strong></article>
              <article className="metric-inline"><span>毛利率</span><strong className="good">{formatPercent(report.summary.grossMargin)}</strong></article>
              <article className="metric-inline"><span>最大垫资</span><strong className="risk">{report.hasCashFacts ? formatWan(report.summary.maximumFunding) : '待生成'}</strong></article>
              <article className="metric-inline"><span>现金转正期间</span><strong>{report.hasCashFacts ? formatReportPeriod(report.summary.cashPositiveLabel) : '待生成'}</strong></article>
            </section>
          )}
          {view === 'calculation' && (
            <>
              {!forecastState?.isResultCurrent && forecastState?.latestRun && (
                <div className="calculation-note stale-note">
                  <Info size={15} />
                  预测配置已经修改，当前仍显示上一批成功结果。请返回预测配置并重新计算。
                </div>
              )}
              <div className="calculation-note">
                <Info size={15} />
                当前表格读取 <code>fact_metric_value</code> 的基础指标，并即时计算毛利和毛利率；页面不可编辑。
              </div>
              {lineBreakdown.length > 0 && (
                <section className="report-section">
                  <div className="section-heading">
                    <div><h2>预测行项目明细</h2><p className="muted">用于追溯收入、成本基础事实的组成。</p></div>
                  </div>
                  <div className="report-table-wrap">
                    <table className="report-table line-breakdown-table">
                      <thead><tr>
                        <th className="sticky-column metric-column">行项目</th>
                        {report.monthly.map((month) => <th key={month.period}>{formatReportPeriod(month.period)}</th>)}
                        <th className="total-column">项目周期</th>
                      </tr></thead>
                      <tbody>{lineBreakdown.map((item) => {
                        const values = new Map(item.values.map((value) => [value.period, value.value]))
                        return (
                          <tr key={item.lineId}>
                            <th className="sticky-column metric-column">
                              <span>{item.lineName}</span>
                              <small>{item.category === 'revenue' ? '收入' : '成本'} · {item.lineCode}</small>
                            </th>
                            {report.monthly.map((month) => (
                              <td key={month.period} className="number-cell">
                                {formatWan(values.get(month.period) ?? '0')}
                              </td>
                            ))}
                            <td className="number-cell total-column">{formatWan(item.total)}</td>
                          </tr>
                        )
                      })}</tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
          <ReportTable title="分月损益" report={report} rows={profitRows} />
          {report.hasCashFacts ? (
            <ReportTable title="分月现金流" report={report} rows={cashRows} />
          ) : (
            <section className="report-section cashflow-pending">
              <Info size={18} />
              <div><h2>现金流尚未生成</h2><p>收付款规则将在 P1C 阶段把损益行项目转换为现金流入和现金流出。</p></div>
            </section>
          )}
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
