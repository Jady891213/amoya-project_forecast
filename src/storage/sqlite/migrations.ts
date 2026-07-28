export const CURRENT_SCHEMA_VERSION = 6

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

export const SCHEMA_V2 = `
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE dim_scenario_v2 (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  origin TEXT NOT NULL DEFAULT 'system' CHECK (origin = 'system'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dim_version_v2 (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('working', 'snapshot')),
  is_mutable INTEGER NOT NULL DEFAULT 1 CHECK (is_mutable IN (0, 1)),
  origin TEXT NOT NULL DEFAULT 'system' CHECK (origin = 'system'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO dim_scenario_v2
  (id, code, name, is_default, origin, created_at, updated_at)
VALUES
  ('baseline', 'baseline', '基准场景', 1, 'system',
   '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z');

INSERT INTO dim_version_v2
  (id, code, name, status, is_mutable, origin, created_at, updated_at)
VALUES
  ('working', 'working', '工作版', 'working', 1, 'system',
   '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z');

CREATE TABLE fact_metric_value_v2 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  department_id TEXT NOT NULL REFERENCES dim_department(id),
  business_module_id TEXT NOT NULL REFERENCES dim_business_module(id) ON DELETE CASCADE,
  period TEXT NOT NULL REFERENCES dim_period(period),
  scenario_id TEXT NOT NULL REFERENCES dim_scenario_v2(id),
  version_id TEXT NOT NULL REFERENCES dim_version_v2(id),
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

INSERT INTO fact_metric_value_v2 (
  id, project_id, department_id, business_module_id, period,
  scenario_id, version_id, metric_code, value_text, source_label,
  origin, dataset_id, created_at, updated_at
)
SELECT
  id, project_id, department_id, business_module_id, period,
  'baseline', 'working', metric_code, value_text, source_label,
  origin, dataset_id, created_at, updated_at
FROM fact_metric_value;

DROP TABLE fact_metric_value;
DROP TABLE dim_scenario;
DROP TABLE dim_version;

ALTER TABLE dim_scenario_v2 RENAME TO dim_scenario;
ALTER TABLE dim_version_v2 RENAME TO dim_version;
ALTER TABLE fact_metric_value_v2 RENAME TO fact_metric_value;

CREATE INDEX idx_fact_project_query
  ON fact_metric_value(project_id, scenario_id, version_id, period);
CREATE INDEX idx_demo_fact ON fact_metric_value(dataset_id);

COMMIT;
PRAGMA foreign_keys = ON;
`

export const SCHEMA_V3 = `
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS cfg_forecast_line (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('revenue', 'cost')),
  metric_code TEXT NOT NULL CHECK (metric_code IN ('revenue', 'cost')),
  business_module_id TEXT NOT NULL REFERENCES dim_business_module(id),
  forecast_method TEXT NOT NULL CHECK (
    forecast_method IN ('monthly_input', 'fixed_monthly')
  ),
  start_period TEXT NOT NULL REFERENCES dim_period(period),
  end_period TEXT NOT NULL REFERENCES dim_period(period),
  fixed_monthly_value_text TEXT,
  assumption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, code)
);

CREATE TABLE IF NOT EXISTS cfg_forecast_value (
  line_id TEXT NOT NULL REFERENCES cfg_forecast_line(id) ON DELETE CASCADE,
  period TEXT NOT NULL REFERENCES dim_period(period),
  value_text TEXT NOT NULL,
  PRIMARY KEY (line_id, period)
);

CREATE TABLE IF NOT EXISTS sys_calculation_run (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES dim_scenario(id),
  version_id TEXT NOT NULL REFERENCES dim_version(id),
  run_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  config_hash TEXT NOT NULL,
  issue_count INTEGER NOT NULL DEFAULT 0,
  issues_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  UNIQUE (project_id, run_number)
);

CREATE TABLE IF NOT EXISTS fact_forecast_line_value (
  id TEXT PRIMARY KEY,
  calculation_run_id TEXT NOT NULL REFERENCES sys_calculation_run(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  forecast_line_id TEXT NOT NULL,
  line_code TEXT NOT NULL,
  line_name TEXT NOT NULL,
  line_category TEXT NOT NULL CHECK (line_category IN ('revenue', 'cost')),
  department_id TEXT NOT NULL REFERENCES dim_department(id),
  business_module_id TEXT NOT NULL REFERENCES dim_business_module(id),
  period TEXT NOT NULL REFERENCES dim_period(period),
  scenario_id TEXT NOT NULL REFERENCES dim_scenario(id),
  version_id TEXT NOT NULL REFERENCES dim_version(id),
  metric_code TEXT NOT NULL CHECK (metric_code IN ('revenue', 'cost')),
  value_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (calculation_run_id, forecast_line_id, period)
);

ALTER TABLE fact_metric_value ADD COLUMN calculation_run_id TEXT
  REFERENCES sys_calculation_run(id);

CREATE INDEX IF NOT EXISTS idx_cfg_forecast_line_project
  ON cfg_forecast_line(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_calculation_run_project
  ON sys_calculation_run(project_id, run_number DESC);
CREATE INDEX IF NOT EXISTS idx_fact_forecast_line_run
  ON fact_forecast_line_value(calculation_run_id, forecast_line_id, period);
COMMIT;
`

