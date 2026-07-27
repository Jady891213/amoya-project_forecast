import type { DatabaseClient, SqlStatement } from '../storage/types'
import { REFERENCE_DATASET_ID } from '../domain/types'
import {
  REFERENCE_DEPARTMENTS,
  REFERENCE_FACTS,
  REFERENCE_MODULES,
  REFERENCE_PROJECTS,
} from '../mocks/p0ReferenceDataset'

const LEGACY_DATASET_IDS = ['p0-demo-v1', 'p0-reference-v1']
const STATE_KEY = `reference-dataset:${REFERENCE_DATASET_ID}`

export class ReferenceDatasetService {
  constructor(private readonly database: DatabaseClient) {}

  async ensureInitialized(): Promise<void> {
    if ((await this.getState()) === 'missing') await this.initialize()
  }

  async initialize(): Promise<void> {
    const statements: SqlStatement[] = [...this.deleteStatements()]

    REFERENCE_DEPARTMENTS.forEach((row) =>
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
    REFERENCE_PROJECTS.forEach((row) =>
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
    REFERENCE_MODULES.forEach((row) =>
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
    REFERENCE_FACTS.forEach((row) =>
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
        sql: `DELETE FROM sys_app_metadata
              WHERE key IN (?, ?, ?)`,
        params: [
          STATE_KEY,
          'reference-dataset:p0-reference-v1',
          'demo-dataset:p0-demo-v1',
        ],
      },
    ])
  }

  async getState(): Promise<'initialized' | 'missing'> {
    const rows = await this.database.query<{ value: string }>(
      'SELECT value FROM sys_app_metadata WHERE key = ?',
      [STATE_KEY],
    )
    return rows[0]?.value === 'initialized' ? 'initialized' : 'missing'
  }

  private deleteStatements(): SqlStatement[] {
    return [
      {
        sql: 'DELETE FROM fact_metric_value WHERE dataset_id IN (?, ?, ?)',
        params: [REFERENCE_DATASET_ID, ...LEGACY_DATASET_IDS],
      },
      {
        sql: 'DELETE FROM dim_project WHERE dataset_id IN (?, ?, ?)',
        params: [REFERENCE_DATASET_ID, ...LEGACY_DATASET_IDS],
      },
      {
        sql: `DELETE FROM dim_department
              WHERE dataset_id IN (?, ?, ?)
              AND NOT EXISTS (
                SELECT 1 FROM dim_project WHERE department_id = dim_department.id
              )`,
        params: [REFERENCE_DATASET_ID, ...LEGACY_DATASET_IDS],
      },
    ]
  }
}
