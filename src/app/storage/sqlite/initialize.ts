import { SYSTEM_METRICS } from '../../domain/metrics'
import { formatPeriod } from '../../domain/periods'
import type { DatabaseClient, SqlStatement } from '../types'
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_V1,
  SCHEMA_V2,
  SCHEMA_V3,
  SCHEMA_V4,
  SCHEMA_V5,
  SCHEMA_V6,
  SCHEMA_V7,
  SCHEMA_V9,
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
    {
      sql: `INSERT INTO dim_version
        (id, code, name, status, is_mutable, origin, created_at, updated_at)
        VALUES ('working', 'working', '工作版', 'working', 1, 'system', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          code = excluded.code, name = excluded.name, status = excluded.status,
          is_mutable = excluded.is_mutable, updated_at = excluded.updated_at`,
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
  if (migrationTable.length === 0) {
    await database.execute(SCHEMA_V1)
  }
  const migrations = await database.query<{ version: number }>(
    'SELECT version FROM sys_schema_migration ORDER BY version',
  )
  const applied = new Set(migrations.map((item) => item.version))
  if (!applied.has(1)) {
    await database.execute(
      `INSERT INTO sys_schema_migration (version, description, applied_at)
       VALUES (1, 'P0 SQLite维度、事实与指标模型', ?)`,
      [now],
    )
  }
  if (!applied.has(2)) {
    await database.execute(SCHEMA_V2)
    await database.execute(
      `INSERT INTO sys_schema_migration (version, description, applied_at)
       VALUES (2, '场景与版本调整为全局维度', ?)`,
      [now],
    )
  }
  if (!applied.has(3)) {
    await database.execute(SCHEMA_V3)
    await database.execute(
      `INSERT INTO sys_schema_migration (version, description, applied_at)
       VALUES (3, 'P1A预测配置、行项目事实与计算批次', ?)`,
      [now],
    )
  }
  if (!applied.has(4)) {
    await database.execute(SCHEMA_V4)
    await database.execute(
      `INSERT INTO sys_schema_migration (version, description, applied_at)
       VALUES (4, '基础事实配置扩展到损益与现金流', ?)`,
      [now],
    )
  }
  if (!applied.has(5)) {
    await database.execute(SCHEMA_V5)
    await database.execute(
      `INSERT INTO sys_schema_migration (version, description, applied_at)
       VALUES (5, 'P1B项目参数、行项目公式与配置快照', ?)`,
      [now],
    )
  }
  if (!applied.has(6)) {
    await database.execute(SCHEMA_V6)
    await database.execute(
      `INSERT INTO sys_schema_migration (version, description, applied_at)
       VALUES (6, 'P1C税口径、收付款规则与现金计划追溯', ?)`,
      [now],
    )
  }
  if (!applied.has(7)) {
    await database.execute(SCHEMA_V7)
    await database.execute(
      `INSERT INTO sys_schema_migration (version, description, applied_at)
       VALUES (7, '项目聚合修订、期间覆盖与计算项目快照', ?)`,
      [now],
    )
  }
  const projectColumns = await database.query<{ name: string }>(
    'PRAGMA table_info(dim_project)',
  )
  const projectColumnNames = new Set(projectColumns.map((column) => column.name))
  if (
    !projectColumnNames.has('end_period')
    || projectColumnNames.has('duration_months')
    || projectColumnNames.has('customer')
    || projectColumnNames.has('owner')
    || projectColumnNames.has('remark')
  ) {
    throw new Error('当前开发版本不兼容旧项目表，请使用当前结构重新建立开发数据库')
  }
  if (!applied.has(8)) {
    await database.execute(
      `INSERT INTO sys_schema_migration (version, description, applied_at)
       VALUES (8, '当前开发库项目主信息与起止期间结构', ?)`,
      [now],
    )
  }
  if (!applied.has(9)) {
    await database.execute(SCHEMA_V9)
    await database.execute(
      `INSERT INTO sys_schema_migration (version, description, applied_at)
       VALUES (9, '三类测算内容统一行项目与JSON配置', ?)`,
      [now],
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
