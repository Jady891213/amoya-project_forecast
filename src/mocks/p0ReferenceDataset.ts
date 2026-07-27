import {
  BASELINE_SCENARIO_CODE,
  REFERENCE_DATASET_ID,
  WORKING_VERSION_CODE,
  type BaseFact,
  type BaseMetricCode,
  type Department,
  type Project,
  type ProjectModule,
} from '../domain/types'
import { generatePeriods } from '../domain/periods'

const CREATED_AT = '2026-07-28T00:00:00.000Z'

export const REFERENCE_DEPARTMENTS: Department[] = [
  {
    id: 'department-iptv',
    code: 'BU-IPTV',
    name: '互联网电视事业部',
    status: 'active',
    origin: 'user',
    datasetId: REFERENCE_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'department-advertising',
    code: 'BU-AD',
    name: '广告业务部',
    status: 'active',
    origin: 'user',
    datasetId: REFERENCE_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
]

export const REFERENCE_PROJECTS: Project[] = [
  {
    id: 'project-hebei-unicom-cloud',
    code: 'PRJ-2026-001',
    name: '河北联通云游戏 + 超高清项目',
    customer: '河北联通',
    departmentId: 'department-iptv',
    owner: '王敏',
    startPeriod: '2026-08',
    durationMonths: 17,
    status: 'calculating',
    remark: '历史测算材料包含云游戏、超高清、分月损益、账期与现金流。',
    origin: 'user',
    datasetId: REFERENCE_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'project-chongqing-mobile-screen',
    code: 'PRJ-2026-002',
    name: '重庆移动中屏项目',
    customer: '重庆移动',
    departmentId: 'department-iptv',
    owner: '李然',
    startPeriod: '2026-07',
    durationMonths: 12,
    status: 'calculating',
    remark: '历史测算材料包含注册用户、活跃用户和盈亏平衡分析。',
    origin: 'user',
    datasetId: REFERENCE_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'project-hebei-cable-iptv',
    code: 'PRJ-2026-003',
    name: '河北有线互联网电视项目',
    customer: '河北有线',
    departmentId: 'department-iptv',
    owner: '王敏',
    startPeriod: '2026-08',
    durationMonths: 5,
    status: 'calculating',
    remark: '历史测算材料周期为2026年8月至12月，包含渠道分成与CDN成本。',
    origin: 'user',
    datasetId: REFERENCE_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'project-bestv-ctv-ad',
    code: 'PRJ-2026-004',
    name: '百视通 CTV 程序化广告能力建设项目',
    customer: '百视通',
    departmentId: 'department-advertising',
    owner: '李然',
    startPeriod: '2026-06',
    durationMonths: 36,
    status: 'calculating',
    remark: '历史测算材料包含三年预测、月度资金计划和核心财务指标。',
    origin: 'user',
    datasetId: REFERENCE_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
]

function module(
  projectId: string,
  code: string,
  name: string,
  isCommon = false,
): ProjectModule {
  return {
    id: `module-${projectId.replace('project-', '')}-${code.toLowerCase()}`,
    projectId,
    code,
    name,
    isCommon,
    origin: 'user',
    datasetId: REFERENCE_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }
}

export const REFERENCE_MODULES: ProjectModule[] = [
  module('project-hebei-unicom-cloud', 'PUBLIC', '公共', true),
  module('project-hebei-unicom-cloud', 'CLOUD_GAME', '云游戏'),
  module('project-hebei-unicom-cloud', 'ULTRA_HD', '超高清'),
  module('project-chongqing-mobile-screen', 'PUBLIC', '公共', true),
  module('project-chongqing-mobile-screen', 'MEDIUM_SCREEN', '中屏'),
  module('project-hebei-cable-iptv', 'PUBLIC', '公共', true),
  module('project-hebei-cable-iptv', 'IPTV', '互联网电视'),
  module('project-bestv-ctv-ad', 'PUBLIC', '公共', true),
  module('project-bestv-ctv-ad', 'PROGRAMMATIC_AD', '程序化广告'),
]

function fact(
  project: Project,
  moduleId: string,
  period: string,
  metricCode: BaseMetricCode,
  value: number,
): BaseFact {
  return {
    id: `${project.id}:${moduleId}:${period}:${metricCode}`,
    projectId: project.id,
    departmentId: project.departmentId,
    period,
    scenarioId: BASELINE_SCENARIO_CODE,
    versionId: WORKING_VERSION_CODE,
    businessModuleId: moduleId,
    metricCode,
    value: String(value),
    sourceLabel: 'P0结构验证事实',
    origin: 'demo',
    datasetId: REFERENCE_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }
}

function buildCloudFacts(): BaseFact[] {
  const project = REFERENCE_PROJECTS[0]
  const periods = generatePeriods(project.startPeriod, project.durationMonths)
  const cloudRevenue = periods.map(() => 200_000)
  const cloudCost = periods.map((_, index) => 124_000 + index * 800)
  const ultraRevenue = periods.map(() => 50_000)
  const ultraCost = periods.map((_, index) => 31_000 + index * 400)

  return periods.flatMap((period, index) => [
    fact(project, 'module-hebei-unicom-cloud-cloud_game', period, 'revenue', cloudRevenue[index]),
    fact(project, 'module-hebei-unicom-cloud-cloud_game', period, 'cost', cloudCost[index]),
    fact(project, 'module-hebei-unicom-cloud-cloud_game', period, 'cash_inflow', index < 3 ? 0 : cloudRevenue[index - 3]),
    fact(project, 'module-hebei-unicom-cloud-cloud_game', period, 'cash_outflow', index === 0 ? 900_000 : cloudCost[index - 1]),
    fact(project, 'module-hebei-unicom-cloud-ultra_hd', period, 'revenue', ultraRevenue[index]),
    fact(project, 'module-hebei-unicom-cloud-ultra_hd', period, 'cost', ultraCost[index]),
    fact(project, 'module-hebei-unicom-cloud-ultra_hd', period, 'cash_inflow', index < 3 ? 0 : ultraRevenue[index - 3]),
    fact(project, 'module-hebei-unicom-cloud-ultra_hd', period, 'cash_outflow', ultraCost[index]),
  ])
}

function buildIptvFacts(): BaseFact[] {
  const project = REFERENCE_PROJECTS[2]
  const periods = generatePeriods(project.startPeriod, project.durationMonths)
  const revenue = periods.map(() => 63_408)
  const cost = periods.map(() => 42_220)

  return periods.flatMap((period, index) => [
    fact(project, 'module-hebei-cable-iptv-iptv', period, 'revenue', revenue[index]),
    fact(project, 'module-hebei-cable-iptv-iptv', period, 'cost', cost[index]),
    fact(project, 'module-hebei-cable-iptv-iptv', period, 'cash_inflow', index === 0 ? 0 : revenue[index - 1]),
    fact(project, 'module-hebei-cable-iptv-iptv', period, 'cash_outflow', cost[index]),
  ])
}

export const REFERENCE_FACTS: BaseFact[] = [
  ...buildCloudFacts(),
  ...buildIptvFacts(),
]
