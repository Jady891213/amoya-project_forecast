import type { DatabaseClient, SqlStatement } from '../storage/types'
import { DEMO_DATASET_ID } from '../domain/types'
import {
  DEMO_DEPARTMENTS,
  DEMO_FACTS,
  DEMO_MODULES,
  DEMO_PROJECTS,
  DEMO_SCENARIOS,
  DEMO_VERSIONS,
} from '../mocks/p0DemoDataset'

const STATE_KEY = `demo-dataset:${DEMO_DATASET_ID}`

export class DemoDatasetService {
  constructor(private readonly database: DatabaseClient) {}

  async ensureInitialized(): Promise<void> {
    if ((await this.getState()) === 'missing') await this.initialize()
  }

  async initialize(): Promise<void> {
    const statements: SqlStatement[] = [...this.deleteStatements()]

    DEMO_DEPARTMENTS.forEach((row) =>
      statements.push({
        sql: `INSERT OR REPLACE INTO dim_department
          (id, code, name, status, origin, dataset_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          row.id, row.code, row.name, row.status, row.origin,
          row.datasetId, row.createdAt, row.updatedAt,
        ],
      }),
    )
    DEMO_PROJECTS.forEach((row) =>
      statements.push({
        sql: `INSERT OR REPLACE INTO dim_project (
          id, code, name, customer, department_id, owner, start_period,
          duration_months, status, remark, attributes_json, origin,
          dataset_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        params: [
          row.id, row.code ?? null, row.name, row.customer, row.departmentId,
          row.owner, row.startPeriod, row.durationMonths, row.status, row.remark,
          row.origin, row.datasetId, row.createdAt, row.updatedAt,
        ],
      }),
    )
    DEMO_MODULES.forEach((row) =>
      statements.push({
        sql: `INSERT OR REPLACE INTO dim_business_module (
          id, project_id, code, name, is_common, origin, dataset_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          row.id, row.projectId, row.code, row.name, row.isCommon ? 1 : 0,
          row.origin, row.datasetId, row.createdAt, row.updatedAt,
        ],
      }),
    )
    DEMO_SCENARIOS.forEach((row) =>
      statements.push({
        sql: `INSERT OR REPLACE INTO dim_scenario (
          id, project_id, code, name, is_default, origin, dataset_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          row.id, row.projectId, row.code, row.name, row.isDefault ? 1 : 0,
          row.origin, row.datasetId, row.createdAt, row.updatedAt,
        ],
      }),
    )
    DEMO_VERSIONS.forEach((row) =>
      statements.push({
        sql: `INSERT OR REPLACE INTO dim_version (
          id, project_id, code, name, status, is_mutable, origin,
          dataset_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          row.id, row.projectId, row.code, row.name, row.status,
          row.isMutable ? 1 : 0, row.origin, row.datasetId,
          row.createdAt, row.updatedAt,
        ],
      }),
    )
    DEMO_FACTS.forEach((row) =>
      statements.push({
        sql: `INSERT OR REPLACE INTO fact_metric_value (
          id, project_id, department_id, business_module_id, period,
          scenario_id, version_id, metric_code, value_text, source_label,
          origin, dataset_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          row.id, row.projectId, row.departmentId, row.businessModuleId,
          row.period, row.scenarioId, row.versionId, row.metricCode, row.value,
          row.sourceLabel, row.origin, row.datasetId, row.createdAt,
          row.updatedAt,
        ],
      }),
    )
    statements.push({
      sql: `INSERT OR REPLACE INTO sys_app_metadata (key, value, updated_at)
            VALUES (?, 'initialized', ?)`,
      params: [STATE_KEY, new Date().toISOString()],
    })
    await this.database.batch(statements)
  }

  async clear(): Promise<void> {
    await this.database.batch([
      ...this.deleteStatements(),
      {
        sql: `INSERT OR REPLACE INTO sys_app_metadata (key, value, updated_at)
              VALUES (?, 'cleared', ?)`,
        params: [STATE_KEY, new Date().toISOString()],
      },
    ])
  }

  async getState(): Promise<'initialized' | 'cleared' | 'missing'> {
    const rows = await this.database.query<{ value: string }>(
      'SELECT value FROM sys_app_metadata WHERE key = ?',
      [STATE_KEY],
    )
    if (rows[0]?.value === 'initialized') return 'initialized'
    if (rows[0]?.value === 'cleared') return 'cleared'
    return 'missing'
  }

  private deleteStatements(): SqlStatement[] {
    return [
      {
        sql: 'DELETE FROM fact_metric_value WHERE dataset_id = ?',
        params: [DEMO_DATASET_ID],
      },
      {
        sql: 'DELETE FROM dim_project WHERE dataset_id = ?',
        params: [DEMO_DATASET_ID],
      },
      {
        sql: `DELETE FROM dim_department
              WHERE dataset_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM dim_project WHERE department_id = dim_department.id
              )`,
        params: [DEMO_DATASET_ID],
      },
    ]
  }
}
