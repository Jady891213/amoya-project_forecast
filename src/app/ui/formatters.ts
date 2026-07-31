import Decimal from 'decimal.js'
import { formatPeriod } from '../domain/periods'

const numberFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatWan(value: string): string {
  return numberFormatter.format(new Decimal(value).dividedBy(10_000).toNumber())
}

export function formatPercent(value: string | null): string {
  if (value === null) return '—'
  return `${new Decimal(value).times(100).toDecimalPlaces(2).toString()}%`
}

export function formatReportPeriod(value: string): string {
  if (/^\d{4}-\d{2}$/.test(value)) {
    return formatPeriod(value)
  }
  return value
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

