export const CURRENT_SCHEMA_VERSION = 1

export const SCHEMA_V1 = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sys_schema_migration (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sys_app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_department (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  origin TEXT NOT NULL CHECK (origin IN ('system', 'user', 'demo')),
  dataset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_project (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  customer TEXT NOT NULL DEFAULT '',
  department_id TEXT NOT NULL REFERENCES dim_department(id) ON UPDATE CASCADE,
  owner TEXT NOT NULL DEFAULT '',
  start_period TEXT NOT NULL CHECK (start_period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  duration_months INTEGER NOT NULL CHECK (duration_months BETWEEN 1 AND 36),
  status TEXT NOT NULL CHECK (status IN ('calculating', 'archived')),
  remark TEXT NOT NULL DEFAULT '',
  attributes_json TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('system', 'user', 'demo')),
  dataset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_business_module (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_common INTEGER NOT NULL DEFAULT 0 CHECK (is_common IN (0, 1)),
  origin TEXT NOT NULL CHECK (origin IN ('system', 'user', 'demo')),
  dataset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, code)
);

CREATE TABLE IF NOT EXISTS dim_period (
  period TEXT PRIMARY KEY CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  display_name TEXT NOT NULL,
  year INTEGER NOT NULL,
  quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  month_number INTEGER NOT NULL CHECK (month_number BETWEEN 1 AND 12),
  sort_key INTEGER NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS dim_scenario (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  origin TEXT NOT NULL CHECK (origin IN ('system', 'user', 'demo')),
  dataset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, code)
);

CREATE TABLE IF NOT EXISTS dim_version (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('working', 'snapshot')),
  is_mutable INTEGER NOT NULL DEFAULT 1 CHECK (is_mutable IN (0, 1)),
  origin TEXT NOT NULL CHECK (origin IN ('system', 'user', 'demo')),
  dataset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, code)
);

CREATE TABLE IF NOT EXISTS dim_metric (
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

CREATE TABLE IF NOT EXISTS fact_metric_value (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  department_id TEXT NOT NULL REFERENCES dim_department(id),
  business_module_id TEXT NOT NULL REFERENCES dim_business_module(id) ON DELETE CASCADE,
  period TEXT NOT NULL REFERENCES dim_period(period),
  scenario_id TEXT NOT NULL REFERENCES dim_scenario(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES dim_version(id) ON DELETE CASCADE,
  metric_code TEXT NOT NULL REFERENCES dim_metric(code),
  value_text TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL CHECK (origin IN ('user', 'demo')),
  dataset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (
    project_id,
    department_id,
    business_module_id,
    period,
    scenario_id,
    version_id,
    metric_code
  )
);

CREATE INDEX IF NOT EXISTS idx_project_status ON dim_project(status);
CREATE INDEX IF NOT EXISTS idx_project_department ON dim_project(department_id);
CREATE INDEX IF NOT EXISTS idx_module_project ON dim_business_module(project_id);
CREATE INDEX IF NOT EXISTS idx_scenario_project ON dim_scenario(project_id);
CREATE INDEX IF NOT EXISTS idx_version_project ON dim_version(project_id);
CREATE INDEX IF NOT EXISTS idx_fact_project_query
  ON fact_metric_value(project_id, scenario_id, version_id, period);
CREATE INDEX IF NOT EXISTS idx_demo_project ON dim_project(dataset_id);
CREATE INDEX IF NOT EXISTS idx_demo_fact ON fact_metric_value(dataset_id);
`
