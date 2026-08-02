import Decimal from 'decimal.js'
import { useEffect, useMemo, useRef, useState } from 'react'

export interface FinancialGridRow {
  id: string
  label: string
  secondary?: string
  editable: boolean
  values: Record<string, string>
  overriddenPeriods?: Set<string>
  originalValues?: Record<string, string>
}

export interface FinancialGridChange {
  rowId: string
  period: string
  value: string
}

interface CellPosition { row: number; column: number }
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
  includeHeadersOnCopy?: boolean
  ariaLabel: string
}

export function parseFinancialValue(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const negative = /^\(.*\)$/.test(trimmed)
  const normalized = trimmed
    .replace(/[，,\s]/g, '')
    .replace(/^\((.*)\)$/, '$1')
  const decimal = new Decimal(normalized)
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
      if (!row.editable) throw new Error(`行“${row.label}”为只读，整个粘贴已取消`)
      const value = parseFinancialValue(raw)
      before.push({ rowId: row.id, period, value: row.values[period] ?? '' })
      after.push({ rowId: row.id, period, value })
    })
  })
  return { before, after }
}

export function financialSelectionBounds(anchor: CellPosition, focus: CellPosition) {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column),
  }
}

export function FinancialGrid({
  periods,
  rows,
  onChange,
  onClearOverride,
  includeHeadersOnCopy = false,
  ariaLabel,
}: Props) {
  const root = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [anchor, setAnchor] = useState<CellPosition>({ row: 0, column: 0 })
  const [focus, setFocus] = useState<CellPosition>({ row: 0, column: 0 })
  const [editing, setEditing] = useState<(CellPosition & { value: string }) | null>(null)
  const [displayUnit, setDisplayUnit] = useState<FinancialDisplayUnit>('yuan')
  const [decimalPlaces, setDecimalPlaces] = useState<0 | 2 | 4>(2)
  const [thousandSeparator, setThousandSeparator] = useState(true)
  const [negativeStyle, setNegativeStyle] = useState<FinancialNegativeStyle>('minus')
  const undoStack = useRef<EditTransaction[]>([])
  const redoStack = useRef<EditTransaction[]>([])
  const selected = useMemo(
    () => financialSelectionBounds(anchor, focus),
    [anchor, focus],
  )
  const displayOptions = useMemo<FinancialDisplayOptions>(() => ({
    decimalPlaces,
    negativeStyle,
    thousandSeparator,
    unit: displayUnit,
  }), [decimalPlaces, displayUnit, negativeStyle, thousandSeparator])

  useEffect(() => {
    const finishDrag = () => { dragging.current = false }
    window.addEventListener('mouseup', finishDrag)
    return () => window.removeEventListener('mouseup', finishDrag)
  }, [])

  useEffect(() => {
    if (rows.length === 0 || periods.length === 0) return
    setAnchor((current) => ({
      row: Math.min(current.row, rows.length - 1),
      column: Math.min(current.column, periods.length - 1),
    }))
    setFocus((current) => ({
      row: Math.min(current.row, rows.length - 1),
      column: Math.min(current.column, periods.length - 1),
    }))
  }, [periods.length, rows.length])

  function focusCell(position: CellPosition, extend = false) {
    const next = {
      row: Math.max(0, Math.min(rows.length - 1, position.row)),
      column: Math.max(0, Math.min(periods.length - 1, position.column)),
    }
    if (!extend) setAnchor(next)
    setFocus(next)
    requestAnimationFrame(() => {
      root.current
        ?.querySelector<HTMLElement>(`[data-cell="${next.row}:${next.column}"]`)
        ?.focus()
    })
  }

  function extendSelection(position: CellPosition) {
    setFocus({
      row: Math.max(0, Math.min(rows.length - 1, position.row)),
      column: Math.max(0, Math.min(periods.length - 1, position.column)),
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
    if (!row?.editable || !period || !onChange) return
    try {
      const value = parseFinancialValue(raw)
      applyTransaction({
        before: [{ rowId: row.id, period, value: row.values[period] ?? '' }],
        after: [{ rowId: row.id, period, value }],
      })
    } catch {
      window.alert(`“${raw}”不是有效金额，未写入。`)
    }
  }

  function selectionText() {
    const lines: string[] = []
    if (includeHeadersOnCopy) {
      lines.push(['行项目', ...periods.slice(selected.left, selected.right + 1)].join('\t'))
    }
    for (let rowIndex = selected.top; rowIndex <= selected.bottom; rowIndex += 1) {
      const row = rows[rowIndex]
      const values = periods
        .slice(selected.left, selected.right + 1)
        .map((period) => row.values[period] ?? '')
      lines.push(includeHeadersOnCopy ? [row.label, ...values].join('\t') : values.join('\t'))
    }
    return lines.join('\n')
  }

  function pasteText(text: string) {
    if (!onChange) return
    const matrix = text.replace(/\r/g, '').split('\n').filter((line) => line.length > 0).map((line) => line.split('\t'))
    if (matrix.length === 0) return
    try {
      applyTransaction(buildPasteTransaction(text, focus, rows, periods))
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : '粘贴内容无效')
      return
    }
    focusCell({
      row: focus.row + matrix.length - 1,
      column: focus.column + Math.max(...matrix.map((line) => line.length)) - 1,
    }, true)
  }

  function clearSelection() {
    const before: FinancialGridChange[] = []
    const after: FinancialGridChange[] = []
    for (let rowIndex = selected.top; rowIndex <= selected.bottom; rowIndex += 1) {
      const row = rows[rowIndex]
      if (!row.editable) {
        window.alert(`行“${row.label}”为只读，整个清空操作已取消`)
        return
      }
      for (let columnIndex = selected.left; columnIndex <= selected.right; columnIndex += 1) {
        const period = periods[columnIndex]
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
    if (!onChange) return
    const before: FinancialGridChange[] = []
    const after: FinancialGridChange[] = []
    const selectionRows = rows.slice(selected.top, selected.bottom + 1)
    if (selectionRows.some((row) => !row.editable)) {
      window.alert('选区包含只读行，整个填充操作已取消')
      return
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
    const activeRow = rows[focus.row]
    if (!command && activeRow?.editable && (event.key === 'F2' || (event.key.length === 1 && !event.altKey))) {
      event.preventDefault()
      setEditing({
        ...focus,
        value: event.key === 'F2' ? activeRow.values[periods[focus.column]] ?? '' : event.key,
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
      focusCell({ row: focus.row + delta[0], column: focus.column + delta[1] }, event.shiftKey && event.key.startsWith('Arrow'))
    }
  }

  return (
    <div className="financial-grid-shell">
      <div className="financial-grid-toolbar" aria-label={`${ariaLabel}显示格式`}>
        <b>显示格式</b>
        <label>单位<select aria-label={`${ariaLabel}显示单位`} value={displayUnit} onChange={(event) => setDisplayUnit(event.target.value as FinancialDisplayUnit)}><option value="yuan">元</option><option value="thousand">千元</option><option value="ten_thousand">万元</option></select></label>
        <label>小数<select aria-label={`${ariaLabel}小数位数`} value={decimalPlaces} onChange={(event) => setDecimalPlaces(Number(event.target.value) as 0 | 2 | 4)}><option value={0}>0 位</option><option value={2}>2 位</option><option value={4}>4 位</option></select></label>
        <label className="financial-format-check"><input aria-label={`${ariaLabel}使用千分位`} type="checkbox" checked={thousandSeparator} onChange={(event) => setThousandSeparator(event.target.checked)} />千分位</label>
        <label>负数<select aria-label={`${ariaLabel}负数格式`} value={negativeStyle} onChange={(event) => setNegativeStyle(event.target.value as FinancialNegativeStyle)}><option value="minus">-1,234.56</option><option value="parentheses">(1,234.56)</option></select></label>
        <span>拖拽或 Shift 扩展选区 · 仅调整显示，不改变计算值</span>
      </div>
      <div
        className="financial-grid"
        ref={root}
        onKeyDown={onKeyDown}
        onMouseMove={(event) => {
          if (!dragging.current || !(event.target instanceof HTMLElement)) return
          const cell = event.target.closest<HTMLElement>('[data-cell]')
          const position = cell?.dataset.cell?.split(':').map(Number)
          if (position?.length === 2) {
            extendSelection({ row: position[0], column: position[1] })
          }
        }}
        onMouseUp={() => { dragging.current = false }}
        onCopy={(event) => { event.preventDefault(); event.clipboardData.setData('text/plain', selectionText()) }}
        onPaste={(event) => { event.preventDefault(); pasteText(event.clipboardData.getData('text/plain')) }}
        aria-label={ariaLabel}
        role="grid"
        tabIndex={-1}
      >
      <table>
        <thead><tr><th className="grid-label-column" onMouseDown={() => { setAnchor({ row: 0, column: 0 }); setFocus({ row: rows.length - 1, column: periods.length - 1 }); root.current?.focus() }}>行项目</th>{periods.map((period, columnIndex) => <th key={period} onMouseDown={() => { setAnchor({ row: 0, column: columnIndex }); setFocus({ row: rows.length - 1, column: columnIndex }); root.current?.focus() }}>{period}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => (
          <tr key={row.id} className={row.editable ? 'editable-row' : 'readonly-row'}>
            <th onMouseDown={() => { setAnchor({ row: rowIndex, column: 0 }); setFocus({ row: rowIndex, column: periods.length - 1 }); root.current?.focus() }}><span>{row.label}</span>{row.secondary && <small>{row.secondary}</small>}</th>
            {periods.map((period, columnIndex) => {
              const isSelected = rowIndex >= selected.top && rowIndex <= selected.bottom && columnIndex >= selected.left && columnIndex <= selected.right
              const overridden = row.overriddenPeriods?.has(period)
              return <td
                key={period}
                data-cell={`${rowIndex}:${columnIndex}`}
                tabIndex={rowIndex === focus.row && columnIndex === focus.column ? 0 : -1}
                className={`${isSelected ? 'selected-cell' : ''} ${overridden ? 'overridden-cell' : ''}`}
                aria-selected={isSelected}
                title={overridden ? `原计算值：${row.originalValues?.[period] ?? '—'}；当前覆盖值：${row.values[period] ?? ''}` : row.editable ? '双击编辑；支持从 Excel 粘贴区域' : '只读'}
                onMouseDown={(event) => {
                  if (event.button === 0) {
                    event.preventDefault()
                    dragging.current = true
                    focusCell({ row: rowIndex, column: columnIndex }, event.shiftKey)
                  }
                }}
                onMouseEnter={() => {
                  if (dragging.current) {
                    extendSelection({ row: rowIndex, column: columnIndex })
                  }
                }}
                onMouseUp={() => { dragging.current = false }}
                onDoubleClick={() => row.editable && setEditing({ row: rowIndex, column: columnIndex, value: row.values[period] ?? '' })}
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
                ) : <span>{formatFinancialValue(row.values[period] ?? '', displayOptions)}</span>}
                {overridden && <i />}
                {overridden && onClearOverride && <button aria-label="清除覆盖" onClick={(event) => { event.stopPropagation(); onClearOverride(row.id, period) }}>×</button>}
              </td>
            })}
          </tr>
        ))}</tbody>
      </table>
      </div>
    </div>
  )
}
