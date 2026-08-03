export const CURRENT_SCHEMA_VERSION = 10

/**
 * 当前开发库直接按最新结构创建，不承担旧 Schema 的升级兼容。
 * 结构变化时重建开发数据库，并由参考数据初始化服务重新生成示例项目。
 */
export const CURRENT_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE sys_schema_migration (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE sys_app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dim_department (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  origin TEXT NOT NULL CHECK (origin IN ('system', 'user', 'demo')),
  dataset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dim_project (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  department_id TEXT NOT NULL REFERENCES dim_department(id) ON UPDATE CASCADE,
  start_period TEXT NOT NULL REFERENCES dim_period(period),
  end_period TEXT NOT NULL REFERENCES dim_period(period),
  status TEXT NOT NULL CHECK (status IN ('calculating', 'archived')),
  attributes_json TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('system', 'user', 'demo')),
  dataset_id TEXT,
  draft_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_period >= start_period)
);

CREATE TABLE dim_period (
  period TEXT PRIMARY KEY CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  display_name TEXT NOT NULL,
  year INTEGER NOT NULL,
  quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  month_number INTEGER NOT NULL CHECK (month_number BETWEEN 1 AND 12),
  sort_key INTEGER NOT NULL UNIQUE
);

CREATE TABLE dim_scenario (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  origin TEXT NOT NULL DEFAULT 'system' CHECK (origin = 'system'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dim_version (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('working', 'snapshot')),
  is_mutable INTEGER NOT NULL DEFAULT 1 CHECK (is_mutable IN (0, 1)),
  origin TEXT NOT NULL DEFAULT 'system' CHECK (origin = 'system'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dim_metric (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('base', 'calculated')),
  category TEXT NOT NULL CHECK (category IN ('profit', 'cashflow')),
  expression TEXT,
  unit TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('currency', 'percentage')),
  period_aggregation TEXT NOT NULL CHECK (period_aggregation IN ('sum', 'recompute', 'ending')),
  description TEXT NOT NULL,
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL,
  system_managed INTEGER NOT NULL DEFAULT 1 CHECK (system_managed IN (0, 1)),
  origin TEXT NOT NULL DEFAULT 'system' CHECK (origin = 'system')
);

CREATE TABLE sys_calculation_run (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES dim_scenario(id),
  version_id TEXT NOT NULL REFERENCES dim_version(id),
  run_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  config_hash TEXT NOT NULL,
  issue_count INTEGER NOT NULL DEFAULT 0,
  issues_json TEXT NOT NULL DEFAULT '[]',
  config_snapshot_json TEXT NOT NULL DEFAULT '{}',
  draft_revision INTEGER NOT NULL DEFAULT 0,
  project_snapshot_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  UNIQUE (project_id, run_number)
);

CREATE TABLE cfg_model_line (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  line_type TEXT NOT NULL CHECK (line_type IN ('parameter', 'profit', 'cash')),
  category TEXT CHECK (category IS NULL OR category IN ('revenue', 'cost', 'cash_inflow', 'cash_outflow')),
  calculation_method TEXT NOT NULL CHECK (calculation_method IN ('fixed', 'monthly_input', 'fixed_monthly', 'formula')),
  start_period TEXT NOT NULL REFERENCES dim_period(period),
  end_period TEXT NOT NULL REFERENCES dim_period(period),
  unit TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, code),
  CHECK (end_period >= start_period),
  CHECK (
    (line_type = 'parameter' AND category IS NULL)
    OR (line_type = 'profit' AND category IN ('revenue', 'cost'))
    OR (line_type = 'cash' AND category IN ('cash_inflow', 'cash_outflow'))
  )
);

CREATE TABLE cfg_model_line_value (
  line_id TEXT NOT NULL REFERENCES cfg_model_line(id) ON DELETE CASCADE,
  period TEXT NOT NULL REFERENCES dim_period(period),
  value_text TEXT NOT NULL,
  PRIMARY KEY (line_id, period)
);

CREATE TABLE cfg_forecast_override (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  forecast_line_id TEXT NOT NULL REFERENCES cfg_model_line(id) ON DELETE CASCADE,
  period TEXT NOT NULL REFERENCES dim_period(period),
  original_value_text TEXT NOT NULL,
  override_value_text TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, forecast_line_id, period)
);

