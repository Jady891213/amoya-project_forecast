import ExcelJS from 'exceljs'
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
  it('使用统一报告模型生成七张可核对工作表', async () => {
    const report = await new ProjectWorkspaceService(database).buildReport(
      'project-hebei-cable-iptv',
    )
    const line = report.lineBreakdown[0]
    const period = report.monthly[0].period
    const originalValue = line.values.find((item) => item.period === period)?.value ?? '0'
    report.overrides = [{
      id: 'override-test',
      projectId: report.project.id,
      versionId: report.version.id,
      forecastLineId: line.lineId,
      period,
      originalValue,
      overrideValue: '70000',
      reason: '测试人工覆盖',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }]
    const bytes = await new ReportWorkbookService().build(report)
    expect(bytes.subarray(0, 2).toString()).toBe('PK')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      '项目信息',
      '测算假设',
      '分月损益',
      '分月现金流',
      '行项目计算明细',
      '收付款追溯',
      '指标和公式说明',
    ])
    expect(workbook.getWorksheet('项目信息')?.getCell('B2').value).toBe(
      report.projectSnapshot.code,
    )
    expect(workbook.getWorksheet('分月损益')?.getCell('A3').value).toBe('收入')
    expect(workbook.getWorksheet('分月现金流')?.getCell('A2').value).toContain(
      '源项目未提供现金计划',
    )
    expect(workbook.getWorksheet('指标和公式说明')?.rowCount).toBeGreaterThan(4)
    const overrideRow = workbook.getWorksheet('测算假设')?.getColumn(1).values
      .findIndex((value) => value === '人工覆盖') ?? -1
    expect(overrideRow).toBeGreaterThan(0)
    expect(workbook.getWorksheet('测算假设')?.getCell(overrideRow, 4).fill)
      .toMatchObject({ fgColor: { argb: 'FFFFEAD0' } })
    expect(workbook.getWorksheet('测算假设')?.getCell(overrideRow, 4).note)
      .toContain('原计算值')
    expect(workbook.getWorksheet('分月损益')?.views[0]).toMatchObject({
      state: 'frozen',
      xSplit: 1,
      ySplit: 2,
      showGridLines: false,
    })
  })
})
