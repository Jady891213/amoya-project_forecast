import Decimal from 'decimal.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAppDialog } from '../ui/AppDialog'
import {
  gridSelectionBounds,
  gridSelectionText,
  useGridSelection,
  type GridCellPosition,
} from './useGridSelection'

export interface FinancialGridRow {
  id: string
  label: string
  secondary?: string
  rowClassName?: string
  editable: boolean
  editablePeriods?: Set<string>
  valueKind?: 'number' | 'percentage'
  values: Record<string, string>
  overriddenPeriods?: Set<string>
  originalValues?: Record<string, string>
}

export function isFinancialCellEditable(row: FinancialGridRow, period: string): boolean {
  return row.editable && (!row.editablePeriods || row.editablePeriods.has(period))
}

export interface FinancialGridChange {
  rowId: string
  period: string
  value: string
}

interface EditTransaction { before: FinancialGridChange[]; after: FinancialGridChange[] }
export type FinancialDisplayUnit = 'yuan' | 'thousand' | 'ten_thousand'
export type FinancialNegativeStyle = 'minus' | 'parentheses'

export interface FinancialDisplayOptions {
  decimalPlaces: 0 | 2 | 4
  negativeStyle: FinancialNegativeStyle
  thousandSeparator: boolean
  unit: FinancialDisplayUnit
}

interface Props {
  periods: string[]
  rows: FinancialGridRow[]
  onChange?: (changes: FinancialGridChange[]) => void
  onClearOverride?: (rowId: string, period: string) => void
  ariaLabel: string
  labelColumnTitle?: string
  labelColumnWidth?: number
  typeColumnTitle?: string
  typeColumnWidth?: number
  renderRowType?: (row: FinancialGridRow) => ReactNode
  renderRowLabel?: (row: FinancialGridRow) => ReactNode
  showToolbar?: boolean
  onRowActivate?: (rowId: string) => void
  activeRowId?: string
  toolbarPlacement?: 'top' | 'bottom'
}

export function parseFinancialValue(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const negative = /^\(.*\)$/.test(trimmed)
  const normalized = trimmed
    .replace(/[，,\s]/g, '')
    .replace(/^\((.*)\)$/, '$1')
  let decimal: Decimal
  try {
    decimal = new Decimal(normalized)
  } catch {
    throw new Error(`“${raw}”不是有效数字`)
  }
  if (!decimal.isFinite()) throw new Error('数值无效')
  return (negative ? decimal.negated() : decimal).toDecimalPlaces(6).toString()
}

export function formatFinancialValue(
  raw: string,
  options: FinancialDisplayOptions,
): string {
  if (raw === '') return ''
  try {
    const divisor = options.unit === 'ten_thousand'
      ? 10_000
      : options.unit === 'thousand'
        ? 1_000
        : 1
    const value = new Decimal(raw).div(divisor)
    const absolute = value.abs().toFixed(options.decimalPlaces)
    const formatted = options.thousandSeparator
      ? absolute.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      : absolute
    if (!value.isNegative()) return formatted
    return options.negativeStyle === 'parentheses'
      ? `(${formatted})`
      : `-${formatted}`
  } catch {
    return raw
  }
}

function formatGridCellValue(raw: string, row: FinancialGridRow, options: FinancialDisplayOptions): string {
  if (row.valueKind !== 'percentage' || raw === '') return formatFinancialValue(raw, options)
  try {
    return `${new Decimal(raw).times(100).toFixed(options.decimalPlaces)}%`
  } catch {
    return raw
  }
}

export function buildPasteTransaction(
  text: string,
  focus: { row: number; column: number },
  rows: FinancialGridRow[],
  periods: string[],
): EditTransaction {
  const matrix = text.replace(/\r/g, '').split('\n').filter((line) => line.length > 0).map((line) => line.split('\t'))
  const before: FinancialGridChange[] = []
  const after: FinancialGridChange[] = []
  matrix.forEach((line, rowOffset) => {
    line.forEach((raw, columnOffset) => {
      const rowIndex = focus.row + rowOffset
      const columnIndex = focus.column + columnOffset
      const row = rows[rowIndex]
      const period = periods[columnIndex]
      if (!row || !period) throw new Error('粘贴区域超出表格范围')
      if (!isFinancialCellEditable(row, period)) throw new Error(`“${row.label}”在 ${period} 为只读，整个粘贴已取消`)
      const value = parseFinancialValue(raw)
      before.push({ rowId: row.id, period, value: row.values[period] ?? '' })
      after.push({ rowId: row.id, period, value })
    })
  })
  return { before, after }
}

