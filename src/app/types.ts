import type {
  BaseFact,
  Department,
  MetricDefinition,
  PeriodDimension,
  Project,
  ProjectModule,
  Scenario,
  Version,
} from '../domain/types'
import type { StorageRuntimeInfo } from '../storage/types'

export interface AppSnapshot {
  departments: Department[]
  projects: Project[]
  modules: ProjectModule[]
  periods: PeriodDimension[]
  scenarios: Scenario[]
  versions: Version[]
  metrics: MetricDefinition[]
  facts: BaseFact[]
  demoState: 'initialized' | 'cleared' | 'missing'
  storage: StorageRuntimeInfo
}
