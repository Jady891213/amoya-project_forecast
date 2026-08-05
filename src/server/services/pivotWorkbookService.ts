import ExcelJS from 'exceljs'
import type { PivotExportRequest, PivotMetadata, PivotResponse } from '../../shared/domain/types'
import { buildPivotHeaderRows, visiblePivotRows } from '../../shared/reporting/pivotLayout'

const FONT = 'Microsoft YaHei'
const BORDER_COLOR = 'FFD9E0EA'

function border(): Partial<ExcelJS.Borders> {
  const line = { style: 'thin' as const, color: { argb: BORDER_COLOR } }
  return { top: line, right: line, bottom: line, left: line }
}

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

export class PivotWorkbookService {
  async build(metadata: PivotMetadata, result: PivotResponse, input: PivotExportRequest): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = '项目测算'
    workbook.created = new Date()
    const sheet = workbook.addWorksheet('项目报表', { views: [{ state: 'frozen', xSplit: input.request.rows.length, ySplit: input.request.columns.length, showGridLines: false }] })
    const cells = new Map(result.cells.map((cell) => [`${cell.rowKey}\u001e${cell.columnKey}`, cell]))
    const availableRows = visiblePivotRows(
      result.rowTuples,
      result.columnTuples,
      (rowKey, columnKey) => cells.get(`${rowKey}\u001e${columnKey}`)?.value,
      input.hideNoDataRows,
    )
    const requestedRows = input.visibleRowKeys?.length
      ? new Map(input.visibleRowKeys.map((key, index) => [key, index]))
      : undefined
    const rows = requestedRows
      ? availableRows.filter((row) => requestedRows.has(row.key)).sort((left, right) => (requestedRows.get(left.key) ?? 0) - (requestedRows.get(right.key) ?? 0))
      : availableRows
    const rowAxisCount = input.request.rows.length
    const columnAxisCount = input.request.columns.length
    const columnHeaders = buildPivotHeaderRows(result.columnTuples, columnAxisCount)
    const rowHeaders = buildPivotHeaderRows(rows, rowAxisCount)

    input.request.rows.forEach((axis, index) => {
      const cell = sheet.getCell(1, index + 1)
      cell.value = metadata.dimensions.find((item) => item.dimension === axis.dimension)?.label ?? axis.dimension
      if (columnAxisCount > 1) sheet.mergeCells(1, index + 1, columnAxisCount, index + 1)
    })
    columnHeaders.forEach((headerRow, level) => {
      headerRow.forEach((header) => {
        const startColumn = rowAxisCount + header.tupleIndex + 1
        const endColumn = startColumn + header.span - 1
        const cell = sheet.getCell(level + 1, startColumn)
        cell.value = header.label
        if (endColumn > startColumn) sheet.mergeCells(level + 1, startColumn, level + 1, endColumn)
      })
    })
    rowHeaders.forEach((headerColumn, level) => {
      headerColumn.forEach((header) => {
        const startRow = columnAxisCount + header.tupleIndex + 1
        const endRow = startRow + header.span - 1
        const cell = sheet.getCell(startRow, level + 1)
        cell.value = header.label
        if (endRow > startRow) sheet.mergeCells(startRow, level + 1, endRow, level + 1)
      })
    })

    rows.forEach((row, rowIndex) => {
      result.columnTuples.forEach((column, columnIndex) => {
        const source = cells.get(`${row.key}\u001e${column.key}`)
        const target = sheet.getCell(columnAxisCount + rowIndex + 1, rowAxisCount + columnIndex + 1)
        if (!source?.value) return
        target.value = Number(source.value)
        target.numFmt = source.valueType === 'percentage'
          ? '0.00%'
          : '#,##0.######;[Red](#,##0.######)'
      })
    })

    const lastRow = Math.max(columnAxisCount, columnAxisCount + rows.length)
    const lastColumn = Math.max(rowAxisCount, rowAxisCount + result.columnTuples.length)
    for (let row = 1; row <= lastRow; row += 1) {
      for (let column = 1; column <= lastColumn; column += 1) {
        const cell = sheet.getCell(row, column)
        cell.border = border()
        cell.font = { name: FONT, size: 10, bold: row <= columnAxisCount, color: { argb: 'FF344054' } }
        cell.alignment = { vertical: 'middle', horizontal: row <= columnAxisCount ? 'center' : column <= rowAxisCount ? 'left' : 'right' }
        if (row <= columnAxisCount) cell.fill = fill('FFEEF2F8')
        else if (column <= rowAxisCount) cell.fill = fill('FFF8F9FC')
      }
    }
    for (let column = 1; column <= rowAxisCount; column += 1) sheet.getColumn(column).width = 24
    for (let column = rowAxisCount + 1; column <= lastColumn; column += 1) sheet.getColumn(column).width = 14
    for (let row = 1; row <= columnAxisCount; row += 1) sheet.getRow(row).height = 24
    sheet.autoFilter = undefined
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    return Buffer.from(await workbook.xlsx.writeBuffer())
  }
}
