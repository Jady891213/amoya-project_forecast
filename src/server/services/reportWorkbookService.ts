import Decimal from 'decimal.js'
import ExcelJS from 'exceljs'
import type {
  ProjectReportDto,
  ReportLineResult,
  ReportMetricGroup,
  ReportParameterResult,
} from '../../shared/domain/types'
import {
  buildReportDisplay,
  reportUnitLabel,
  scaleReportAmount,
  type ReportDisplayLine,
  type ReportDisplayUnit,
  type ReportTaxBasis,
} from '../../shared/reporting/reportDisplay'
import { metricPathLabel } from '../../config/profitMetricHierarchy'
import { V31_REPORT_TEMPLATE as TEMPLATE } from '../reportTemplates/v31ProjectReportTemplate'

const FONT = 'Microsoft YaHei'

export interface ReportWorkbookOptions {
  aiMaterial?: boolean
  creator?: string
  company?: string
  note?: string
  taxBasis?: ReportTaxBasis
  displayUnit?: ReportDisplayUnit
}

function numeric(value: Decimal.Value | null | undefined): number {
  try { return new Decimal(value ?? 0).toNumber() }
  catch { return 0 }
}

function wan(value: Decimal.Value | null | undefined): number {
  return new Decimal(value ?? 0).div(10_000).toNumber()
}

function formula(formulaText: string, result: number): ExcelJS.CellFormulaValue {
  return { formula: formulaText, result }
}

function border(): Partial<ExcelJS.Borders> {
  const line = { style: 'thin' as const, color: { argb: TEMPLATE.colors.border } }
  return { top: line, left: line, bottom: line, right: line }
}

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function styleTitle(sheet: ExcelJS.Worksheet, text: string, lastColumn: number) {
  sheet.mergeCells(1, 1, 1, lastColumn)
  const cell = sheet.getCell(1, 1)
  cell.value = text
  cell.font = { name: FONT, size: 16, bold: true, color: { argb: 'FFFFFFFF' } }
  cell.fill = fill(TEMPLATE.colors.primary)
  cell.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet.getRow(1).height = 30
}

function styleSubtitle(sheet: ExcelJS.Worksheet, text: string, lastColumn: number) {
  sheet.mergeCells(2, 1, 2, lastColumn)
  const cell = sheet.getCell(2, 1)
  cell.value = text
  cell.font = { name: FONT, size: 10, color: { argb: TEMPLATE.colors.muted } }
  cell.fill = fill('FFF8FAFD')
  cell.border = border()
  cell.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet.getRow(2).height = 21
}

function styleSection(sheet: ExcelJS.Worksheet, rowNumber: number, text: string, lastColumn = 10) {
  sheet.mergeCells(rowNumber, 1, rowNumber, lastColumn)
  const cell = sheet.getCell(rowNumber, 1)
  cell.value = text
  cell.fill = fill(TEMPLATE.colors.primarySoft)
  cell.font = { name: FONT, size: 11, bold: true, color: { argb: TEMPLATE.colors.text } }
  cell.alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.getRow(rowNumber).height = 24
}

function styleHeader(row: ExcelJS.Row, from = 1, to = row.cellCount) {
  for (let column = from; column <= to; column += 1) {
    const cell = row.getCell(column)
    cell.fill = fill(TEMPLATE.colors.header)
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: TEMPLATE.colors.text } }
    cell.border = border()
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  }
  row.height = 23
}

function styleDataRow(row: ExcelJS.Row, from = 1, to = row.cellCount) {
  for (let column = from; column <= to; column += 1) {
    const cell = row.getCell(column)
    cell.font = { name: FONT, size: 10, color: { argb: TEMPLATE.colors.result } }
    cell.border = border()
    cell.alignment = { vertical: 'middle', horizontal: column === 1 ? 'left' : 'right' }
  }
  row.height = 21
}

function styleSummaryRow(row: ExcelJS.Row, lastColumn: number, fillColor: string = TEMPLATE.colors.revenueTotal) {
  styleDataRow(row, 1, lastColumn)
  for (let column = 1; column <= lastColumn; column += 1) {
    row.getCell(column).fill = fill(fillColor)
    row.getCell(column).font = { name: FONT, size: 10, bold: true, color: { argb: TEMPLATE.colors.text } }
  }
}

