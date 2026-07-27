import {
  BASELINE_SCENARIO_CODE,
  DEMO_DATASET_ID,
  WORKING_VERSION_CODE,
  type BaseFact,
  type BaseMetricCode,
  type Department,
  type Project,
  type ProjectModule,
  type Scenario,
  type Version,
} from '../domain/types'
import { generatePeriods } from '../domain/periods'

const CREATED_AT = '2026-07-27T00:00:00.000Z'

export const DEMO_DEPARTMENTS: Department[] = [
  {
    id: 'dept-demo-internet',
    code: 'DEMO-INT',
    name: '互联网业务部（演示）',
    status: 'active',
    origin: 'demo',
    datasetId: DEMO_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'dept-demo-convergence',
    code: 'DEMO-CONV',
    name: '融合业务部（演示）',
    status: 'active',
    origin: 'demo',
    datasetId: DEMO_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
]

export const DEMO_PROJECTS: Project[] = [
  {
    id: 'project-demo-cloud',
    code: 'DEMO-CLOUD-001',
    name: '河北联通云游戏与超高清项目（演示）',
    customer: '河北联通',
    departmentId: 'dept-demo-internet',
    owner: '演示负责人',
    startPeriod: '2026-07',
    durationMonths: 12,
    status: 'calculating',
    remark: '用于验证双业务模块、分月损益和现金流计算。',
    origin: 'demo',
    datasetId: DEMO_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'project-demo-tv',
    code: 'DEMO-TV-001',
    name: '河北有线互联网电视项目（演示）',
    customer: '河北有线',
    departmentId: 'dept-demo-convergence',
    owner: '演示负责人',
    startPeriod: '2026-08',
    durationMonths: 6,
    status: 'calculating',
    remark: '用于验证单业务模块和项目数据隔离。',
    origin: 'demo',
    datasetId: DEMO_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
]

export const DEMO_MODULES: ProjectModule[] = [
  {
    id: 'module-demo-cloud-public',
    projectId: 'project-demo-cloud',
    code: 'PUBLIC',
    name: '公共',
    isCommon: true,
    origin: 'demo',
    datasetId: DEMO_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'module-demo-cloud-game',
    projectId: 'project-demo-cloud',
    code: 'CLOUD_GAME',
    name: '云游戏',
    isCommon: false,
    origin: 'demo',
    datasetId: DEMO_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'module-demo-ultra-hd',
    projectId: 'project-demo-cloud',
    code: 'ULTRA_HD',
    name: '超高清',
    isCommon: false,
    origin: 'demo',
    datasetId: DEMO_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'module-demo-tv-public',
    projectId: 'project-demo-tv',
    code: 'PUBLIC',
    name: '公共',
    isCommon: true,
    origin: 'demo',
    datasetId: DEMO_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'module-demo-tv',
    projectId: 'project-demo-tv',
    code: 'IPTV',
    name: '互联网电视',
    isCommon: false,
    origin: 'demo',
    datasetId: DEMO_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
]

export const DEMO_SCENARIOS: Scenario[] = DEMO_PROJECTS.map((project) => ({
  id: `${project.id}:${BASELINE_SCENARIO_CODE}`,
  projectId: project.id,
  code: BASELINE_SCENARIO_CODE,
  name: '基准场景',
  isDefault: true,
  origin: 'demo',
  datasetId: DEMO_DATASET_ID,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
}))

export const DEMO_VERSIONS: Version[] = DEMO_PROJECTS.map((project) => ({
  id: `${project.id}:${WORKING_VERSION_CODE}`,
  projectId: project.id,
  code: WORKING_VERSION_CODE,
  name: '工作版',
  status: 'working',
  isMutable: true,
  origin: 'demo',
  datasetId: DEMO_DATASET_ID,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
}))

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
    scenarioId: `${project.id}:${BASELINE_SCENARIO_CODE}`,
    versionId: `${project.id}:${WORKING_VERSION_CODE}`,
    businessModuleId: moduleId,
    metricCode,
    value: String(value),
    sourceLabel: 'P0独立演示事实',
    origin: 'demo',
    datasetId: DEMO_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }
}

function buildCloudFacts(): BaseFact[] {
  const project = DEMO_PROJECTS[0]
  const periods = generatePeriods(project.startPeriod, project.durationMonths)

  const cloudRevenue = periods.map((_, index) => 420_000 + index * 18_000)
  const cloudCost = periods.map((_, index) => 270_000 + index * 9_000)
  const ultraRevenue = periods.map((_, index) => 180_000 + index * 12_000)
  const ultraCost = periods.map((_, index) => 120_000 + index * 7_000)

  return periods.flatMap((period, index) => {
    const cloudCashInflow = index < 2 ? 0 : cloudRevenue[index - 2]
    const cloudCashOutflow = index === 0 ? 90_000 : cloudCost[index - 1]
    const ultraCashInflow = index === 0 ? 0 : ultraRevenue[index - 1]
    const ultraCashOutflow = ultraCost[index]

    return [
      fact(
        project,
        'module-demo-cloud-game',
        period,
        'revenue',
        cloudRevenue[index],
      ),
      fact(
        project,
        'module-demo-cloud-game',
        period,
        'cost',
        cloudCost[index],
      ),
      fact(
        project,
        'module-demo-cloud-game',
        period,
        'cash_inflow',
        cloudCashInflow,
      ),
      fact(
        project,
        'module-demo-cloud-game',
        period,
        'cash_outflow',
        cloudCashOutflow,
      ),
      fact(
        project,
        'module-demo-ultra-hd',
        period,
        'revenue',
        ultraRevenue[index],
      ),
      fact(
        project,
        'module-demo-ultra-hd',
        period,
        'cost',
        ultraCost[index],
      ),
      fact(
        project,
        'module-demo-ultra-hd',
        period,
        'cash_inflow',
        ultraCashInflow,
      ),
      fact(
        project,
        'module-demo-ultra-hd',
        period,
        'cash_outflow',
        ultraCashOutflow,
      ),
    ]
  })
}

function buildTvFacts(): BaseFact[] {
  const project = DEMO_PROJECTS[1]
  const periods = generatePeriods(project.startPeriod, project.durationMonths)
  const revenue = periods.map((_, index) => 250_000 + index * 24_000)
  const cost = periods.map((_, index) => 165_000 + index * 8_000)

  return periods.flatMap((period, index) => [
    fact(project, 'module-demo-tv', period, 'revenue', revenue[index]),
    fact(project, 'module-demo-tv', period, 'cost', cost[index]),
    fact(
      project,
      'module-demo-tv',
      period,
      'cash_inflow',
      index === 0 ? 0 : revenue[index - 1],
    ),
    fact(
      project,
      'module-demo-tv',
      period,
      'cash_outflow',
      index === 0 ? 220_000 : cost[index],
    ),
  ])
}

export const DEMO_FACTS: BaseFact[] = [...buildCloudFacts(), ...buildTvFacts()]
