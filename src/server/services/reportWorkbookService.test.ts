import ExcelJS from 'exceljs'
import Decimal from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeSqliteDatabase } from '../../app/storage/sqlite/initialize'
import { NodeSqliteClient } from '../../app/test/nodeSqliteClient'
import { ProjectWorkspaceService } from '../projectWorkspaceService'
import { ReferenceDatasetService } from './referenceDatasetService'
import { ReportWorkbookService } from './reportWorkbookService'

let database: NodeSqliteClient

beforeEach(async () => {
  database = await NodeSqliteClient.create()
  await initializeSqliteDatabase(database)
  await new ReferenceDatasetService(database).initialize()
})

afterEach(async () => {
  await database.close()
})

describe('统一 Excel 报告', () => {
  it('使用统一报告模型生成 V3.1 两张工作表', async () => {
    const report = await new ProjectWorkspaceService(database).buildReport(
      'project-hebei-cable-iptv',
    )
    const bytes = await new ReportWorkbookService().build(report)
    expect(bytes.subarray(0, 2).toString()).toBe('PK')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['测算报告', '月度明细'])
    const reportSheet = workbook.getWorksheet('测算报告')
    const monthlySheet = workbook.getWorksheet('月度明细')
    expect(reportSheet?.getCell('A1').value).toContain(report.project.name)
    expect(reportSheet?.getCell('B6').value).toMatchObject({ formula: expect.any(String) })
    expect(reportSheet?.getCell('E6').numFmt).toContain('0.00%')
    expect(reportSheet?.getCell('G10').font.color).toEqual({ argb: 'FF0000FF' })
    expect(monthlySheet?.getCell('A4').value).toBe('指标 / 测算项')
    expect(monthlySheet?.getCell('B5').value).toEqual(expect.any(Number))
    const monthlyLabels = monthlySheet?.getColumn(1).values.map((value) => String(value ?? '').trim()) ?? []
    expect(monthlyLabels).toContain('项目服务费')
    expect(monthlyLabels).toContain('技术成本')
    expect(monthlySheet?.views[0]).toMatchObject({
      state: 'frozen',
      xSplit: 1,
      ySplit: 4,
      showGridLines: false,
    })
  })

  it('按报告当前选择导出含税元口径', async () => {
    const report = await new ProjectWorkspaceService(database).buildReport(
      'project-hebei-cable-iptv',
    )
    const firstRevenue = report.presentation.lineResults.find((item) => item.category === 'revenue')
    expect(firstRevenue).toBeTruthy()
    if (!firstRevenue) return
    firstRevenue.amountBasis = 'tax_exclusive'
    firstRevenue.taxRate = '0.06'
    firstRevenue.grossTotal = new Decimal(firstRevenue.netTotal).times('1.06').toString()

    const bytes = await new ReportWorkbookService().build(report, {
      taxBasis: 'tax_inclusive',
      displayUnit: 'yuan',
    })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer)
    const reportSheet = workbook.getWorksheet('测算报告')
    const monthlySheet = workbook.getWorksheet('月度明细')
    expect(reportSheet?.getCell('A2').value).toContain('含税口径 · 单位：元')
    expect(monthlySheet?.getCell('A2').value).toContain('含税口径 · 单位：元')
    expect(reportSheet?.getCell('B6').value).toMatchObject({
      formula: expect.stringContaining('I'),
      result: expect.any(Number),
    })
    const firstMonthNet = new Decimal(firstRevenue.monthly[0]?.value ?? 0)
    const revenueRow = monthlySheet?.getColumn(1).values.findIndex((value) => value === `    ${firstRevenue.name}`) ?? -1
    expect(revenueRow).toBeGreaterThan(0)
    expect(monthlySheet?.getCell(revenueRow, 2).value).toBeCloseTo(firstMonthNet.times('1.06').toNumber(), 6)
  })
})