export const SCHEMA_V4 = `
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE cfg_forecast_line_v4 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('revenue', 'cost', 'cash_inflow', 'cash_outflow')
  ),
  metric_code TEXT NOT NULL CHECK (
    metric_code IN ('revenue', 'cost', 'cash_inflow', 'cash_outflow')
  ),
  business_module_id TEXT NOT NULL REFERENCES dim_business_module(id),
  forecast_method TEXT NOT NULL CHECK (
    forecast_method IN ('monthly_input', 'fixed_monthly')
  ),
  start_period TEXT NOT NULL REFERENCES dim_period(period),
  end_period TEXT NOT NULL REFERENCES dim_period(period),
  fixed_monthly_value_text TEXT,
  assumption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, code)
);

INSERT INTO cfg_forecast_line_v4
SELECT * FROM cfg_forecast_line;

CREATE TABLE fact_forecast_line_value_v4 (
  id TEXT PRIMARY KEY,
  calculation_run_id TEXT NOT NULL REFERENCES sys_calculation_run(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  forecast_line_id TEXT NOT NULL,
  line_code TEXT NOT NULL,
  line_name TEXT NOT NULL,
  line_category TEXT NOT NULL CHECK (
    line_category IN ('revenue', 'cost', 'cash_inflow', 'cash_outflow')
  ),
  department_id TEXT NOT NULL REFERENCES dim_department(id),
  business_module_id TEXT NOT NULL REFERENCES dim_business_module(id),
  period TEXT NOT NULL REFERENCES dim_period(period),
  scenario_id TEXT NOT NULL REFERENCES dim_scenario(id),
  version_id TEXT NOT NULL REFERENCES dim_version(id),
  metric_code TEXT NOT NULL CHECK (
    metric_code IN ('revenue', 'cost', 'cash_inflow', 'cash_outflow')
  ),
  value_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (calculation_run_id, forecast_line_id, period)
);

INSERT INTO fact_forecast_line_value_v4
SELECT * FROM fact_forecast_line_value;

DROP TABLE fact_forecast_line_value;
DROP TABLE cfg_forecast_line;
ALTER TABLE cfg_forecast_line_v4 RENAME TO cfg_forecast_line;
ALTER TABLE fact_forecast_line_value_v4 RENAME TO fact_forecast_line_value;

CREATE INDEX idx_cfg_forecast_line_project
  ON cfg_forecast_line(project_id, sort_order);
CREATE INDEX idx_fact_forecast_line_run
  ON fact_forecast_line_value(calculation_run_id, forecast_line_id, period);

COMMIT;
PRAGMA foreign_keys = ON;
`

export const SCHEMA_V5 = `
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS cfg_parameter (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parameter_type TEXT NOT NULL CHECK (parameter_type IN ('fixed', 'monthly')),
  value_type TEXT NOT NULL CHECK (
    value_type IN ('currency', 'quantity', 'percentage', 'number')
  ),
  unit TEXT NOT NULL DEFAULT '',
  fixed_value_text TEXT,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, code)
);

CREATE TABLE IF NOT EXISTS cfg_parameter_value (
  parameter_id TEXT NOT NULL REFERENCES cfg_parameter(id) ON DELETE CASCADE,
  period TEXT NOT NULL REFERENCES dim_period(period),
  value_text TEXT NOT NULL,
  PRIMARY KEY (parameter_id, period)
);

CREATE TABLE cfg_forecast_line_v5 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('revenue', 'cost', 'cash_inflow', 'cash_outflow')
  ),
  metric_code TEXT NOT NULL CHECK (
    metric_code IN ('revenue', 'cost', 'cash_inflow', 'cash_outflow')
  ),
  business_module_id TEXT NOT NULL REFERENCES dim_business_module(id),
  forecast_method TEXT NOT NULL CHECK (
    forecast_method IN ('monthly_input', 'fixed_monthly', 'formula')
  ),
  start_period TEXT NOT NULL REFERENCES dim_period(period),
  end_period TEXT NOT NULL REFERENCES dim_period(period),
  fixed_monthly_value_text TEXT,
  formula_expression_text TEXT,
  assumption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, code)
);

INSERT INTO cfg_forecast_line_v5 (
  id, project_id, code, name, category, metric_code,
  business_module_id, forecast_method, start_period, end_period,
  fixed_monthly_value_text, formula_expression_text, assumption,
  sort_order, created_at, updated_at
)
SELECT
  id, project_id, code, name, category, metric_code,
  business_module_id, forecast_method, start_period, end_period,
  fixed_monthly_value_text, NULL, assumption,
  sort_order, created_at, updated_at
FROM cfg_forecast_line;

DROP TABLE cfg_forecast_line;
ALTER TABLE cfg_forecast_line_v5 RENAME TO cfg_forecast_line;

ALTER TABLE sys_calculation_run
  ADD COLUMN config_snapshot_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX idx_cfg_forecast_line_project
  ON cfg_forecast_line(project_id, sort_order);
CREATE INDEX idx_cfg_parameter_project
  ON cfg_parameter(project_id, sort_order);
CREATE INDEX idx_cfg_parameter_value_parameter
  ON cfg_parameter_value(parameter_id, period);

COMMIT;
PRAGMA foreign_keys = ON;
`

