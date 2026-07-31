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

function bounds(anchor: CellPosition, focus: CellPosition) {
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
  const [anchor, setAnchor] = useState<CellPosition>({ row: 0, column: 0 })
  const [focus, setFocus] = useState<CellPosition>({ row: 0, column: 0 })
  const [editing, setEditing] = useState<(CellPosition & { value: string }) | null>(null)
  const undoStack = useRef<EditTransaction[]>([])
  const redoStack = useRef<EditTransaction[]>([])
  const selected = useMemo(() => bounds(anchor, focus), [anchor, focus])

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
    <div
      className="financial-grid"
      ref={root}
      onKeyDown={onKeyDown}
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
                title={overridden ? `原计算值：${row.originalValues?.[period] ?? '—'}；当前覆盖值：${row.values[period] ?? ''}` : row.editable ? '双击编辑；支持从 Excel 粘贴区域' : '只读'}
                onMouseDown={(event) => {
                  if (event.detail === 1) {
                    focusCell({ row: rowIndex, column: columnIndex }, event.shiftKey)
                  }
                }}
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
                ) : <span>{row.values[period] ?? ''}</span>}
                {overridden && <i />}
                {overridden && onClearOverride && <button aria-label="清除覆盖" onClick={(event) => { event.stopPropagation(); onClearOverride(row.id, period) }}>×</button>}
              </td>
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}
