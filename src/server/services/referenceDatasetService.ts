import type { DatabaseClient, SqlStatement } from '../../app/storage/types'
import { REFERENCE_DATASET_ID } from '../../shared/domain/types'
import {
  REFERENCE_DEPARTMENTS,
  REFERENCE_PROJECTS,
} from '../../app/mocks/p0ReferenceDataset'
import { HISTORICAL_PROJECT_CONFIGS } from '../../app/mocks/historicalProjectConfigs'
import { CalculationService } from './calculationService'

const LEGACY_DATASET_IDS = [
  'p0-demo-v1',
  'p0-reference-v1',
  'p0-reference-v2',
  'historical-project-config-v1',
  'historical-project-config-v2',
  'historical-project-config-v3',
  'historical-project-config-v4',
]
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
          id, code, name, department_id, start_period, end_period,
          status, attributes_json, origin,
          dataset_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        params: [
          row.id, row.code ?? null, row.name, row.departmentId,
          row.startPeriod, row.endPeriod, row.status,
          row.origin, row.datasetId, row.createdAt, row.updatedAt,
        ],
      }),
    )
    await this.database.batch(statements)
    const calculation = new CalculationService(this.database)
    for (const config of HISTORICAL_PROJECT_CONFIGS) {
      const result = await calculation.saveAndCalculate(
        config.projectId,
        {
          lines: config.lines,
          parameters: config.parameters,
        },
      )
      if (!result.success) {
        throw new Error(
          `历史项目配置计算失败：${config.projectId}（${result.issues
            .map((issue) => issue.message)
            .join('；')}）`,
        )
      }
    }
    await this.database.execute(
      `INSERT OR REPLACE INTO sys_app_metadata (key, value, updated_at)
       VALUES (?, 'initialized', ?)`,
      [STATE_KEY, new Date().toISOString()],
    )
  }

  async clear(): Promise<void> {
    await this.database.batch([
      ...this.deleteStatements(),
      {
        sql: `DELETE FROM sys_app_metadata
              WHERE key IN (?, ?, ?, ?, ?, ?, ?)`,
        params: [
          STATE_KEY,
          'reference-dataset:historical-project-config-v1',
          'reference-dataset:historical-project-config-v2',
          'reference-dataset:historical-project-config-v3',
          'reference-dataset:historical-project-config-v4',
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
    const datasetIds = [REFERENCE_DATASET_ID, ...LEGACY_DATASET_IDS]
    const placeholders = datasetIds.map(() => '?').join(', ')
    return [
      {
        sql: `DELETE FROM fact_metric_value
              WHERE dataset_id IN (${placeholders})`,
        params: datasetIds,
      },
      {
        sql: `DELETE FROM dim_project WHERE dataset_id IN (${placeholders})`,
        params: datasetIds,
      },
      {
        sql: `DELETE FROM dim_department
              WHERE dataset_id IN (${placeholders})
              AND NOT EXISTS (
                SELECT 1 FROM dim_project WHERE department_id = dim_department.id
              )`,
        params: datasetIds,
      },
    ]
  }
}
