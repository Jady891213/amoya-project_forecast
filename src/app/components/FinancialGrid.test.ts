import { describe, expect, it } from 'vitest'
import {
  buildPasteTransaction,
  financialSelectionBounds,
  formatFinancialValue,
  parseFinancialValue,
} from './FinancialGrid'

describe('FinancialGrid 数值解析', () => {
  it('支持千分位、括号负数和空值', () => {
    expect(parseFinancialValue('1,234.50')).toBe('1234.5')
    expect(parseFinancialValue('(2,000)')).toBe('-2000')
    expect(parseFinancialValue('')).toBe('')
  })

  it('拒绝非数值内容', () => {
    expect(() => parseFinancialValue('abc')).toThrow('“abc”不是有效数字')
  })

  it('默认财务格式支持两位小数、千分位、单位与括号负数', () => {
    expect(formatFinancialValue('188679.245283', {
      decimalPlaces: 2,
      negativeStyle: 'minus',
      thousandSeparator: true,
      unit: 'yuan',
    })).toBe('188,679.25')
    expect(formatFinancialValue('-11498450.695875', {
      decimalPlaces: 2,
      negativeStyle: 'parentheses',
      thousandSeparator: true,
      unit: 'ten_thousand',
    })).toBe('(1,149.85)')
  })

  it('矩形选区不受拖拽方向影响', () => {
    expect(financialSelectionBounds(
      { row: 3, column: 4 },
      { row: 1, column: 2 },
    )).toEqual({ top: 1, bottom: 3, left: 2, right: 4 })
  })

  it('批量粘贴先完整校验，只读行或非法值会取消整个区域', () => {
    const periods = ['2026-01', '2026-02']
    const rows = [
      { id: 'editable', label: '收入', editable: true, values: { '2026-01': '1', '2026-02': '2' } },
      { id: 'readonly', label: '毛利', editable: false, values: { '2026-01': '3', '2026-02': '4' } },
    ]
    expect(() => buildPasteTransaction('10\t20\n30\t40', { row: 0, column: 0 }, rows, periods))
      .toThrow('整个粘贴已取消')
    expect(() => buildPasteTransaction('10\tabc', { row: 0, column: 0 }, rows, periods))
      .toThrow('“abc”不是有效数字')
    expect(buildPasteTransaction('10\t(20)', { row: 0, column: 0 }, rows.slice(0, 1), periods).after)
      .toEqual([
        { rowId: 'editable', period: '2026-01', value: '10' },
        { rowId: 'editable', period: '2026-02', value: '-20' },
      ])
  })
})
