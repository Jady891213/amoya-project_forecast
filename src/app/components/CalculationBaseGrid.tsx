import Decimal from 'decimal.js'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ForecastOverrideDraft, ProjectReportDto } from '../../shared/domain/types'
import { FinancialGrid, type FinancialGridChange, type FinancialGridRow } from './FinancialGrid'

type BaseView = 'all' | 'profit' | 'cash'
type BaseGroup = '收入' | '成本' | '损益指标' | '项目收款' | '项目付款' | '现金指标'

interface CalculationBaseRow extends FinancialGridRow {
  group: BaseGroup
  calculated?: boolean
  rowKind: 'section' | 'summary' | 'detail' | 'metric'
  section: 'profit' | 'cash'
}

const PROFIT_GROUPS = new Set<BaseGroup>(['收入', '成本', '损益指标'])

function FormulaIcon() {
  return (
    <svg className="fx-indicator" viewBox="0 0 24 24" aria-label="系统动态计算" role="img">
      <path d="M4.5 18.5c2.4 0 3.5-1.3 3.5-3.7v-4.4c0-2.8 1.5-4.6 4.7-4.6" />
      <path d="M4.8 11h7" />
      <path d="m14.2 11.4 5.3 7.1m0-7.1-5.3 7.1" />
    </svg>
  )
}

