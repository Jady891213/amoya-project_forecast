export function addMonths(period: string, offset: number): string {
  const [yearText, monthText] = period.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function generatePeriods(startPeriod: string, durationMonths: number): string[] {
  return Array.from({ length: durationMonths }, (_, index) =>
    addMonths(startPeriod, index),
  )
}

export function countPeriods(startPeriod: string, endPeriod: string): number {
  const [startYear, startMonth] = startPeriod.split('-').map(Number)
  const [endYear, endMonth] = endPeriod.split('-').map(Number)
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1
}

export function generatePeriodRange(startPeriod: string, endPeriod: string): string[] {
  const count = countPeriods(startPeriod, endPeriod)
  return count > 0 ? generatePeriods(startPeriod, count) : []
}

export function formatPeriod(period: string): string {
  const [year, month] = period.split('-')
  return `${year}年${Number(month)}月`
}