export function financialSelectionBounds(anchor: GridCellPosition, focus: GridCellPosition) {
  return gridSelectionBounds(anchor, focus)
}

export function FinancialGrid({
  periods,
  rows,
  onChange,
  onClearOverride,
  ariaLabel,
  labelColumnTitle = '行项目',
  labelColumnWidth = 190,
  typeColumnTitle = '类型',
  typeColumnWidth = 86,
  renderRowType,
  renderRowLabel,
  showToolbar = true,
  onRowActivate,
  activeRowId,
  toolbarPlacement = 'top',
}: Props) {
  const dialog = useAppDialog()
  const root = useRef<HTMLDivElement>(null)
  const selection = useGridSelection(rows.length, periods.length)
  const [editing, setEditing] = useState<(GridCellPosition & { value: string }) | null>(null)
  const [displayUnit, setDisplayUnit] = useState<FinancialDisplayUnit>('yuan')
  const [decimalPlaces, setDecimalPlaces] = useState<0 | 2 | 4>(2)
  const [thousandSeparator, setThousandSeparator] = useState(true)
  const [negativeStyle, setNegativeStyle] = useState<FinancialNegativeStyle>('minus')
  const [currentTypeWidth, setCurrentTypeWidth] = useState(typeColumnWidth)
  const [currentLabelWidth, setCurrentLabelWidth] = useState(labelColumnWidth)
  const [periodWidths, setPeriodWidths] = useState<Record<string, number>>({})
  const resizeCleanup = useRef<(() => void) | null>(null)
  const undoStack = useRef<EditTransaction[]>([])
  const redoStack = useRef<EditTransaction[]>([])
  const displayOptions = useMemo<FinancialDisplayOptions>(() => ({
    decimalPlaces,
    negativeStyle,
    thousandSeparator,
    unit: displayUnit,
  }), [decimalPlaces, displayUnit, negativeStyle, thousandSeparator])

  useEffect(() => {
    return () => {
      resizeCleanup.current?.()
    }
  }, [])

  function startColumnResize(
    event: React.MouseEvent<HTMLElement>,
    currentWidth: number,
    minimum: number,
    maximum: number,
    onResize: (width: number) => void,
  ) {
    event.preventDefault()
    event.stopPropagation()
    resizeCleanup.current?.()
    const startX = event.clientX
    const move = (moveEvent: MouseEvent) => {
      onResize(Math.max(minimum, Math.min(maximum, currentWidth + moveEvent.clientX - startX)))
    }
    const finish = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', finish)
      resizeCleanup.current = null
      document.body.classList.remove('resizing-financial-column')
    }
    resizeCleanup.current = finish
    document.body.classList.add('resizing-financial-column')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', finish)
  }

  function focusCell(position: GridCellPosition, extend = false) {
    selection.selectCell(position, extend)
    const next = {
      row: Math.max(0, Math.min(rows.length - 1, position.row)),
      column: Math.max(0, Math.min(periods.length - 1, position.column)),
    }
    requestAnimationFrame(() => {
      root.current
        ?.querySelector<HTMLElement>(`[data-cell="${next.row}:${next.column}"]`)
        ?.focus()
    })
  }

  function applyTransaction(transaction: EditTransaction, remember = true) {
    if (!onChange || transaction.after.length === 0) return
    onChange(transaction.after)
    if (remember) {
      undoStack.current = [...undoStack.current, transaction].slice(-50)
      redoStack.current = []
    }
  }

  function editCell(rowIndex: number, columnIndex: number, raw: string) {
    const row = rows[rowIndex]
    const period = periods[columnIndex]
    if (!row || !period || !isFinancialCellEditable(row, period) || !onChange) return
    try {
      const value = parseFinancialValue(raw)
      applyTransaction({
        before: [{ rowId: row.id, period, value: row.values[period] ?? '' }],
        after: [{ rowId: row.id, period, value }],
      })
    } catch {
      void dialog.alert(`“${raw}”不是有效金额，本次修改未写入。`, { title: '金额格式不正确', tone: 'warning' })
    }
  }

  function selectionText() {
    if (!selection.bounds) return ''
    return gridSelectionText(
      selection.bounds,
      (rowIndex, columnIndex) => rows[rowIndex]?.values[periods[columnIndex]] ?? '',
    )
  }

  function pasteText(text: string) {
    if (!onChange) return
    const matrix = text.replace(/\r/g, '').split('\n').filter((line) => line.length > 0).map((line) => line.split('\t'))
    if (matrix.length === 0) return
    try {
      if (!selection.focus) return
      applyTransaction(buildPasteTransaction(text, selection.focus, rows, periods))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '粘贴内容无效'
      void dialog.alert(message.includes('整个粘贴') ? message : `${message}，整个粘贴已取消。`, { title: '无法粘贴数据', tone: 'warning' })
      return
    }
    focusCell({
      row: selection.focus.row + matrix.length - 1,
      column: selection.focus.column + Math.max(...matrix.map((line) => line.length)) - 1,
    }, true)
  }

  function clearSelection() {
    if (!selection.bounds) return
    const before: FinancialGridChange[] = []
    const after: FinancialGridChange[] = []
    for (let rowIndex = selection.bounds.top; rowIndex <= selection.bounds.bottom; rowIndex += 1) {
      const row = rows[rowIndex]
      for (let columnIndex = selection.bounds.left; columnIndex <= selection.bounds.right; columnIndex += 1) {
        const period = periods[columnIndex]
        if (!isFinancialCellEditable(row, period)) {
          void dialog.alert(`“${row.label}”在 ${period} 为只读，整个清空操作已取消。`, { title: '无法清空选区', tone: 'warning' })
          return
        }
        before.push({ rowId: row.id, period, value: row.values[period] ?? '' })
        after.push({ rowId: row.id, period, value: '' })
      }
    }
    applyTransaction({ before, after })
  }

  function undo() {
    const transaction = undoStack.current.pop()
    if (!transaction || !onChange) return
    onChange(transaction.before)
    redoStack.current.push(transaction)
  }

  function redo() {
    const transaction = redoStack.current.pop()
    if (!transaction || !onChange) return
    onChange(transaction.after)
    undoStack.current.push(transaction)
  }

  function fillSelection(direction: 'down' | 'right') {
    if (!onChange || !selection.bounds) return
    const selected = selection.bounds
    const before: FinancialGridChange[] = []
    const after: FinancialGridChange[] = []
    for (let rowIndex = selected.top; rowIndex <= selected.bottom; rowIndex += 1) {
      for (let columnIndex = selected.left; columnIndex <= selected.right; columnIndex += 1) {
        if (!isFinancialCellEditable(rows[rowIndex], periods[columnIndex])) {
          void dialog.alert('选区包含只读单元格，整个填充操作已取消。', { title: '无法填充选区', tone: 'warning' })
          return
        }
      }
    }
    if (direction === 'down') {
      for (let column = selected.left; column <= selected.right; column += 1) {
        const period = periods[column]
        const source = rows[selected.top].values[period] ?? ''
        for (let row = selected.top + 1; row <= selected.bottom; row += 1) {
          before.push({ rowId: rows[row].id, period, value: rows[row].values[period] ?? '' })
          after.push({ rowId: rows[row].id, period, value: source })
        }
      }
    } else {
      for (let row = selected.top; row <= selected.bottom; row += 1) {
        const sourcePeriod = periods[selected.left]
        const source = rows[row].values[sourcePeriod] ?? ''
        for (let column = selected.left + 1; column <= selected.right; column += 1) {
          const period = periods[column]
          before.push({ rowId: rows[row].id, period, value: rows[row].values[period] ?? '' })
          after.push({ rowId: rows[row].id, period, value: source })
        }
      }
    }
    applyTransaction({ before, after })
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!selection.focus) return
    const command = event.ctrlKey || event.metaKey
    if (command && event.key.toLowerCase() === 'c') {
      return
    }
    if (command && event.key.toLowerCase() === 'v') {
      return
    }
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.shiftKey ? redo() : undo(); return
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault(); redo(); return
    }
    if (command && event.key.toLowerCase() === 'd') {
      event.preventDefault(); fillSelection('down'); return
    }
    if (command && event.key.toLowerCase() === 'r') {
      event.preventDefault(); fillSelection('right'); return
    }
    const activeRow = rows[selection.focus.row]
    const activePeriod = periods[selection.focus.column]
    if (!command && activeRow && activePeriod && isFinancialCellEditable(activeRow, activePeriod) && (event.key === 'F2' || (event.key.length === 1 && !event.altKey))) {
      event.preventDefault()
      setEditing({
        ...selection.focus,
        value: event.key === 'F2' ? activeRow.values[periods[selection.focus.column]] ?? '' : event.key,
      })
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); clearSelection(); return
    }
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      Tab: [0, event.shiftKey ? -1 : 1], Enter: [event.shiftKey ? -1 : 1, 0],
    }
    const delta = deltas[event.key]
    if (delta) {
      event.preventDefault()
      focusCell({ row: selection.focus.row + delta[0], column: selection.focus.column + delta[1] }, event.shiftKey && event.key.startsWith('Arrow'))
    }
  }

  const toolbar = showToolbar && <div className={`financial-grid-toolbar ${toolbarPlacement}`} aria-label={`${ariaLabel}显示格式`}>
    {toolbarPlacement === 'bottom' && <span>拖拽或 Shift 扩展选区 · 仅调整显示，不改变计算值</span>}
    <b>显示格式</b>
    <label>单位<select aria-label={`${ariaLabel}显示单位`} value={displayUnit} onChange={(event) => setDisplayUnit(event.target.value as FinancialDisplayUnit)}><option value="yuan">元</option><option value="thousand">千元</option><option value="ten_thousand">万元</option></select></label>
    <label>小数<select aria-label={`${ariaLabel}小数位数`} value={decimalPlaces} onChange={(event) => setDecimalPlaces(Number(event.target.value) as 0 | 2 | 4)}><option value={0}>0 位</option><option value={2}>2 位</option><option value={4}>4 位</option></select></label>
    <label className="financial-format-check"><input aria-label={`${ariaLabel}使用千分位`} type="checkbox" checked={thousandSeparator} onChange={(event) => setThousandSeparator(event.target.checked)} />千分位</label>
    <label>负数<select aria-label={`${ariaLabel}负数格式`} value={negativeStyle} onChange={(event) => setNegativeStyle(event.target.value as FinancialNegativeStyle)}><option value="minus">-1,234.56</option><option value="parentheses">(1,234.56)</option></select></label>
    {toolbarPlacement === 'top' && <span>拖拽或 Shift 扩展选区 · 仅调整显示，不改变计算值</span>}
  </div>

  return (
    <div className="financial-grid-shell">
      {toolbarPlacement === 'top' && toolbar}
      <div
        className={`financial-grid ${showToolbar && toolbarPlacement === 'bottom' ? 'with-bottom-toolbar' : ''}`}
        ref={root}
        onKeyDown={onKeyDown}
        onMouseMove={(event) => {
          if (!selection.dragging.current || !(event.target instanceof HTMLElement)) return
          const cell = event.target.closest<HTMLElement>('[data-cell]')
          const position = cell?.dataset.cell?.split(':').map(Number)
          if (position?.length === 2) {
            selection.extendSelection({ row: position[0], column: position[1] })
          }
        }}
        onMouseUp={selection.endDrag}
        onCopy={(event) => { event.preventDefault(); event.clipboardData.setData('text/plain', selectionText()) }}
        onPaste={(event) => { event.preventDefault(); pasteText(event.clipboardData.getData('text/plain')) }}
        aria-label={ariaLabel}
        role="grid"
        tabIndex={-1}
      >
      <table>
        <colgroup>{renderRowType && <col style={{ width: currentTypeWidth }} />}<col style={{ width: currentLabelWidth }} />{periods.map((period) => <col key={period} style={{ width: periodWidths[period] ?? 92 }} />)}</colgroup>
        <thead><tr>{renderRowType && <th className="grid-type-column" style={{ minWidth: currentTypeWidth, maxWidth: currentTypeWidth, width: currentTypeWidth }} onMouseDown={() => { selection.selectAll(); root.current?.focus() }}>{typeColumnTitle}<span className="financial-column-resizer" title="拖拽调整列宽" onMouseDown={(event) => startColumnResize(event, currentTypeWidth, 72, 160, setCurrentTypeWidth)} /></th>}<th className="grid-label-column" style={{ left: renderRowType ? currentTypeWidth : 0, minWidth: currentLabelWidth, maxWidth: currentLabelWidth, width: currentLabelWidth }} onMouseDown={() => { selection.selectAll(); root.current?.focus() }}>{labelColumnTitle}<span className="financial-column-resizer" title="拖拽调整列宽" onMouseDown={(event) => startColumnResize(event, currentLabelWidth, 220, 560, setCurrentLabelWidth)} /></th>{periods.map((period, columnIndex) => { const periodWidth = periodWidths[period] ?? 92; return <th key={period} style={{ minWidth: periodWidth, maxWidth: periodWidth, width: periodWidth }} onMouseDown={() => { selection.selectColumns(columnIndex); root.current?.focus() }}>{period}<span className="financial-column-resizer" title="拖拽调整列宽" onMouseDown={(event) => startColumnResize(event, periodWidth, 72, 180, (width) => setPeriodWidths((current) => ({ ...current, [period]: width })))} /></th> })}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => (
          <tr key={row.id} className={`${row.editable ? 'editable-row' : 'readonly-row'} ${row.rowClassName ?? ''} ${activeRowId === row.id ? 'active-grid-row' : ''}`}>
            {renderRowType && <th className="grid-type-cell" style={{ minWidth: currentTypeWidth, maxWidth: currentTypeWidth, width: currentTypeWidth }} onMouseDown={() => { selection.selectRows(rowIndex); root.current?.focus(); onRowActivate?.(row.id) }}>{renderRowType(row)}</th>}
            <th className="grid-label-cell" style={{ left: renderRowType ? currentTypeWidth : 0, minWidth: currentLabelWidth, maxWidth: currentLabelWidth, width: currentLabelWidth }} onMouseDown={() => { selection.selectRows(rowIndex); root.current?.focus(); onRowActivate?.(row.id) }}>{renderRowLabel ? renderRowLabel(row) : <><span>{row.label}</span>{row.secondary && <small>{row.secondary}</small>}</>}</th>
            {periods.map((period, columnIndex) => {
              const isSelected = selection.isSelected(rowIndex, columnIndex)
              const overridden = row.overriddenPeriods?.has(period)
              const cellEditable = isFinancialCellEditable(row, period)
              return <td
                key={period}
                style={{ minWidth: periodWidths[period] ?? 92, maxWidth: periodWidths[period] ?? 92, width: periodWidths[period] ?? 92 }}
                data-cell={`${rowIndex}:${columnIndex}`}
                tabIndex={rowIndex === selection.focus?.row && columnIndex === selection.focus?.column ? 0 : -1}
                className={`${cellEditable ? 'editable-cell' : 'readonly-cell'} ${isSelected ? 'selected-cell grid-selected-cell' : ''} ${overridden ? 'overridden-cell' : ''}`}
                aria-selected={isSelected}
                title={overridden ? `原计算值：${row.originalValues?.[period] ?? '—'}；当前覆盖值：${row.values[period] ?? ''}` : cellEditable ? '双击编辑；支持从 Excel 粘贴区域' : '只读'}
                onMouseDown={(event) => {
                  if (event.button === 0) {
                    event.preventDefault()
                    selection.startDrag({ row: rowIndex, column: columnIndex }, event.shiftKey)
                    requestAnimationFrame(() => {
                      root.current?.querySelector<HTMLElement>(`[data-cell="${rowIndex}:${columnIndex}"]`)?.focus()
                    })
                    onRowActivate?.(row.id)
                  }
                }}
                onMouseEnter={() => {
                  if (selection.dragging.current) {
                    selection.extendSelection({ row: rowIndex, column: columnIndex })
                  }
                }}
                onMouseUp={selection.endDrag}
                onDoubleClick={() => cellEditable && setEditing({ row: rowIndex, column: columnIndex, value: row.values[period] ?? '' })}
              >
                {editing?.row === rowIndex && editing.column === columnIndex ? (
                  <input
                    autoFocus
                    aria-label={`${row.label} ${period}`}
                    value={editing.value}
                    onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                    onBlur={() => { editCell(rowIndex, columnIndex, editing.value); setEditing(null) }}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === 'Enter') { editCell(rowIndex, columnIndex, editing.value); setEditing(null) }
                      if (event.key === 'Escape') setEditing(null)
                    }}
                  />
                ) : <span>{formatGridCellValue(row.values[period] ?? '', row, displayOptions)}</span>}
                {overridden && <i />}
                {overridden && onClearOverride && <button aria-label="清除覆盖" onClick={(event) => { event.stopPropagation(); onClearOverride(row.id, period) }}>×</button>}
              </td>
            })}
          </tr>
        ))}</tbody>
      </table>
      </div>
      {toolbarPlacement === 'bottom' && toolbar}
    </div>
  )
}
