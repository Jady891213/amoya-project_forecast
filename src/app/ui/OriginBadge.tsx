import type { DataOrigin } from '../domain/types'

const labels: Record<DataOrigin, string> = {
  system: '系统内置',
  user: '用户录入',
  demo: '演示数据',
}

export function OriginBadge({ origin }: { origin: DataOrigin }) {
  return <span className={`origin-badge origin-${origin}`}>{labels[origin]}</span>
}

