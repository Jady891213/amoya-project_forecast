import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { PivotExportRequest, PivotMetadata, PivotResponse } from '../../shared/domain/types'
import { PivotWorkbookService } from './pivotWorkbookService'

describe('PivotWorkbookService', () => {
  it('导出多层合并列头并保留原始数值类型', async () => {
    const metadata: PivotMetadata = {
      scenario: { id: 'baseline', label: '基准场景' },
      dimensions: [
        { dimension: 'project', label: '项目', members: [{ id: 'project-a', label: '项目A', sortKey: 1 }] },
        { dimension: 'plan', label: '方案', members: [{ id: 'a', label: '方案A', parentId: 'project-a', sortKey: 1 }] },
        { dimension: 'department', label: '申报部门', members: [] },
        { dimension: 'period', label: '期间', members: [] },
        { dimension: 'metric', label: '指标', members: [] },
      ],
    }
    const result: PivotResponse = {
      rowTuples: [{ key: 'metric:revenue', members: [{ dimension: 'metric', memberId: 'revenue', label: '收入' }] }],
      columnTuples: [
        { key: 'a:2026', members: [{ dimension: 'plan', memberId: 'a', label: '方案A' }, { dimension: 'period', memberId: '2026', label: '2026年' }] },
        { key: 'a:2027', members: [{ dimension: 'plan', memberId: 'a', label: '方案A' }, { dimension: 'period', memberId: '2027', label: '2027年' }] },
      ],
      cells: [
        { rowKey: 'metric:revenue', columnKey: 'a:2026', value: '12345.67', valueType: 'currency' },
        { rowKey: 'metric:revenue', columnKey: 'a:2027', value: '23456.78', valueType: 'currency' },
      ],
      sourceFactCount: 2,
    }
    const input: PivotExportRequest = {
      request: {
        rows: [{ dimension: 'metric', memberIds: ['revenue'] }],
        columns: [{ dimension: 'plan', memberIds: ['a'] }, { dimension: 'period', memberIds: ['2026', '2027'] }],
        pov: [{ dimension: 'project', memberId: 'project-a' }, { dimension: 'department', memberId: '__all_departments__' }],
        periodLevel: 'year', scenarioId: 'baseline',
      },
      hideNoDataRows: false,
    }
    const bytes = await new PivotWorkbookService().build(metadata, result, input)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes)
    const sheet = workbook.getWorksheet('项目报表')!
    expect(sheet.getCell('B1').value).toBe('项目A（方案A）')
    expect(sheet.getCell('B3').value).toBe(12345.67)
    expect(sheet.model.merges).toContain('B1:C1')
  })
})
