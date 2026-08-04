import ExcelJS from 'exceljs'
import type { ProjectReportDto } from '../../shared/domain/types'

const NAVY = 'FF1F3B5B'
const BLUE = 'FF2F78C4'
const LIGHT_BLUE = 'FFEAF2FD'
const LIGHT_ORANGE = 'FFFFEAD0'
const LIGHT_GRAY = 'FFF2F5F8'
const BORDER = 'FFD7DEE8'

function number(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function title(sheet: ExcelJS.Worksheet, text: string, lastColumn: number) {
  sheet.mergeCells(1, 1, 1, lastColumn)
  const cell = sheet.getCell(1, 1)
  cell.value = text
  cell.font = { name: 'Microsoft YaHei', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  cell.alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.getRow(1).height = 28
}

function header(row: ExcelJS.Row) {
  row.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }
  row.alignment = { vertical: 'middle', horizontal: 'center' }
  row.height = 22
}

function styleBody(sheet: ExcelJS.Worksheet) {
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 2) return
    row.font = { name: 'Microsoft YaHei', size: 9 }
    row.alignment = { vertical: 'middle' }
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'hair', color: { argb: BORDER } } }
    })
  })
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 2, showGridLines: false }]
  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  }
  sheet.headerFooter.oddFooter = '&L项目测算分析工具&R第 &P / &N 页'
}