export function CalculationBaseGrid({
  report,
  overrides,
  onChange,
  onClearOverride,
}: {
  report: ProjectReportDto
  overrides: ForecastOverrideDraft[]
  onChange: (changes: FinancialGridChange[]) => void
  onClearOverride: (rowId: string, period: string) => void
}) {
  const [view, setView] = useState<BaseView>('all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<BaseGroup>>(new Set())
  const periods = report.monthly.map((item) => item.period)
  const rows = useMemo<CalculationBaseRow[]>(() => {
    const overrideMap = new Map(overrides.map((item) => [`${item.forecastLineId}:${item.period}`, item]))
    const detailRows = report.lineBreakdown.flatMap((line): CalculationBaseRow[] => {
      const group: BaseGroup = line.category === 'revenue'
        ? '收入'
        : line.category === 'cost'
          ? '成本'
          : line.category === 'cash_inflow'
            ? '项目收款'
            : '项目付款'
      const values = Object.fromEntries(line.values.map((item) => [item.period, item.value]))
      const originalValues = { ...values }
      const overriddenPeriods = new Set<string>()
      line.values.forEach((item) => {
        const override = overrideMap.get(`${line.lineId}:${item.period}`)
        if (!override) return
        values[item.period] = override.overrideValue
        originalValues[item.period] = override.originalValue
        overriddenPeriods.add(item.period)
      })
      return [{
        id: line.lineId,
        label: line.lineName,
        secondary: `${line.lineCode} · ${line.category === 'cash_inflow' || line.category === 'cash_outflow' ? '主动录入' : '预测明细'}`,
        group,
        rowKind: 'detail',
        section: line.category === 'revenue' || line.category === 'cost' ? 'profit' : 'cash',
        rowClassName: 'calculation-detail-row',
        editable: true,
        values,
        originalValues,
        overriddenPeriods,
      }]
    })

    const cashBySource = new Map<string, CalculationBaseRow>()
    report.cashSchedule.forEach((item) => {
      const group: BaseGroup = item.metricCode === 'cash_inflow' ? '项目收款' : '项目付款'
      const key = `${item.metricCode}:${item.sourceLineId}`
      const row = cashBySource.get(key) ?? {
        id: `cash-schedule:${key}`,
        label: `${item.sourceLineName}${item.metricCode === 'cash_inflow' ? '收款' : '付款'}`,
        secondary: `${item.sourceLineCode} · ${item.ruleMethod === 'manual_monthly' ? '逐月指定' : '规则生成'}`,
        group,
        rowKind: 'detail' as const,
        section: 'cash' as const,
        rowClassName: 'calculation-detail-row',
        editable: false,
        values: {},
      }
      row.values[item.settlementPeriod] = new Decimal(row.values[item.settlementPeriod] ?? 0).plus(item.value).toString()
      cashBySource.set(key, row)
    })

    const metricRow = (id: string, label: string, group: BaseGroup, values: Record<string, string>, valueKind?: FinancialGridRow['valueKind'], rowKind: CalculationBaseRow['rowKind'] = 'metric'): CalculationBaseRow => ({
      id: `metric:${id}`,
      label,
      group,
      rowKind,
      section: PROFIT_GROUPS.has(group) ? 'profit' : 'cash',
      rowClassName: `calculation-${rowKind}-row`,
      calculated: true,
      editable: false,
      valueKind,
      values,
    })
    const monthlyValues = (field: keyof ProjectReportDto['monthly'][number]) => Object.fromEntries(
      report.monthly.map((item) => [item.period, String(item[field] ?? '')]),
    )
    const revenueDetails = detailRows.filter((row) => row.group === '收入')
    const costDetails = detailRows.filter((row) => row.group === '成本')
    const directReceipts = detailRows.filter((row) => row.group === '项目收款')
    const directPayments = detailRows.filter((row) => row.group === '项目付款')
    const generatedReceipts = [...cashBySource.values()].filter((row) => row.group === '项目收款')
    const generatedPayments = [...cashBySource.values()].filter((row) => row.group === '项目付款')
    const emptyValues = Object.fromEntries(periods.map((period) => [period, '']))
    const sectionRow = (id: string, label: string, section: CalculationBaseRow['section']): CalculationBaseRow => ({
      id: `section:${id}`,
      label,
      group: section === 'profit' ? '损益指标' : '现金指标',
      rowKind: 'section',
      section,
      rowClassName: 'calculation-section-row',
      editable: false,
      values: emptyValues,
    })

    return [
      sectionRow('profit', '损益指标', 'profit'),
      metricRow('revenue', '收入', '收入', monthlyValues('revenue'), undefined, 'summary'),
      ...revenueDetails,
      metricRow('cost', '成本', '成本', monthlyValues('cost'), undefined, 'summary'),
      ...costDetails,
      metricRow('gross_profit', '毛利', '损益指标', monthlyValues('grossProfit')),
      metricRow('gross_margin', '毛利率', '损益指标', monthlyValues('grossMargin'), 'percentage'),
      sectionRow('cash', '现金流指标', 'cash'),
      metricRow('cash_inflow', '项目收款', '项目收款', monthlyValues('cashInflow'), undefined, 'summary'),
      ...generatedReceipts,
      ...directReceipts,
      metricRow('cash_outflow', '项目付款', '项目付款', monthlyValues('cashOutflow'), undefined, 'summary'),
      ...generatedPayments,
      ...directPayments,
      metricRow('net_cash_flow', '项目净现金流', '现金指标', monthlyValues('netCashFlow')),
      metricRow('cumulative_cash_flow', '累计现金流', '现金指标', monthlyValues('cumulativeCashFlow')),
    ]
  }, [overrides, periods, report])

  const visibleRows = rows.filter((row) => {
    if (view !== 'all' && row.section !== view) return false
    return row.rowKind !== 'detail' || !collapsedGroups.has(row.group)
  })

  function toggleGroup(group: BaseGroup) {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  return <section className="calculation-base-stage">
    <div className="calculation-base-toolbar">
      <div className="calculation-view-switch" role="group" aria-label="计算底表视图">
        <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>全部底表</button>
        <button className={view === 'profit' ? 'active' : ''} onClick={() => setView('profit')}>损益视图</button>
        <button className={view === 'cash' ? 'active' : ''} onClick={() => setView('cash')}>现金流视图</button>
      </div>
      <span>{visibleRows.length} 行 · 同一计算批次</span>
    </div>
    <FinancialGrid
      ariaLabel="项目计算底表"
      periods={periods}
      rows={visibleRows}
      labelColumnTitle="指标 / 行项目"
      labelColumnWidth={315}
      renderRowLabel={(row) => {
        const item = row as CalculationBaseRow
        if (item.rowKind === 'section') return <div className="calculation-section-label">{item.label}</div>
        const collapsible = item.rowKind === 'summary' && ['收入', '成本', '项目收款', '项目付款'].includes(item.group)
        return <div className="calculation-base-label">
          <div>
            {collapsible && <button className="calculation-collapse-button" aria-label={`${collapsedGroups.has(item.group) ? '展开' : '收起'}${item.label}明细`} onClick={(event) => { event.stopPropagation(); toggleGroup(item.group) }}>{collapsedGroups.has(item.group) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>}
            <b>{item.label}</b>
            {item.calculated && <FormulaIcon />}
          </div>
          {item.secondary && <small>{item.secondary}</small>}
        </div>
      }}
      onChange={onChange}
      onClearOverride={onClearOverride}
      toolbarPlacement="bottom"
    />
  </section>
}
