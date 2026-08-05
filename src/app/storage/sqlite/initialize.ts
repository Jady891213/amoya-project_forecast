import { SYSTEM_METRICS } from '../../../shared/domain/metrics'
import { formatPeriod } from '../../../shared/domain/periods'
import type { DatabaseClient, SqlStatement } from '../../../shared/database'
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
      system_managed, origin, parent_code, hierarchy_level, is_leaf
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      system_managed = excluded.system_managed,
      parent_code = excluded.parent_code,
      hierarchy_level = excluded.hierarchy_level,
      is_leaf = excluded.is_leaf`,
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
      metric.parentCode ?? null,
      metric.hierarchyLevel,
      metric.isLeaf ? 1 : 0,
    ],
  }))
}

function globalDimensionStatements(now: string): SqlStatement[] {
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
  if (migrationTable.length > 0) {
    const existing = await database.query<{ version: number }>(
      'SELECT version FROM sys_schema_migration ORDER BY version',
    )
    if (!existing.some((item) => item.version === CURRENT_SCHEMA_VERSION)) {
      throw new Error('数据结构版本过旧，请使用原版本备份或重新初始化当前开发数据库')
    }
  }
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
       VALUES (?, '收入成本层级指标体系', ?)`,
      [CURRENT_SCHEMA_VERSION, now],
    )
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
