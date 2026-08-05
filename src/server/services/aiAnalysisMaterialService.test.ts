import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeSqliteDatabase } from '../../app/storage/sqlite/initialize'
import { NodeSqliteClient } from '../../app/test/nodeSqliteClient'
import { ProjectWorkspaceService } from '../projectWorkspaceService'
import { ReferenceDatasetService } from './referenceDatasetService'
import { AiAnalysisMaterialService } from './aiAnalysisMaterialService'

let database: NodeSqliteClient

beforeEach(async () => {
  database = await NodeSqliteClient.create()
  await initializeSqliteDatabase(database)
  await new ReferenceDatasetService(database).initialize()
})

afterEach(async () => {
  await database.close()
})

function workbookText(workbook: ExcelJS.Workbook): string {
  const values: string[] = [
    workbook.creator,
    workbook.company,
    workbook.title,
    workbook.subject,
    workbook.keywords,
  ].filter((value): value is string => Boolean(value))
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === 'object' && cell.value && 'formula' in cell.value) {
        values.push(String(cell.value.formula), String(cell.value.result ?? ''))
      } else {
        values.push(String(cell.value ?? ''))
      }
    }))
  })
  return values.join('\n')
}

describe('AI 分析素材', () => {
  it('提供固定提示词并按结果状态控制下载', async () => {
    const report = await new ProjectWorkspaceService(database).buildReport('project-hebei-cable-iptv')
    const service = new AiAnalysisMaterialService()
    const ready = service.preview(report)
    expect(ready.status).toBe('ready')
    expect(ready.prompt).toContain('总体结论')
    expect(ready.prompt).toContain('请勿尝试反推项目主体')
    expect(ready.dataSourceName).toMatch(/^AI分析脱敏数据_项目A_方案A_\d{8}\.xlsx$/)

    expect(service.preview({ ...report, isBehindDraft: true }).status).toBe('stale')
    expect(service.preview({ ...report, hasFacts: false, calculationState: undefined }).status).toBe('not_calculated')
    await expect(service.buildWorkbook({ ...report, isBehindDraft: true })).rejects.toThrow('重新计算')
  })

  it('生成只含两张工作表且不含身份信息的完整财务数据', async () => {
    const report = await new ProjectWorkspaceService(database).buildReport('project-chongqing-mobile-screen')
    const service = new AiAnalysisMaterialService()
    const bytes = await service.buildWorkbook(report)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['测算报告', '月度明细'])
    expect(workbook.creator).toBe('AI 分析素材')
    expect(workbook.company).toBeFalsy()
    const text = workbookText(workbook)
    const sensitive = [
      report.project.name,
      report.project.code,
      report.department?.name,
      report.plan.name,
      ...report.presentation.lineResults.flatMap((item) => [item.code, item.name]),
      ...report.presentation.parameterResults.flatMap((item) => [item.code, item.name, item.description]),
      '/Users/',
      '源表',
    ].filter((value): value is string => Boolean(value))
    sensitive.forEach((value) => expect(text).not.toContain(value))
    expect(text).toContain('项目 A')
    expect(text).toContain('方案 A')
    expect(text).toContain('收入项 01')
    expect(text).toContain('参数 01')
    expect(text).toContain('现金流入')
    expect(text).toContain('累计现金流')

    const reportSheet = workbook.getWorksheet('测算报告')
    const revenueCell = reportSheet?.getCell('B6').value
    expect(revenueCell).toMatchObject({ result: Number(report.summary.revenue) / 10_000 })
    const monthlySheet = workbook.getWorksheet('月度明细')
    expect(monthlySheet?.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 4 })
  })
})
