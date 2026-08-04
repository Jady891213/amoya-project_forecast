import { SYSTEM_METRICS } from '../../domain/metrics'
import { formatPeriod } from '../../domain/periods'
import type { DatabaseClient, SqlStatement } from '../types'
import {
  CURRENT_SCHEMA_VERSION,
  CURRENT_SCHEMA,
} from './migrations'

function periodStatements(): SqlStatement[] {
  const rows: SqlStatement[] = []
  for (let year = 2020; year <= 2075; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const period = `${year}-${String(month).padStart(2, '0')}`
      rows.push({
        sql: `INSERT OR IGNORE INTO dim_period
          (period, display_name, year, quarter, month_number, sort_key)
          VALUES (?, ?, ?, ?, ?, ?)`,
        params: [
          period,
          formatPeriod(period),
          year,
          Math.ceil(month / 3),
          month,
          year * 100 + month,
        ],
      })
    }
  }
  return rows
}

function metricStatements(): SqlStatement[] {
  return SYSTEM_METRICS.map((metric) => ({
    sql: `INSERT INTO dim_metric (
      code, name, metric_type, category, expression, unit, value_type,
      period_aggregation, description, dependencies_json, sort_order,
      system_managed, origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      metric_type = excluded.metric_type,
      category = excluded.category,
      expression = excluded.expression,
      unit = excluded.unit,
      value_type = excluded.value_type,
      period_aggregation = excluded.period_aggregation,
      description = excluded.description,
      dependencies_json = excluded.dependencies_json,
      sort_order = excluded.sort_order,
      system_managed = excluded.system_managed`,
    params: [
      metric.code,
      metric.name,
      metric.metricType,
      metric.category,
      metric.expression ?? null,
      metric.unit,
      metric.valueType,
      metric.periodAggregation,
      metric.description,
      JSON.stringify(metric.dependencies),
      metric.sortOrder,
      metric.systemManaged ? 1 : 0,
      metric.origin,
    ],
  }))
}

function globalDimensionStatements(now: string): SqlStatement[] {
  const versions = [
    ['working', 'working', '基准方案'],
    ['version_1', 'version_1', '版本 1'],
    ['version_2', 'version_2', '版本 2'],
    ['version_3', 'version_3', '版本 3'],
  ] as const
  return [
    {
      sql: `INSERT INTO dim_scenario
        (id, code, name, is_default, origin, created_at, updated_at)
        VALUES ('baseline', 'baseline', '基准场景', 1, 'system', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          code = excluded.code, name = excluded.name,
          is_default = excluded.is_default, updated_at = excluded.updated_at`,
      params: [now, now],
    },
    ...versions.map(([id, code, name]) => ({
      sql: `INSERT INTO dim_version
        (id, code, name, status, is_mutable, origin, created_at, updated_at)
        VALUES (?, ?, ?, 'working', 0, 'system', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          code = excluded.code, name = excluded.name, status = excluded.status,
          is_mutable = excluded.is_mutable, origin = excluded.origin,
          updated_at = excluded.updated_at`,
      params: [id, code, name, now, now],
    })),
  ]
}

export async function initializeSqliteDatabase(
  database: DatabaseClient,
): Promise<void> {
  const now = new Date().toISOString()
  const migrationTable = await database.query<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name = 'sys_schema_migration'`,
  )
  if (migrationTable.length === 0) {
    await database.execute(CURRENT_SCHEMA)
  }
  const migrations = await database.query<{ version: number }>(
    'SELECT version FROM sys_schema_migration ORDER BY version',
  )
  const applied = new Set(migrations.map((item) => item.version))
  if (!applied.has(CURRENT_SCHEMA_VERSION)) {
    await database.execute(
      `INSERT INTO sys_schema_migration (version, description, applied_at)
       VALUES (?, '多版本测算与全局多维事实视图结构', ?)`,
      [CURRENT_SCHEMA_VERSION, now],
    )
  }
  if (applied.size > 0 && !applied.has(CURRENT_SCHEMA_VERSION)) {
    throw new Error('当前开发版本不兼容旧数据库，请重新建立开发数据库')
  }
  const statements = [
    ...periodStatements(),
    ...metricStatements(),
    ...globalDimensionStatements(now),
    {
      sql: `INSERT OR REPLACE INTO sys_app_metadata (key, value, updated_at)
        VALUES ('database:version', ?, ?)`,
      params: [String(CURRENT_SCHEMA_VERSION), now],
    },
  ]
  await database.batch(statements)
  database.runtime.schemaVersion = CURRENT_SCHEMA_VERSION
}
