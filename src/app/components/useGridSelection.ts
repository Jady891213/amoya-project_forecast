import { useEffect, useMemo, useRef, useState } from 'react'

export interface GridCellPosition {
  row: number
  column: number
}

export interface GridSelectionBounds {
  top: number
  bottom: number
  left: number
  right: number
}

interface GridSelectionOptions {
  initialSelection?: boolean
}

export function gridSelectionBounds(
  anchor: GridCellPosition,
  focus: GridCellPosition,
): GridSelectionBounds {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column),
  }
}

export function gridSelectionText(
  bounds: GridSelectionBounds,
  valueAt: (row: number, column: number) => string,
): string {
  const lines: string[] = []
  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    const values: string[] = []
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      values.push(valueAt(row, column))
    }
    lines.push(values.join('\t'))
  }
  return lines.join('\n')
}

export function useGridSelection(
  rowCount: number,
  columnCount: number,
  { initialSelection = true }: GridSelectionOptions = {},
) {
  const initial = initialSelection && rowCount > 0 && columnCount > 0
    ? { row: 0, column: 0 }
    : undefined
  const [anchor, setAnchor] = useState<GridCellPosition | undefined>(initial)
  const [focus, setFocus] = useState<GridCellPosition | undefined>(initial)
  const dragging = useRef(false)

  const clamp = (position: GridCellPosition): GridCellPosition => ({
    row: Math.max(0, Math.min(rowCount - 1, position.row)),
    column: Math.max(0, Math.min(columnCount - 1, position.column)),
  })

  useEffect(() => {
    const finishDrag = () => { dragging.current = false }
    window.addEventListener('mouseup', finishDrag)
    return () => window.removeEventListener('mouseup', finishDrag)
  }, [])

  useEffect(() => {
    if (rowCount <= 0 || columnCount <= 0) {
      setAnchor(undefined)
      setFocus(undefined)
      dragging.current = false
      return
    }
    setAnchor((current) => current ? clamp(current) : initialSelection ? { row: 0, column: 0 } : undefined)
    setFocus((current) => current ? clamp(current) : initialSelection ? { row: 0, column: 0 } : undefined)
  }, [columnCount, initialSelection, rowCount])

  const bounds = useMemo(
    () => anchor && focus ? gridSelectionBounds(anchor, focus) : undefined,
    [anchor, focus],
  )

  function selectCell(position: GridCellPosition, extend = false) {
    if (rowCount <= 0 || columnCount <= 0) return
    const next = clamp(position)
    if (!extend || !anchor) setAnchor(next)
    setFocus(next)
  }

  function extendSelection(position: GridCellPosition) {
    if (!anchor || rowCount <= 0 || columnCount <= 0) return
    setFocus(clamp(position))
  }

  function selectRows(startRow: number, endRow = startRow) {
    if (rowCount <= 0 || columnCount <= 0) return
    setAnchor(clamp({ row: startRow, column: 0 }))
    setFocus(clamp({ row: endRow, column: columnCount - 1 }))
  }

  function selectColumns(startColumn: number, endColumn = startColumn) {
    if (rowCount <= 0 || columnCount <= 0) return
    setAnchor(clamp({ row: 0, column: startColumn }))
    setFocus(clamp({ row: rowCount - 1, column: endColumn }))
  }

  function selectAll() {
    if (rowCount <= 0 || columnCount <= 0) return
    setAnchor({ row: 0, column: 0 })
    setFocus({ row: rowCount - 1, column: columnCount - 1 })
  }

  function startDrag(position: GridCellPosition, extend = false) {
    dragging.current = true
    selectCell(position, extend)
  }

  function endDrag() {
    dragging.current = false
  }

  function isSelected(row: number, column: number) {
    return Boolean(bounds
      && row >= bounds.top
      && row <= bounds.bottom
      && column >= bounds.left
      && column <= bounds.right)
  }

  return {
    anchor,
    focus,
    bounds,
    dragging,
    selectCell,
    extendSelection,
    selectRows,
    selectColumns,
    selectAll,
    startDrag,
    endDrag,
    isSelected,
  }
}
