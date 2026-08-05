import { PROFIT_METRIC_NODES, metricPath, type ProfitLeafMetricCode } from '../../config/profitMetricHierarchy'
import type { ForecastLineDraft } from './types'

export function buildDefaultForecastLines(startPeriod: string, endPeriod: string): ForecastLineDraft[] {
  return PROFIT_METRIC_NODES
    .filter((metric) => metric.isLeaf)
    .map((metric, index) => {
      const root = metricPath(metric.code)[0]?.code
      return {
        code: `LINE-${String(index + 1).padStart(3, '0')}`,
        name: metric.name,
        category: root === 'cost' ? 'cost' : 'revenue',
        metricCode: metric.code as ProfitLeafMetricCode,
        forecastMethod: 'fixed_monthly',
        startPeriod,
        endPeriod,
        fixedMonthlyValue: '0',
        amountBasis: 'tax_exclusive',
        taxRate: '0',
        assumption: '',
        sortOrder: index + 1,
        monthlyValues: {},
      }
    })
}
