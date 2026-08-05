import { useEffect, useMemo, useState, type PointerEvent, type ReactNode } from 'react'

export interface ResizableColumn {
  key: string
  label: ReactNode
  width: number
  minWidth?: number
  maxWidth?: number
}

interface ResizableTableProps {
  columns: ResizableColumn[]
  storageKey: string
  children: ReactNode
  className?: string
}

export function ResizableTable({ columns, storageKey, children, className = '' }: ResizableTableProps) {
  const defaults = useMemo(() => Object.fromEntries(columns.map((column) => [column.key, column.width])), [columns])
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as Record<string, number>
      return { ...defaults, ...saved }
    } catch {
      return defaults
    }
  })

  useEffect(() => {
    setWidths((current) => Object.fromEntries(columns.map((column) => [column.key, current[column.key] ?? column.width])))
  }, [columns])

  function beginResize(column: ResizableColumn, event: PointerEvent<HTMLSpanElement>) {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = widths[column.key] ?? column.width
    const minWidth = column.minWidth ?? 56
    const maxWidth = column.maxWidth ?? 560

    const move = (moveEvent: globalThis.PointerEvent) => {
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + moveEvent.clientX - startX))
      setWidths((current) => ({ ...current, [column.key]: nextWidth }))
    }
    const finish = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', finish)
      setWidths((current) => {
        window.localStorage.setItem(storageKey, JSON.stringify(current))
        return current
      })
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', finish, { once: true })
  }

  const totalWidth = columns.reduce((sum, column) => sum + (widths[column.key] ?? column.width), 0)
  return (
    <table className={`resizable-data-table ${className}`.trim()} style={{ minWidth: `${totalWidth}px` }}>
      <colgroup>{columns.map((column) => <col key={column.key} style={{ width: `${widths[column.key] ?? column.width}px` }} />)}</colgroup>
      <thead><tr>{columns.map((column) => (
        <th key={column.key}>
          <span className="resizable-header-label">{column.label}</span>
          <span
            className="data-column-resizer"
            aria-hidden="true"
            onPointerDown={(event) => beginResize(column, event)}
          />
        </th>
      ))}</tr></thead>
      {children}
    </table>
  )
}