function applyWorkbookDefaults(sheet: ExcelJS.Worksheet) {
  sheet.properties.defaultRowHeight = 20
  sheet.views = [{ state: 'normal', showGridLines: false }]
  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.45, header: 0.15, footer: 0.15 },
  }
  sheet.headerFooter.oddFooter = '&L项目测算&R第 &P / &N 页'
}

function reportLines(lines: ReportDisplayLine[]): ReportDisplayLine[] {
  const order = { revenue: 0, cost: 1, cash_inflow: 2, cash_outflow: 3 }
  return lines
    .filter((item) => item.category === 'revenue' || item.category === 'cost')
    .sort((a, b) => order[a.category] - order[b.category] || a.code.localeCompare(b.code))
}

function assumptionValue(item: ReportLineResult, displayUnit: ReportDisplayUnit): number | null {
  if (!item.priceOrRatio) return null
  if (item.method === '按收入比例') return numeric(item.priceOrRatio) / 100
  if (item.method === '单价 × 数量') return scaleReportAmount(item.priceOrRatio, displayUnit)
  return numeric(item.priceOrRatio)
}

function amountBasisLabel(item: ReportLineResult): string {
  if (item.amountBasis === 'tax_inclusive') return '含税录入'
  if (item.amountBasis === 'non_taxable') return '免税/不计税'
  return '未税录入'
}

function lineExplanation(item: ReportLineResult): string {
  if (item.method === '单价 × 数量' && item.priceOrRatio && item.quantity) {
    return `${item.priceOrRatio} 元 × ${Number(item.quantity).toLocaleString('zh-CN')} × ${item.months ?? 0} 个月`
  }
  if (item.method === '按收入比例' && item.priceOrRatio) return `按收入的 ${item.priceOrRatio}% 计提`
  return item.methodDescription || `${item.method}，${amountBasisLabel(item)}`
}

function sumFormula(column: string, rows: number[], fallback = 0): string {
  if (!rows.length) return `=${fallback}`
  if (rows.length === 1) return `=${column}${rows[0]}`
  return `=SUM(${column}${rows[0]}:${column}${rows.at(-1)})`
}

function annualLineAmount(item: ReportDisplayLine, year: number, displayUnit: ReportDisplayUnit): number {
  return scaleReportAmount(item.displayMonthly
    .filter((value) => Number(value.period.slice(0, 4)) === year)
    .reduce((sum, value) => sum.plus(value.value), new Decimal(0)), displayUnit)
}

function metricGroupLines(group: ReportMetricGroup): ReportDisplayLine[] {
  return [
    ...(group.items as ReportDisplayLine[]),
    ...group.children.flatMap(metricGroupLines),
  ]
}

function metricGroupMonthly(group: ReportMetricGroup, period: string): Decimal {
  return metricGroupLines(group).reduce((sum, line) => sum.plus(line.displayMonthly.find((item) => item.period === period)?.value ?? 0), new Decimal(0))
}

export class ReportWorkbookService {
  async build(report: ProjectReportDto, options: ReportWorkbookOptions = {}): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = options.creator ?? '项目测算'
    workbook.company = options.company ?? 'Amoya'
    workbook.created = new Date(report.presentation.generatedAt)
    workbook.modified = new Date(report.presentation.generatedAt)
    workbook.calcProperties.fullCalcOnLoad = true

    this.addReportSheet(workbook, report, options)
    this.addMonthlySheet(workbook, report, options)

