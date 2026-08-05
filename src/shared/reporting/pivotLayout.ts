import type { PivotMetadata, PivotPlanLabelMode, PivotTuple } from '../domain/types'

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

/**
 * 方案编码在不同项目下允许同名。结果表默认带出项目名称，也可按页面显示设置只显示方案名。
 * 页面与 Excel 共用该转换，原始查询元组和稳定成员 ID 不变。
 */
export function displayPivotTuples(tuples: PivotTuple[], metadata: PivotMetadata, planLabelMode: PivotPlanLabelMode): PivotTuple[] {
  const plans = new Map(metadata.dimensions.find((item) => item.dimension === 'plan')?.members.map((item) => [item.id, item]) ?? [])
  const projects = new Map(metadata.dimensions.find((item) => item.dimension === 'project')?.members.map((item) => [item.id, item]) ?? [])
  return tuples.map((tuple) => ({
    ...tuple,
    members: tuple.members.map((member) => {
      if (member.dimension !== 'plan') return member
      const plan = plans.get(member.memberId)
      const planName = plan?.label ?? member.label
      const projectName = projects.get(plan?.parentId ?? member.parentId ?? '')?.label
      return {
        ...member,
        label: planLabelMode === 'project_plan' && projectName ? `${projectName}（${planName}）` : planName,
      }
    }),
  }))
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