CREATE TABLE fact_forecast_line_value (
  id TEXT PRIMARY KEY,
  calculation_run_id TEXT NOT NULL REFERENCES sys_calculation_run(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  forecast_line_id TEXT NOT NULL,
  line_code TEXT NOT NULL,
  line_name TEXT NOT NULL,
  line_category TEXT NOT NULL CHECK (line_category IN ('revenue', 'cost', 'cash_inflow', 'cash_outflow')),
  department_id TEXT NOT NULL REFERENCES dim_department(id),
  period TEXT NOT NULL REFERENCES dim_period(period),
  scenario_id TEXT NOT NULL REFERENCES dim_scenario(id),
  version_id TEXT NOT NULL REFERENCES dim_version(id),
  metric_code TEXT NOT NULL CHECK (metric_code IN ('revenue', 'cost', 'cash_inflow', 'cash_outflow')),
  value_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (calculation_run_id, forecast_line_id, period)
);

CREATE TABLE fact_cash_schedule_value (
  id TEXT PRIMARY KEY,
  calculation_run_id TEXT NOT NULL REFERENCES sys_calculation_run(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  source_line_id TEXT NOT NULL,
  source_line_code TEXT NOT NULL,
  source_line_name TEXT NOT NULL,
  department_id TEXT NOT NULL REFERENCES dim_department(id),
  source_period TEXT NOT NULL REFERENCES dim_period(period),
  settlement_period TEXT NOT NULL REFERENCES dim_period(period),
  scenario_id TEXT NOT NULL REFERENCES dim_scenario(id),
  version_id TEXT NOT NULL REFERENCES dim_version(id),
  metric_code TEXT NOT NULL CHECK (metric_code IN ('cash_inflow', 'cash_outflow')),
  amount_basis TEXT NOT NULL CHECK (amount_basis IN ('tax_exclusive', 'tax_inclusive', 'non_taxable')),
  tax_rate_text TEXT NOT NULL,
  net_value_text TEXT NOT NULL,
  tax_value_text TEXT NOT NULL,
  gross_value_text TEXT NOT NULL,
  settlement_ratio_text TEXT NOT NULL,
  value_text TEXT NOT NULL,
  rule_method TEXT NOT NULL CHECK (rule_method IN ('immediate', 'delayed', 'installment')),
  created_at TEXT NOT NULL
);

CREATE TABLE fact_metric_value (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  department_id TEXT NOT NULL REFERENCES dim_department(id),
  period TEXT NOT NULL REFERENCES dim_period(period),
  scenario_id TEXT NOT NULL REFERENCES dim_scenario(id),
  version_id TEXT NOT NULL REFERENCES dim_version(id),
  metric_code TEXT NOT NULL REFERENCES dim_metric(code),
  value_text TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL CHECK (origin IN ('user', 'demo')),
  dataset_id TEXT,
  calculation_run_id TEXT REFERENCES sys_calculation_run(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, department_id, period, scenario_id, version_id, metric_code)
);

CREATE INDEX idx_project_status ON dim_project(status);
CREATE INDEX idx_project_department ON dim_project(department_id);
CREATE INDEX idx_fact_project_query ON fact_metric_value(project_id, scenario_id, version_id, period);
CREATE INDEX idx_fact_forecast_line_run ON fact_forecast_line_value(calculation_run_id, forecast_line_id, period);
CREATE INDEX idx_fact_cash_schedule_run ON fact_cash_schedule_value(calculation_run_id, settlement_period);
CREATE INDEX idx_calculation_run_project ON sys_calculation_run(project_id, run_number DESC);
CREATE INDEX idx_cfg_model_line_project ON cfg_model_line(project_id, line_type, sort_order);
CREATE INDEX idx_cfg_model_line_value_line ON cfg_model_line_value(line_id, period);
CREATE INDEX idx_cfg_forecast_override_project ON cfg_forecast_override(project_id, forecast_line_id, period);
CREATE INDEX idx_reference_project ON dim_project(dataset_id);
CREATE INDEX idx_reference_fact ON fact_metric_value(dataset_id);
`