    const bytes = await workbook.xlsx.writeBuffer()
    return Buffer.from(bytes)
  }

  private addReportSheet(workbook: ExcelJS.Workbook, report: ProjectReportDto, options: ReportWorkbookOptions) {
    const taxBasis = options.taxBasis ?? 'tax_exclusive'
    const displayUnit = options.displayUnit ?? 'wan'
    const display = buildReportDisplay(report, taxBasis, displayUnit)
    const unitLabel = reportUnitLabel(displayUnit)
    const amount = (value: Decimal.Value | null | undefined) => scaleReportAmount(value, displayUnit)
    const sheet = workbook.addWorksheet(TEMPLATE.sheets.report)
    applyWorkbookDefaults(sheet)
    TEMPLATE.reportColumns.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
    const generatedDate = report.presentation.generatedAt.slice(0, 10)
    styleTitle(sheet, `${report.project.name}｜项目测算分析报告`, 10)
    styleSubtitle(sheet, `${report.plan.name} · ${display.basisLabel}口径 · 单位：${unitLabel} · 生成日期：${generatedDate}`, 10)

    styleSection(sheet, 4, '一、核心指标')
    const coreHeader = sheet.getRow(5)
    coreHeader.values = ['指标', '收入', '成本', '利润', '利润率', 'ROI', null, '项目周期', '申报部门', '方案']
    styleHeader(coreHeader, 1, 10)
    const core = sheet.getRow(6)
    core.values = [
      '结果',
      amount(display.summary.revenue),
      amount(display.summary.cost),
      amount(display.summary.grossProfit),
      numeric(display.summary.grossMargin),
      numeric(display.summary.roi),
      null,
      `${report.plan.startPeriod} 至 ${report.operationEndPeriod}`,
      report.department?.name ?? '—',
      report.plan.name,
    ]
    styleDataRow(core, 1, 10)
    core.getCell(1).font = { name: FONT, size: 10, bold: true, color: { argb: TEMPLATE.colors.text } }
    for (let column = 2; column <= 6; column += 1) {
      core.getCell(column).font = { name: FONT, size: 12, bold: true, color: { argb: 'FF159B6B' } }
      core.getCell(column).numFmt = column >= 5 ? TEMPLATE.numberFormats.percentage : TEMPLATE.numberFormats.amount
    }
    for (let column = 8; column <= 10; column += 1) core.getCell(column).alignment = { vertical: 'middle', horizontal: 'center' }

    const lines = reportLines(display.lineResults)
    const assumptionSectionRow = 8
    const assumptionHeaderRow = 9
    styleSection(sheet, assumptionSectionRow, '二、测算假设与输入')
    const assumptionHeader = sheet.getRow(assumptionHeaderRow)
    assumptionHeader.values = ['类型', '指标分类', '测算项', '测算方式', '单价/比例', '数量', '月数', '税率', `${display.basisLabel}合计`, '说明']
    styleHeader(assumptionHeader, 1, 10)
    const revenueRows: number[] = []
    const costRows: number[] = []
    lines.forEach((item, index) => {
      const rowNumber = assumptionHeaderRow + 1 + index
      const row = sheet.getRow(rowNumber)
      row.values = [
        item.category === 'revenue' ? '收入' : '成本',
        metricPathLabel(item.metricCode),
        item.name,
        item.method,
        assumptionValue(item, displayUnit),
        item.quantity ? numeric(item.quantity) : null,
        item.months ?? null,
        numeric(item.taxRate),
        amount(item.displayTotal),
        lineExplanation(item),
      ]
      styleDataRow(row, 1, 10)
      row.getCell(1).font = {
        name: FONT, size: 10, bold: true,
        color: { argb: item.category === 'revenue' ? 'FF159B6B' : 'FFE27A17' },
      }
      ;[5, 6, 7, 8].forEach((column) => {
        if (row.getCell(column).value !== null) row.getCell(column).font = { name: FONT, size: 10, color: { argb: TEMPLATE.colors.assumption } }
      })
      row.getCell(5).numFmt = item.method === '按收入比例' ? TEMPLATE.numberFormats.percentage : TEMPLATE.numberFormats.decimal
      row.getCell(6).numFmt = TEMPLATE.numberFormats.quantity
      row.getCell(7).numFmt = TEMPLATE.numberFormats.quantity
      row.getCell(8).numFmt = TEMPLATE.numberFormats.percentage
      row.getCell(9).numFmt = TEMPLATE.numberFormats.amount
      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
      row.getCell(3).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
      row.getCell(10).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
      row.height = 32
      ;(item.category === 'revenue' ? revenueRows : costRows).push(rowNumber)
    })

    const basisColumn = 'I'
    core.getCell(2).value = formula(sumFormula(basisColumn, revenueRows).slice(1), amount(display.summary.revenue))
    core.getCell(3).value = formula(sumFormula(basisColumn, costRows).slice(1), amount(display.summary.cost))
    core.getCell(4).value = formula('B6-C6', amount(display.summary.grossProfit))
    core.getCell(5).value = formula('IF(B6=0,0,D6/B6)', numeric(display.summary.grossMargin))
    core.getCell(6).value = formula('IF(C6=0,0,D6/C6)', numeric(display.summary.roi))

    const annualSectionRow = assumptionHeaderRow + lines.length + 2
    styleSection(sheet, annualSectionRow, '三、年度利润情况')
    const annualHeaderRow = annualSectionRow + 1
    const years = display.annualResults.map((item) => item.year)
    const annualLastColumn = Math.min(10, years.length + 2)
    const annualHeader = sheet.getRow(annualHeaderRow)
    annualHeader.values = [`明细项目（${display.basisLabel}）`, ...years.map((year) => `${year}年`), '合计']
    styleHeader(annualHeader, 1, annualLastColumn)
    const yearColumnByYear = new Map(years.map((year, index) => [year, index + 2]))
    let annualRow = annualHeaderRow + 1
    const addAnnualGroup = (label: string, category: 'revenue' | 'cost', groups: ReportMetricGroup[]) => {
      const groupRow = sheet.getRow(annualRow++)
      const rootRowNumber = groupRow.number
      groupRow.getCell(1).value = label
      years.forEach((year, index) => {
        const annual = display.annualResults.find((item) => item.year === year)
        groupRow.getCell(index + 2).value = amount(category === 'revenue' ? annual?.revenue : annual?.cost)
      })
      groupRow.getCell(annualLastColumn).value = amount(category === 'revenue' ? display.summary.revenue : display.summary.cost)
      styleSummaryRow(groupRow, annualLastColumn)
      for (let column = 2; column <= annualLastColumn; column += 1) groupRow.getCell(column).numFmt = TEMPLATE.numberFormats.amount
      const addMetricGroup = (metricGroup: ReportMetricGroup, indent: number) => {
        const groupLines = metricGroupLines(metricGroup)
        const metricRow = sheet.getRow(annualRow++)
        metricRow.getCell(1).value = `${'  '.repeat(indent)}${metricGroup.name}`
        years.forEach((year) => {
          const column = yearColumnByYear.get(year) ?? 2
          metricRow.getCell(column).value = groupLines.reduce((sum, item) => sum + annualLineAmount(item, year, displayUnit), 0)
          metricRow.getCell(column).numFmt = TEMPLATE.numberFormats.amount
        })
        metricRow.getCell(annualLastColumn).value = amount(metricGroup.amount)
        metricRow.getCell(annualLastColumn).numFmt = TEMPLATE.numberFormats.amount
        styleSummaryRow(metricRow, annualLastColumn, indent === 1 ? TEMPLATE.colors.primarySoft : TEMPLATE.colors.header)
        metricGroup.children.forEach((child) => addMetricGroup(child, indent + 1))
        metricGroup.items.forEach((rawItem) => {
          const item = rawItem as ReportDisplayLine
          const row = sheet.getRow(annualRow++)
          row.getCell(1).value = `${'  '.repeat(indent + 1)}${item.name}`
          years.forEach((year) => {
            const column = yearColumnByYear.get(year) ?? 2
            row.getCell(column).value = annualLineAmount(item, year, displayUnit)
            row.getCell(column).numFmt = TEMPLATE.numberFormats.amount
          })
          row.getCell(annualLastColumn).value = amount(item.displayTotal)
          row.getCell(annualLastColumn).numFmt = TEMPLATE.numberFormats.amount
          styleDataRow(row, 1, annualLastColumn)
        })
      }
      groups.forEach((metricGroup) => addMetricGroup(metricGroup, 1))
      return rootRowNumber
    }
    const annualRevenueRow = addAnnualGroup('收入', 'revenue', display.revenueMetricGroups)
    const annualCostRow = addAnnualGroup('成本', 'cost', display.costMetricGroups)
    const profitRow = sheet.getRow(annualRow++)
    profitRow.getCell(1).value = '利润'
    display.annualResults.forEach((item, index) => {
      const column = index + 2
      profitRow.getCell(column).value = formula(`${sheet.getColumn(column).letter}${annualRevenueRow}-${sheet.getColumn(column).letter}${annualCostRow}`, amount(item.grossProfit))
      profitRow.getCell(column).numFmt = TEMPLATE.numberFormats.amount
    })
    profitRow.getCell(annualLastColumn).value = amount(display.summary.grossProfit)
    profitRow.getCell(annualLastColumn).numFmt = TEMPLATE.numberFormats.amount
    styleSummaryRow(profitRow, annualLastColumn, TEMPLATE.colors.profitTotal)
    const marginRow = sheet.getRow(annualRow++)
    marginRow.getCell(1).value = '利润率'
    display.annualResults.forEach((item, index) => {
      marginRow.getCell(index + 2).value = numeric(item.grossMargin)
      marginRow.getCell(index + 2).numFmt = TEMPLATE.numberFormats.percentage
    })
    marginRow.getCell(annualLastColumn).value = numeric(display.summary.grossMargin)
    marginRow.getCell(annualLastColumn).numFmt = TEMPLATE.numberFormats.percentage
    styleSummaryRow(marginRow, annualLastColumn, TEMPLATE.colors.header)

    const conclusionSectionRow = annualRow + 1
    styleSection(sheet, conclusionSectionRow, '四、主要结论与提示')
    sheet.mergeCells(conclusionSectionRow + 1, 1, conclusionSectionRow + 2, 10)
    const conclusion = sheet.getCell(conclusionSectionRow + 1, 1)
    conclusion.value = display.conclusionDescription
    conclusion.fill = fill(TEMPLATE.colors.note)
    conclusion.font = { name: FONT, size: 10, color: { argb: TEMPLATE.colors.noteText } }
    conclusion.border = border()
    conclusion.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
    sheet.getRow(conclusionSectionRow + 1).height = 24
    sheet.getRow(conclusionSectionRow + 2).height = 24
    const noteRow = conclusionSectionRow + 4
    sheet.mergeCells(noteRow, 1, noteRow, 10)
    const note = sheet.getCell(noteRow, 1)
    note.value = options.note ?? `说明：本报告读取当前方案最后一次成功计算形成的最终事实。蓝色数字为可调整假设，黑色数字为计算结果；损益按${display.basisLabel}口径、${unitLabel}展示。`
    note.font = { name: FONT, size: 9, italic: true, color: { argb: TEMPLATE.colors.muted } }
    note.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
    sheet.getRow(noteRow).height = 26
    sheet.views = [{ state: 'frozen', ySplit: 2, showGridLines: false }]
    sheet.pageSetup.printArea = `A1:J${noteRow}`
  }

  private addMonthlySheet(workbook: ExcelJS.Workbook, report: ProjectReportDto, options: ReportWorkbookOptions) {
    const taxBasis = options.taxBasis ?? 'tax_exclusive'
    const displayUnit = options.displayUnit ?? 'wan'
    const display = buildReportDisplay(report, taxBasis, displayUnit)
    const unitLabel = reportUnitLabel(displayUnit)
    const amount = (value: Decimal.Value | null | undefined) => scaleReportAmount(value, displayUnit)
    const periods = report.monthly
      .filter((item) => options.aiMaterial || item.period <= report.operationEndPeriod)
      .map((item) => item.period)
    const lastColumn = periods.length + 2
    const sheet = workbook.addWorksheet(TEMPLATE.sheets.monthly)
    applyWorkbookDefaults(sheet)
    sheet.getColumn(1).width = TEMPLATE.monthlyLabelWidth
    for (let column = 2; column <= lastColumn; column += 1) sheet.getColumn(column).width = TEMPLATE.monthlyValueWidth
    styleTitle(sheet, `${report.project.name}｜月度明细`, lastColumn)
    styleSubtitle(sheet, `${report.plan.name} · ${display.basisLabel}口径 · 单位：${unitLabel}`, lastColumn)
    const header = sheet.getRow(4)
    header.values = ['指标 / 测算项', ...periods, '合计']
    styleHeader(header, 1, lastColumn)

    const lines = reportLines(display.lineResults)
    let rowNumber = 5
    const addCategory = (label: string, groups: ReportMetricGroup[], summaryValues: string[], summaryTotal: string) => {
      const summaryRow = sheet.getRow(rowNumber++)
      summaryRow.getCell(1).value = label
      summaryValues.forEach((value, index) => {
        summaryRow.getCell(index + 2).value = amount(value)
        summaryRow.getCell(index + 2).numFmt = TEMPLATE.numberFormats.amount
      })
      summaryRow.getCell(lastColumn).value = amount(summaryTotal)
      summaryRow.getCell(lastColumn).numFmt = TEMPLATE.numberFormats.amount
      styleSummaryRow(summaryRow, lastColumn)
      const addMetricGroup = (metricGroup: ReportMetricGroup, indent: number) => {
        const metricRow = sheet.getRow(rowNumber++)
        metricRow.getCell(1).value = `${'  '.repeat(indent)}${metricGroup.name}`
        periods.forEach((period, index) => {
          metricRow.getCell(index + 2).value = amount(metricGroupMonthly(metricGroup, period))
          metricRow.getCell(index + 2).numFmt = TEMPLATE.numberFormats.amount
        })
        metricRow.getCell(lastColumn).value = amount(metricGroup.amount)
        metricRow.getCell(lastColumn).numFmt = TEMPLATE.numberFormats.amount
        styleSummaryRow(metricRow, lastColumn, indent === 1 ? TEMPLATE.colors.primarySoft : TEMPLATE.colors.header)
        metricGroup.children.forEach((child) => addMetricGroup(child, indent + 1))
        metricGroup.items.forEach((rawItem) => {
          const item = rawItem as ReportDisplayLine
          const row = sheet.getRow(rowNumber++)
          row.getCell(1).value = `${'  '.repeat(indent + 1)}${item.name}`
          const values = new Map(item.displayMonthly.map((value) => [value.period, value.value]))
          periods.forEach((period, index) => {
            row.getCell(index + 2).value = amount(values.get(period))
            row.getCell(index + 2).numFmt = TEMPLATE.numberFormats.amount
          })
          row.getCell(lastColumn).value = amount(item.displayTotal)
          row.getCell(lastColumn).numFmt = TEMPLATE.numberFormats.amount
          styleDataRow(row, 1, lastColumn)
        })
      }
      groups.forEach((metricGroup) => addMetricGroup(metricGroup, 1))
      return summaryRow.number
    }

    const categoryMonthly = (category: 'revenue' | 'cost') => periods.map((period) => lines
      .filter((item) => item.category === category)
      .reduce((sum, item) => sum.plus(item.displayMonthly.find((value) => value.period === period)?.value ?? 0), new Decimal(0))
      .toString())
    const revenueRow = addCategory('收入', display.revenueMetricGroups, categoryMonthly('revenue'), display.summary.revenue)
    const costRow = addCategory('成本', display.costMetricGroups, categoryMonthly('cost'), display.summary.cost)
    const profitRow = sheet.getRow(rowNumber++)
    profitRow.getCell(1).value = '利润'
    periods.forEach((_, index) => {
      const column = index + 2
      const letter = sheet.getColumn(column).letter
      const result = amount(new Decimal(categoryMonthly('revenue')[index] ?? 0).minus(categoryMonthly('cost')[index] ?? 0))
      profitRow.getCell(column).value = formula(`${letter}${revenueRow}-${letter}${costRow}`, result)
      profitRow.getCell(column).numFmt = TEMPLATE.numberFormats.amount
    })
    profitRow.getCell(lastColumn).value = formula(
      `SUM(B${profitRow.number}:${sheet.getColumn(lastColumn - 1).letter}${profitRow.number})`,
      amount(display.summary.grossProfit),
    )
    profitRow.getCell(lastColumn).numFmt = TEMPLATE.numberFormats.amount
    styleSummaryRow(profitRow, lastColumn, TEMPLATE.colors.profitTotal)
    const marginRow = sheet.getRow(rowNumber++)
    marginRow.getCell(1).value = '利润率'
    periods.forEach((period, index) => {
      const column = index + 2
      const letter = sheet.getColumn(column).letter
      marginRow.getCell(column).value = formula(
        `IF(${letter}${revenueRow}=0,0,${letter}${profitRow.number}/${letter}${revenueRow})`,
        (() => {
          const revenue = new Decimal(categoryMonthly('revenue')[index] ?? 0)
          const cost = new Decimal(categoryMonthly('cost')[index] ?? 0)
          return revenue.isZero() ? 0 : revenue.minus(cost).div(revenue).toNumber()
        })(),
      )
      marginRow.getCell(column).numFmt = TEMPLATE.numberFormats.percentage
    })
    marginRow.getCell(lastColumn).value = formula(
      `IF(${sheet.getColumn(lastColumn).letter}${revenueRow}=0,0,${sheet.getColumn(lastColumn).letter}${profitRow.number}/${sheet.getColumn(lastColumn).letter}${revenueRow})`,
      numeric(display.summary.grossMargin),
    )
    marginRow.getCell(lastColumn).numFmt = TEMPLATE.numberFormats.percentage
    styleSummaryRow(marginRow, lastColumn, TEMPLATE.colors.header)

    report.presentation.parameterResults.forEach((parameter) => {
      const row = sheet.getRow(rowNumber++)
      row.getCell(1).value = parameter.name
      const values = new Map(parameter.monthly.map((item) => [item.period, item.value]))
      periods.forEach((period, index) => {
        const value = values.get(period)
        row.getCell(index + 2).value = value === null || value === undefined ? null : numeric(value)
        row.getCell(index + 2).numFmt = this.parameterFormat(parameter)
      })
      row.getCell(lastColumn).value = parameter.total === null ? null : numeric(parameter.total)
      row.getCell(lastColumn).numFmt = this.parameterFormat(parameter)
      styleDataRow(row, 1, lastColumn)
      for (let column = 1; column <= lastColumn; column += 1) {
        row.getCell(column).font = { name: FONT, size: 10, color: { argb: 'FFE27A17' } }
        row.getCell(column).fill = fill(TEMPLATE.colors.warning)
      }
    })

    if (options.aiMaterial) {
      const cashLines = report.presentation.lineResults
        .filter((item) => item.category === 'cash_inflow' || item.category === 'cash_outflow')
      const addCashMetric = (
        label: string,
        field: 'cashInflow' | 'cashOutflow' | 'netCashFlow' | 'cumulativeCashFlow',
        total: string,
        fillColor: string,
        details: ReportLineResult[] = [],
      ) => {
        const row = sheet.getRow(rowNumber++)
        row.getCell(1).value = label
        periods.forEach((period, index) => {
          const value = report.monthly.find((item) => item.period === period)?.[field]
          row.getCell(index + 2).value = wan(value)
          row.getCell(index + 2).numFmt = TEMPLATE.numberFormats.amount
        })
        row.getCell(lastColumn).value = wan(total)
        row.getCell(lastColumn).numFmt = TEMPLATE.numberFormats.amount
        styleSummaryRow(row, lastColumn, fillColor)
        details.forEach((item) => {
          const detail = sheet.getRow(rowNumber++)
          detail.getCell(1).value = `  ${item.name}`
          const values = new Map(item.monthly.map((value) => [value.period, value.value]))
          periods.forEach((period, index) => {
            detail.getCell(index + 2).value = wan(values.get(period))
            detail.getCell(index + 2).numFmt = TEMPLATE.numberFormats.amount
          })
          detail.getCell(lastColumn).value = wan(item.netTotal)
          detail.getCell(lastColumn).numFmt = TEMPLATE.numberFormats.amount
          styleDataRow(detail, 1, lastColumn)
        })
      }
      addCashMetric('现金流入', 'cashInflow', report.summary.cashInflow, TEMPLATE.colors.revenueTotal, cashLines.filter((item) => item.category === 'cash_inflow'))
      addCashMetric('现金流出', 'cashOutflow', report.summary.cashOutflow, TEMPLATE.colors.warning, cashLines.filter((item) => item.category === 'cash_outflow'))
      addCashMetric('净现金流', 'netCashFlow', report.summary.netCashFlow, TEMPLATE.colors.profitTotal)
      addCashMetric('累计现金流', 'cumulativeCashFlow', report.summary.cumulativeCashFlow, TEMPLATE.colors.header)
    }

    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }]
    sheet.pageSetup.printArea = `A1:${sheet.getColumn(lastColumn).letter}${rowNumber - 1}`
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: rowNumber - 1, column: lastColumn } }
  }

  private parameterFormat(parameter: ReportParameterResult): string {
    if (parameter.valueType === 'percentage') return TEMPLATE.numberFormats.percentage
    if (parameter.valueType === 'quantity') return TEMPLATE.numberFormats.quantity
    return TEMPLATE.numberFormats.decimal
  }
}
