import {
  REFERENCE_DATASET_ID,
  type Department,
  type Project,
  type ProjectPlan,
} from '../domain/types'

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
    departmentId: 'department-iptv',
    status: 'calculating',
    startPeriod: '2026-08', endPeriod: '2027-12', draftRevision: 0,
    origin: 'user',
    datasetId: REFERENCE_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'project-chongqing-mobile-screen',
    code: 'PRJ-2026-002',
    name: '重庆移动中屏项目',
    departmentId: 'department-iptv',
    status: 'calculating',
    startPeriod: '2026-07', endPeriod: '2027-06', draftRevision: 0,
    origin: 'user',
    datasetId: REFERENCE_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'project-hebei-cable-iptv',
    code: 'PRJ-2026-003',
    name: '河北有线互联网电视项目',
    departmentId: 'department-iptv',
    status: 'calculating',
    startPeriod: '2026-08', endPeriod: '2026-12', draftRevision: 0,
    origin: 'user',
    datasetId: REFERENCE_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'project-bestv-ctv-ad',
    code: 'PRJ-2026-004',
    name: '百视通 CTV 程序化广告能力建设项目',
    departmentId: 'department-advertising',
    status: 'calculating',
    startPeriod: '2026-07', endPeriod: '2029-06', draftRevision: 0,
    origin: 'user',
    datasetId: REFERENCE_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'project-hebei-cloud-game-report',
    code: 'PRJ-2026-005',
    name: '河北云游戏项目（历史报告）',
    departmentId: 'department-iptv',
    status: 'calculating',
    startPeriod: '2026-08', endPeriod: '2027-07', draftRevision: 0,
    origin: 'user',
    datasetId: REFERENCE_DATASET_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
]

const PLAN_PERIODS: Record<string, [string, string]> = {
  'project-hebei-unicom-cloud': ['2026-08', '2027-12'],
  'project-chongqing-mobile-screen': ['2026-07', '2027-06'],
  'project-hebei-cable-iptv': ['2026-08', '2026-12'],
  'project-bestv-ctv-ad': ['2026-07', '2029-06'],
  'project-hebei-cloud-game-report': ['2026-08', '2027-07'],
}

export const REFERENCE_PLANS: ProjectPlan[] = REFERENCE_PROJECTS.map((project) => ({
  projectId: project.id,
  planId: `plan-${project.id.replace(/^project-/, '')}-default`,
  name: '默认方案',
  startPeriod: PLAN_PERIODS[project.id][0],
  endPeriod: PLAN_PERIODS[project.id][1],
  status: 'active',
  isDefault: true,
  sortOrder: 1,
  draftRevision: 0,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
}))
