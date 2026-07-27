import { SYSTEM_METRICS } from '../../domain/metrics'
import { formatPeriod } from '../../domain/periods'
import type { DatabaseClient, SqlStatement } from '../types'
import { CURRENT_SCHEMA_VERSION, SCHEMA_V1 } from './migrations'

function periodStatements(): SqlStatement[] {
  const rows: SqlStatement[] = []
  for (let year = 2020; year <= 2035; year += 1) {
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

export async function initializeSqliteDatabase(
  database: DatabaseClient,
): Promise<void> {
  await database.execute(SCHEMA_V1)
  const migrations = await database.query<{ version: number }>(
    'SELECT version FROM sys_schema_migration WHERE version = ?',
    [CURRENT_SCHEMA_VERSION],
  )
  const now = new Date().toISOString()
  const statements = [
    ...periodStatements(),
    ...metricStatements(),
    {
      sql: `INSERT OR REPLACE INTO sys_app_metadata (key, value, updated_at)
        VALUES ('database:version', ?, ?)`,
      params: [String(CURRENT_SCHEMA_VERSION), now],
    },
  ]
  if (migrations.length === 0) {
    statements.push({
      sql: `INSERT INTO sys_schema_migration (version, description, applied_at)
        VALUES (?, ?, ?)`,
      params: [
        CURRENT_SCHEMA_VERSION,
        'P0 SQLite维度、事实与指标模型',
        now,
      ],
    })
  }
  await database.batch(statements)
  database.runtime.schemaVersion = CURRENT_SCHEMA_VERSION
}
