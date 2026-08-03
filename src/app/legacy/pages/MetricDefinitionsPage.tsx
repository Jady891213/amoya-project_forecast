import { LockKeyhole } from 'lucide-react'
import type { MetricDefinition } from '../../domain/types'
import { OriginBadge } from '../../ui/OriginBadge'
import { PageBreadcrumbs } from '../../components/PageBreadcrumbs'

export function MetricDefinitionsPage({ metrics }: { metrics: MetricDefinition[] }) {
  const metricName = (code: string) =>
    metrics.find((metric) => metric.code === code)?.name ?? code

  return (
    <>
      <header className="page-head">
        <div className="page-head-main">
          <PageBreadcrumbs items={[{ label: '平台配置' }, { label: '指标管理' }]} />
          <h1>指标管理</h1>
          <p>基础指标与系统计算指标使用同一张指标维度表统一管理。</p>
        </div>
        <span className="readonly-mark">
          <LockKeyhole size={14} /> 系统维护
        </span>
      </header>
      <div className="page-body">
        <div className="summary-line">
          <span>指标总数 <b>{metrics.length}</b></span>
          <span>基础指标 <b>{metrics.filter((item) => item.metricType === 'base').length}</b></span>
          <span>系统计算指标 <b>{metrics.filter((item) => item.metricType === 'calculated').length}</b></span>
          <span>维度口径 <b>项目 · 部门 · 期间 · 场景 · 版本</b></span>
        </div>
        <section className="data-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>来源</th>
                <th>指标编码</th>
                <th>指标名称</th>
                <th>类型</th>
                <th>分类</th>
                <th>单位</th>
                <th>期间汇总</th>
                <th style={{ width: '22%' }}>表达式</th>
                <th style={{ width: '22%' }}>说明</th>
                <th>依赖指标</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={metric.code}>
                  <td><OriginBadge origin="system" /></td>
                  <td><code>{metric.code}</code></td>
                  <td className="strong-cell">{metric.name}</td>
                  <td>
                    <span className={`metric-type metric-${metric.metricType}`}>
                      {metric.metricType === 'base' ? '基础指标' : '系统计算'}
                    </span>
                  </td>
                  <td>{metric.category === 'profit' ? '损益' : '现金流'}</td>
                  <td>{metric.unit}</td>
                  <td>
                    {metric.periodAggregation === 'sum'
                      ? '求和'
                      : metric.periodAggregation === 'ending'
                        ? '期末值'
                        : '汇总后重算'}
                  </td>
                  <td><code>{metric.expression ?? '由事实写入'}</code></td>
                  <td>{metric.description}</td>
                  <td>{metric.dependencies.map(metricName).join('、') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="table-note">
            系统计算指标查询时即时计算，不写回 fact_metric_value；最大垫资和现金转正期间属于周期级报告结果。
          </p>
        </section>
      </div>
    </>
  )
}
