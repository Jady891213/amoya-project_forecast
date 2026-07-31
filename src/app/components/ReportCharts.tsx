import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'
import type { ProjectReportDto } from '../../shared/domain/types'

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
])

function number(value: string | null): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function wan(value: string | null): number {
  return Number((number(value) / 10000).toFixed(2))
}

function EChart({ option, ariaLabel }: { option: EChartsCoreOption; ariaLabel: string }) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!container.current) return
    const instance = echarts.init(container.current, undefined, { renderer: 'canvas' })
    instance.setOption(option)
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container.current)
    return () => {
      observer.disconnect()
      instance.dispose()
    }
  }, [option])
  return <div className="report-chart" role="img" aria-label={ariaLabel} ref={container} />
}

export function ReportCharts({ report }: { report: ProjectReportDto }) {
  const periods = report.monthly.map((item) => item.period)
  const profitOption: EChartsCoreOption = {
    animation: false,
    tooltip: { trigger: 'axis' },
    legend: { top: 4, right: 10 },
    grid: { left: 58, right: 28, top: 42, bottom: 34 },
    xAxis: { type: 'category', data: periods, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', name: '万元', nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
    series: [
      { name: '收入', type: 'line', smooth: true, symbolSize: 5, data: report.monthly.map((item) => wan(item.revenue)), itemStyle: { color: '#2f78c4' } },
      { name: '成本', type: 'line', smooth: true, symbolSize: 5, data: report.monthly.map((item) => wan(item.cost)), itemStyle: { color: '#d28a35' } },
      { name: '毛利', type: 'bar', barMaxWidth: 24, data: report.monthly.map((item) => wan(item.grossProfit)), itemStyle: { color: '#7fb5a7' } },
    ],
  }
  const cashOption: EChartsCoreOption = {
    animation: false,
    tooltip: { trigger: 'axis' },
    legend: { top: 4, right: 10 },
    grid: { left: 58, right: 28, top: 42, bottom: 34 },
    xAxis: { type: 'category', data: periods, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', name: '万元', nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
    series: [
      { name: '净现金流', type: 'bar', barMaxWidth: 22, data: report.monthly.map((item) => wan(item.netCashFlow)), itemStyle: { color: '#4d82bd' } },
      { name: '累计现金流', type: 'line', smooth: true, data: report.monthly.map((item) => wan(item.cumulativeCashFlow)), itemStyle: { color: '#bd554d' } },
    ],
  }
  const composition = report.lineBreakdown
    .map((item) => ({ name: item.lineName, value: wan(item.total) }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 10)
  const compositionOption: EChartsCoreOption = {
    animation: false,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 130, right: 28, top: 14, bottom: 28 },
    xAxis: { type: 'value', name: '万元', axisLabel: { fontSize: 10 } },
    yAxis: { type: 'category', data: composition.map((item) => item.name).reverse(), axisLabel: { fontSize: 10, width: 110, overflow: 'truncate' } },
    series: [{ type: 'bar', data: composition.map((item) => item.value).reverse(), barMaxWidth: 18, itemStyle: { color: '#5b8dbf' } }],
  }
  return <div className="report-chart-grid">
    <section><h3>分月损益趋势（万元）</h3><EChart ariaLabel="分月损益趋势图" option={profitOption} /></section>
    <section><h3>分月现金趋势（万元）</h3><EChart ariaLabel="分月现金趋势图" option={cashOption} /></section>
    <section className="wide"><h3>主要行项目构成（万元）</h3><EChart ariaLabel="主要行项目构成图" option={compositionOption} /></section>
  </div>
}
