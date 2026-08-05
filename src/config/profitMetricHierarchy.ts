export const PROFIT_METRIC_HIERARCHY = [
  {
    code: 'revenue', name: '收入', color: '#159b6b', children: [
      { code: 'revenue_project_service', name: '项目服务费' },
      { code: 'revenue_annual_subscription', name: '年度订阅费' },
      { code: 'revenue_value_added', name: '增值收入' },
      { code: 'revenue_other', name: '其他收入' },
    ],
  },
  {
    code: 'cost', name: '成本', color: '#e27a17', children: [
      {
        code: 'cost_business', name: '商务成本', color: '#ff8a3d', children: [
          { code: 'cost_business_customer_maintenance', name: '客户维护' },
          { code: 'cost_business_travel', name: '商务差旅' },
          { code: 'cost_business_other', name: '其他商务成本' },
        ],
      },
      {
        code: 'cost_technical', name: '技术成本', color: '#7c5cff', children: [
          { code: 'cost_technical_cdn', name: 'CDN成本' },
          { code: 'cost_technical_line', name: '专线费' },
          { code: 'cost_technical_other', name: '其他技术成本' },
        ],
      },
      {
        code: 'cost_copyright', name: '版权成本', color: '#2f6bff', children: [
          { code: 'cost_copyright_purchase', name: '版权采购' },
          { code: 'cost_copyright_channel', name: '频道引入' },
          { code: 'cost_copyright_other', name: '其他版权成本' },
        ],
      },
      {
        code: 'cost_marketing', name: '营销成本', color: '#00b3a4', children: [
          { code: 'cost_marketing_channel', name: '渠道推广' },
          { code: 'cost_marketing_advertising', name: '广告投放' },
          { code: 'cost_marketing_other', name: '其他营销成本' },
        ],
      },
      {
        code: 'cost_labor', name: '人力成本', color: '#e0529e', children: [
          { code: 'cost_labor_research', name: '研发人力' },
          { code: 'cost_labor_delivery', name: '交付/实施人力' },
          { code: 'cost_labor_other', name: '其他人力成本' },
        ],
      },
    ],
  },
] as const

type Root = (typeof PROFIT_METRIC_HIERARCHY)[number]
type RevenueLeaf = Extract<Root, { code: 'revenue' }>['children'][number]['code']
type CostGroup = Extract<Root, { code: 'cost' }>['children'][number]
type CostLeaf = CostGroup['children'][number]['code']

export type ProfitRootMetricCode = Root['code']
export type ProfitGroupMetricCode = CostGroup['code']
export type ProfitLeafMetricCode = RevenueLeaf | CostLeaf
export type ProfitMetricCode = ProfitRootMetricCode | ProfitGroupMetricCode | ProfitLeafMetricCode

export interface ProfitMetricNode {
  code: ProfitMetricCode
  name: string
  parentCode?: ProfitMetricCode
  hierarchyLevel: number
  isLeaf: boolean
  sortOrder: number
  color?: string
}

export const PROFIT_METRIC_NODES: ProfitMetricNode[] = (() => {
  const result: ProfitMetricNode[] = []
  let sortOrder = 10
  PROFIT_METRIC_HIERARCHY.forEach((root) => {
    result.push({ code: root.code, name: root.name, hierarchyLevel: 0, isLeaf: false, sortOrder, color: root.color })
    sortOrder += 10
    root.children.forEach((child) => {
      const grandchildren = 'children' in child ? child.children : undefined
      result.push({ code: child.code, name: child.name, parentCode: root.code, hierarchyLevel: 1, isLeaf: !grandchildren, sortOrder, color: 'color' in child ? child.color : root.color })
      sortOrder += 10
      grandchildren?.forEach((leaf) => {
        result.push({ code: leaf.code, name: leaf.name, parentCode: child.code, hierarchyLevel: 2, isLeaf: true, sortOrder, color: 'color' in child ? child.color : root.color })
        sortOrder += 10
      })
    })
  })
  return result
})()

export const PROFIT_METRIC_BY_CODE = new Map(PROFIT_METRIC_NODES.map((item) => [item.code, item]))

export function metricPath(code: string): ProfitMetricNode[] {
  const path: ProfitMetricNode[] = []
  let current = PROFIT_METRIC_BY_CODE.get(code as ProfitMetricCode)
  while (current) {
    path.unshift(current)
    current = current.parentCode ? PROFIT_METRIC_BY_CODE.get(current.parentCode) : undefined
  }
  return path
}

export function metricPathLabel(code: string): string {
  return metricPath(code).slice(1).map((item) => item.name).join(' / ')
}

export function profitLeafCodes(rootCode: ProfitRootMetricCode): ProfitLeafMetricCode[] {
  return PROFIT_METRIC_NODES
    .filter((item) => item.isLeaf && metricPath(item.code)[0]?.code === rootCode)
    .map((item) => item.code as ProfitLeafMetricCode)
}

export function descendantProfitLeafCodes(code: string): ProfitLeafMetricCode[] {
  const node = PROFIT_METRIC_BY_CODE.get(code as ProfitMetricCode)
  if (!node) return []
  if (node.isLeaf) return [node.code as ProfitLeafMetricCode]
  return PROFIT_METRIC_NODES
    .filter((item) => item.isLeaf && metricPath(item.code).some((ancestor) => ancestor.code === node.code))
    .map((item) => item.code as ProfitLeafMetricCode)
}

export function defaultProfitLeafCode(rootCode: ProfitRootMetricCode): ProfitLeafMetricCode {
  return rootCode === 'revenue' ? 'revenue_other' : 'cost_business_other'
}

export const REVENUE_LEAF_METRIC_CODES = profitLeafCodes('revenue')
export const COST_LEAF_METRIC_CODES = profitLeafCodes('cost')