export const SCHEMA_V6 = `
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE cfg_forecast_line_v6 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('revenue', 'cost', 'cash_inflow', 'cash_outflow')
  ),
  metric_code TEXT NOT NULL CHECK (
    metric_code IN ('revenue', 'cost', 'cash_inflow', 'cash_outflow')
  ),
  business_module_id TEXT NOT NULL REFERENCES dim_business_module(id),
  forecast_method TEXT NOT NULL CHECK (
    forecast_method IN ('monthly_input', 'fixed_monthly', 'formula')
  ),
  start_period TEXT NOT NULL REFERENCES dim_period(period),
  end_period TEXT NOT NULL REFERENCES dim_period(period),
  fixed_monthly_value_text TEXT,
  formula_expression_text TEXT,
  amount_basis TEXT NOT NULL DEFAULT 'tax_exclusive' CHECK (
    amount_basis IN ('tax_exclusive', 'tax_inclusive', 'non_taxable')
  ),
  tax_rate_text TEXT NOT NULL DEFAULT '0',
  assumption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, code)
);

INSERT INTO cfg_forecast_line_v6 (
  id, project_id, code, name, category, metric_code,
  business_module_id, forecast_method, start_period, end_period,
  fixed_monthly_value_text, formula_expression_text,
  amount_basis, tax_rate_text, assumption, sort_order, created_at, updated_at
)
SELECT
  id, project_id, code, name, category, metric_code,
  business_module_id, forecast_method, start_period, end_period,
  fixed_monthly_value_text, formula_expression_text,
  'tax_exclusive', '0', assumption, sort_order, created_at, updated_at
FROM cfg_forecast_line;

DROP TABLE cfg_forecast_line;
ALTER TABLE cfg_forecast_line_v6 RENAME TO cfg_forecast_line;

CREATE TABLE cfg_cash_rule (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  source_line_id TEXT NOT NULL REFERENCES cfg_forecast_line(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (
    method IN ('disabled', 'immediate', 'delayed', 'installment')
  ),
  delay_months INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, source_line_id)
);

CREATE TABLE cfg_cash_rule_installment (
  id TEXT PRIMARY KEY,
  cash_rule_id TEXT NOT NULL REFERENCES cfg_cash_rule(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  offset_months INTEGER NOT NULL,
  ratio_text TEXT NOT NULL,
  UNIQUE (cash_rule_id, sequence),
  UNIQUE (cash_rule_id, offset_months)
);

CREATE TABLE fact_cash_schedule_value (
  id TEXT PRIMARY KEY,
  calculation_run_id TEXT NOT NULL REFERENCES sys_calculation_run(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES dim_project(id) ON DELETE CASCADE,
  source_line_id TEXT NOT NULL,
  source_line_code TEXT NOT NULL,
  source_line_name TEXT NOT NULL,
  department_id TEXT NOT NULL REFERENCES dim_department(id),
  business_module_id TEXT NOT NULL REFERENCES dim_business_module(id),
  source_period TEXT NOT NULL REFERENCES dim_period(period),
  settlement_period TEXT NOT NULL REFERENCES dim_period(period),
  scenario_id TEXT NOT NULL REFERENCES dim_scenario(id),
  version_id TEXT NOT NULL REFERENCES dim_version(id),
  metric_code TEXT NOT NULL CHECK (
    metric_code IN ('cash_inflow', 'cash_outflow')
  ),
  amount_basis TEXT NOT NULL CHECK (
    amount_basis IN ('tax_exclusive', 'tax_inclusive', 'non_taxable')
  ),
  tax_rate_text TEXT NOT NULL,
  net_value_text TEXT NOT NULL,
  tax_value_text TEXT NOT NULL,
  gross_value_text TEXT NOT NULL,
  settlement_ratio_text TEXT NOT NULL,
  value_text TEXT NOT NULL,
  rule_method TEXT NOT NULL CHECK (
    rule_method IN ('immediate', 'delayed', 'installment')
  ),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_cfg_forecast_line_project
  ON cfg_forecast_line(project_id, sort_order);
CREATE INDEX idx_cfg_cash_rule_project
  ON cfg_cash_rule(project_id, source_line_id);
CREATE INDEX idx_cfg_cash_rule_installment_rule
  ON cfg_cash_rule_installment(cash_rule_id, sequence);
CREATE INDEX idx_fact_cash_schedule_run
  ON fact_cash_schedule_value(calculation_run_id, settlement_period);

COMMIT;
PRAGMA foreign_keys = ON;
`