function addMonthlySheet(
  workbook: ExcelJS.Workbook,
  name: string,
  report: ProjectReportDto,
  rows: Array<{ name: string; values: Array<string | null>; total: string | null; percentage?: boolean }>,
) {
  const sheet = workbook.addWorksheet(name)
  title(sheet, `${report.project.name} · ${name}`, report.monthly.length + 2)
  const headerRow = sheet.addRow(['指标', ...report.monthly.map((item) => item.period), '项目合计'])
  header(headerRow)
  rows.forEach((item) => {
    const row = sheet.addRow([item.name, ...item.values.map(number), number(item.total)])
    row.getCell(1).font = { bold: true }
    for (let column = 2; column <= row.cellCount; column += 1) {
      row.getCell(column).numFmt = item.percentage ? '0.0%' : '#,##0.00;[Red](#,##0.00);-'
      row.getCell(column).alignment = { horizontal: 'right' }
    }
  })
  sheet.getColumn(1).width = 22
  for (let column = 2; column <= report.monthly.length + 2; column += 1) sheet.getColumn(column).width = 13
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2 + rows.length, column: report.monthly.length + 2 } }
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(report.monthly.length + 2).letter}${2 + rows.length}`
  styleBody(sheet)
}

function addUnavailableMonthlySheet(
  workbook: ExcelJS.Workbook,
  name: string,
  report: ProjectReportDto,
  message: string,
) {
  const sheet = workbook.addWorksheet(name)
  title(sheet, `${report.project.name} · ${name}`, 4)
  sheet.mergeCells('A2:D3')
  sheet.getCell('A2').value = message
  sheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  sheet.getCell('A2').font = { name: 'Microsoft YaHei', size: 10, color: { argb: NAVY } }
  ;[18, 18, 18, 18].forEach((width, index) => { sheet.getColumn(index + 1).width = width })
  sheet.pageSetup.printArea = 'A1:D3'
  styleBody(sheet)
}

export class ReportWorkbookService {
  async build(report: ProjectReportDto): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Amoya Project Forecast'
    workbook.company = 'Amoya'
    workbook.created = new Date()
    workbook.modified = new Date()

    this.addProjectSheet(workbook, report)
    this.addAssumptionSheet(workbook, report)
    addMonthlySheet(workbook, '分月损益', report, [
      { name: '收入', values: report.monthly.map((item) => item.revenue), total: report.summary.revenue },
      { name: '成本', values: report.monthly.map((item) => item.cost), total: report.summary.cost },
      { name: '毛利', values: report.monthly.map((item) => item.grossProfit), total: report.summary.grossProfit },
      { name: '毛利率', values: report.monthly.map((item) => item.grossMargin), total: report.summary.grossMargin, percentage: true },
    ])
    if (report.hasCashFacts) {
      addMonthlySheet(workbook, '分月现金流', report, [
        { name: '现金流入', values: report.monthly.map((item) => item.cashInflow), total: report.summary.cashInflow },
        { name: '现金流出', values: report.monthly.map((item) => item.cashOutflow), total: report.summary.cashOutflow },
        { name: '净现金流', values: report.monthly.map((item) => item.netCashFlow), total: report.summary.netCashFlow },
        { name: '累计现金流', values: report.monthly.map((item) => item.cumulativeCashFlow), total: report.summary.cumulativeCashFlow },
      ])
    } else {
      addUnavailableMonthlySheet(
        workbook,
        '分月现金流',
        report,
        '源项目未提供现金计划，本报告不以 0 元代替现金流结果。',
      )
    }
    this.addLineDetailSheet(workbook, report)
    this.addCashTraceSheet(workbook, report)
    this.addMetricSheet(workbook, report)

    const bytes = await workbook.xlsx.writeBuffer()
    return Buffer.from(bytes)
  }

  private addProjectSheet(workbook: ExcelJS.Workbook, report: ProjectReportDto) {
    const sheet = workbook.addWorksheet('项目信息')
    title(sheet, '项目测算报告', 4)
    const rows = [
      ['项目编码', report.project.code ?? '—', '项目名称', report.project.name],
      ['申报部门', report.department?.name ?? '—', '测算期间', `${report.plan.startPeriod} 至 ${report.plan.endPeriod}`],
      ['场景', report.scenario.name, '方案', report.plan.name],
      ['最近计算', report.calculationState?.lastSuccessAt ? new Date(report.calculationState.lastSuccessAt) : '无', '结果修订', report.calculationState?.resultRevision ?? 0],
      ['结果状态', report.isBehindDraft ? '落后于当前配置' : '与当前配置一致', '导出时间', new Date()],
      ['口径', '金额单位：元；损益为未税标准口径', '现金转正期间', report.hasCashFacts ? report.summary.cashPositiveLabel : '暂无现金数据'],
      ['最大垫资', report.hasCashFacts ? number(report.summary.maximumFunding) : '暂无现金数据', '累计现金流', report.hasCashFacts ? number(report.summary.cumulativeCashFlow) : '暂无现金数据'],
    ]
    rows.forEach((values) => sheet.addRow(values))
    ;[1, 3].forEach((column) => {
      sheet.getColumn(column).width = 18
      for (let row = 2; row <= sheet.rowCount; row += 1) {
        sheet.getCell(row, column).font = { bold: true, color: { argb: NAVY } }
        sheet.getCell(row, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_GRAY } }
      }
    })
    sheet.getColumn(2).width = 34
    sheet.getColumn(4).width = 34
    sheet.getCell('B7').alignment = { wrapText: true }
    sheet.getCell('D7').numFmt = 'yyyy-mm-dd hh:mm'
    sheet.getCell('B9').numFmt = '#,##0.00;[Red](#,##0.00);-'
    sheet.getCell('D9').numFmt = '#,##0.00;[Red](#,##0.00);-'
    styleBody(sheet)
    sheet.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }]
    sheet.pageSetup.orientation = 'portrait'
    sheet.pageSetup.printArea = `A1:D${sheet.rowCount}`
  }

  private addAssumptionSheet(workbook: ExcelJS.Workbook, report: ProjectReportDto) {
    const sheet = workbook.addWorksheet('测算假设')
    title(sheet, `${report.project.name} · 测算假设与人工调整`, 6)
    header(sheet.addRow(['类型', '编码/行项目', '名称/期间', '当前值', '单位/原值', '说明']))
    report.keyAssumptions.forEach((item) => sheet.addRow(['项目参数', item.code, item.name, item.value, item.unit || '—', '当前方案配置']))
    report.adjustments.forEach((item) => {
      const line = report.lineBreakdown.find((candidate) => candidate.lineId === item.forecastLineId)
      const original = line?.values.find((value) => value.period === item.period)?.value
      const row = sheet.addRow(['人工调整', line?.lineCode ?? item.forecastLineId, item.period, number(item.adjustedValue), number(original), item.reason || '计算底稿人工调整'])
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_ORANGE } }
      row.getCell(4).note = `原计算值：${original ?? '—'}`
    })
    report.riskNotes.forEach((note) => sheet.addRow(['风险提示', null, null, null, null, note]))
    ;[14, 18, 18, 16, 16, 42].forEach((width, index) => { sheet.getColumn(index + 1).width = width })
    sheet.autoFilter = `A2:F${Math.max(sheet.rowCount, 2)}`
    sheet.pageSetup.printArea = `A1:F${sheet.rowCount}`
    styleBody(sheet)
  }

  private addLineDetailSheet(workbook: ExcelJS.Workbook, report: ProjectReportDto) {
    const sheet = workbook.addWorksheet('行项目计算明细')
    title(sheet, `${report.project.name} · 行项目计算明细`, report.monthly.length + 4)
    header(sheet.addRow(['分类', '行项目编码', '行项目名称', ...report.monthly.map((item) => item.period), '合计']))
    const adjustmentByCell = new Map(report.adjustments.map((item) => [`${item.forecastLineId}:${item.period}`, item]))
    report.lineBreakdown.forEach((line) => {
      const values = new Map(line.values.map((item) => [item.period, item.value]))
      const row = sheet.addRow([
        line.category === 'revenue' ? '收入' : line.category === 'cost' ? '成本' : line.category === 'cash_inflow' ? '其他收款' : '其他付款',
        line.lineCode,
        line.lineName,
        ...report.monthly.map((item) => number(adjustmentByCell.get(`${line.lineId}:${item.period}`)?.adjustedValue ?? values.get(item.period))),
        number(line.total),
      ])
      report.monthly.forEach((item, index) => {
        const override = adjustmentByCell.get(`${line.lineId}:${item.period}`)
        const cell = row.getCell(4 + index)
        cell.numFmt = '#,##0.00;[Red](#,##0.00);-'
        if (override) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_ORANGE } }
          cell.note = `人工调整；原计算值：${values.get(item.period) ?? '—'}；说明：${override.reason || '无'}`
        }
      })
      row.getCell(row.cellCount).numFmt = '#,##0.00;[Red](#,##0.00);-'
    })
    sheet.getColumn(1).width = 12; sheet.getColumn(2).width = 16; sheet.getColumn(3).width = 28
    for (let column = 4; column <= report.monthly.length + 4; column += 1) sheet.getColumn(column).width = 13
    sheet.autoFilter = `A2:${sheet.getColumn(report.monthly.length + 4).letter}${Math.max(sheet.rowCount, 2)}`
    sheet.pageSetup.printArea = `A1:${sheet.getColumn(report.monthly.length + 4).letter}${sheet.rowCount}`
    styleBody(sheet)
    sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 2, showGridLines: false }]
  }

  private addCashTraceSheet(workbook: ExcelJS.Workbook, report: ProjectReportDto) {
    const sheet = workbook.addWorksheet('收付款追溯')
    title(sheet, `${report.project.name} · 收付款追溯`, 9)
    header(sheet.addRow(['来源行编码', '来源行名称', '业务期间', '未税金额', '税额', '含税金额', '规则', '结算期间', '实收实付']))
    report.cashSchedule.forEach((item) => sheet.addRow([
      item.sourceLineCode, item.sourceLineName, item.sourcePeriod,
      number(item.netValue), number(item.taxValue), number(item.grossValue),
      item.ruleMethod === 'immediate' ? '当月收付' : item.ruleMethod === 'delayed' ? '延后收付' : item.ruleMethod === 'installment' ? '分期收付' : item.ruleMethod === 'manual_monthly' ? '逐月指定' : '不生成现金',
      item.settlementPeriod, number(item.value),
    ]))
    ;[16, 26, 12, 15, 15, 15, 14, 12, 15].forEach((width, index) => { sheet.getColumn(index + 1).width = width })
    for (let column = 4; column <= 6; column += 1) sheet.getColumn(column).numFmt = '#,##0.00;[Red](#,##0.00);-'
    sheet.getColumn(9).numFmt = '#,##0.00;[Red](#,##0.00);-'
    sheet.autoFilter = `A2:I${Math.max(sheet.rowCount, 2)}`
    sheet.pageSetup.printArea = `A1:I${sheet.rowCount}`
    styleBody(sheet)
  }

  private addMetricSheet(workbook: ExcelJS.Workbook, report: ProjectReportDto) {
    const sheet = workbook.addWorksheet('指标和公式说明')
    title(sheet, '指标、公式和数据来源说明', 7)
    header(sheet.addRow(['指标编码', '指标名称', '类型', '分类', '表达式', '期间汇总', '说明']))
    report.metricDefinitions.forEach((metric) => sheet.addRow([
      metric.code, metric.name, metric.metricType === 'base' ? '基础指标' : '系统计算',
      metric.category === 'profit' ? '损益' : '现金流', metric.expression ?? '基础事实写入',
      metric.periodAggregation === 'sum' ? '期间求和' : metric.periodAggregation === 'ending' ? '期末值' : '重新计算',
      metric.description,
    ]))
    ;[20, 16, 14, 12, 30, 14, 45].forEach((width, index) => { sheet.getColumn(index + 1).width = width })
    sheet.getColumn(7).alignment = { wrapText: true, vertical: 'top' }
    sheet.autoFilter = `A2:G${Math.max(sheet.rowCount, 2)}`
    sheet.pageSetup.printArea = `A1:G${sheet.rowCount}`
    styleBody(sheet)
  }
}
