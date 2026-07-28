import type {
  CalculationRun,
} from '../domain/types'
import type { DatabaseClient, SqlStatement } from '../storage/types'

interface CalculationRunRow {
  id: string
  project_id: string
  scenario_id: string
  version_id: string
  run_number: number
  status: CalculationRun['status']
  config_hash: string
  issue_count: number
  issues_json: string
  config_snapshot_json: string
  started_at: string
  completed_at: string
}

function fromRow(row: CalculationRunRow): CalculationRun {
  return {
    id: row.id,
    projectId: row.project_id,
    scenarioId: row.scenario_id,
    versionId: row.version_id,
    runNumber: row.run_number,
    status: row.status,
    configHash: row.config_hash,
    issueCount: row.issue_count,
    issues: JSON.parse(row.issues_json),
    configSnapshotJson: row.config_snapshot_json,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

export function calculationRunInsert(run: CalculationRun): SqlStatement {
  return {
    sql: `INSERT INTO sys_calculation_run (
      id, project_id, scenario_id, version_id, run_number, status,
      config_hash, issue_count, issues_json, started_at, completed_at
      , config_snapshot_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      run.id,
      run.projectId,
      run.scenarioId,
      run.versionId,
      run.runNumber,
      run.status,
      run.configHash,
      run.issueCount,
      JSON.stringify(run.issues),
      run.startedAt,
      run.completedAt,
      run.configSnapshotJson,
    ],
  }
}

export class CalculationRunRepository {
  constructor(private readonly database: DatabaseClient) {}

  async nextRunNumber(projectId: string): Promise<number> {
    const rows = await this.database.query<{ next_number: number }>(
      `SELECT COALESCE(MAX(run_number), 0) + 1 AS next_number
       FROM sys_calculation_run WHERE project_id = ?`,
      [projectId],
    )
    return rows[0]?.next_number ?? 1
  }

  async latest(projectId: string): Promise<CalculationRun | undefined> {
    const rows = await this.database.query<CalculationRunRow>(
      `SELECT * FROM sys_calculation_run
       WHERE project_id = ?
       ORDER BY run_number DESC LIMIT 1`,
      [projectId],
    )
    return rows[0] ? fromRow(rows[0]) : undefined
  }

  async latestSuccess(projectId: string): Promise<CalculationRun | undefined> {
    const rows = await this.database.query<CalculationRunRow>(
      `SELECT * FROM sys_calculation_run
       WHERE project_id = ? AND status = 'success'
       ORDER BY run_number DESC LIMIT 1`,
      [projectId],
    )
    return rows[0] ? fromRow(rows[0]) : undefined
  }

  async save(run: CalculationRun): Promise<void> {
    const statement = calculationRunInsert(run)
    await this.database.execute(statement.sql, statement.params)
  }
}
