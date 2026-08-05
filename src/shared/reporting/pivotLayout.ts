import type { PivotTuple } from '../domain/types'

export interface PivotHeaderCell {
  tupleIndex: number
  level: number
  span: number
  label: string
  memberId: string
}

function samePrefix(left: PivotTuple, right: PivotTuple, level: number) {
  for (let index = 0; index <= level; index += 1) {
    const leftMember = left.members[index]
    const rightMember = right.members[index]
    if (!leftMember || !rightMember) return false
    if (leftMember.dimension !== rightMember.dimension || leftMember.memberId !== rightMember.memberId) return false
  }
  return true
}

/**
 * 将有序轴元组转换为多级合并表头。只合并连续、且完整父级路径一致的成员。
 * 页面表格和 Excel 导出必须共用该结果，避免出现两套表头口径。
 */
export function buildPivotHeaderRows(tuples: PivotTuple[], levelCount: number): PivotHeaderCell[][] {
  return Array.from({ length: levelCount }, (_, level) => {
    const cells: PivotHeaderCell[] = []
    let tupleIndex = 0
    while (tupleIndex < tuples.length) {
      const tuple = tuples[tupleIndex]
      const member = tuple.members[level]
      if (!member) {
        tupleIndex += 1
        continue
      }
      let span = 1
      while (tupleIndex + span < tuples.length && samePrefix(tuple, tuples[tupleIndex + span], level)) span += 1
      cells.push({ tupleIndex, level, span, label: member.label, memberId: member.memberId })
      tupleIndex += span
    }
    return cells
  })
}

export function visiblePivotRows(
  rows: PivotTuple[],
  columns: PivotTuple[],
  valueFor: (rowKey: string, columnKey: string) => string | null | undefined,
  hideNoDataRows: boolean,
) {
  if (!hideNoDataRows) return rows
  return rows.filter((row) => columns.some((column) => {
    const value = valueFor(row.key, column.key)
    return value !== null && value !== '' && value !== undefined
  }))
}
