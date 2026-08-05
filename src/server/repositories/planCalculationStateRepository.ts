import type { CalculationIssue, PlanCalculationState } from '../../shared/domain/types'
import type { DatabaseClient, SqlStatement } from '../../shared/database'

interface StateRow {
  project_id: string
  plan_id: string
  last_status: PlanCalculationState['lastStatus']
  last_attempt_at: string
  last_success_at: string | null
  last_success_config_hash: string | null
  calculated_draft_revision: number
  result_revision: number
  issues_json: string
}

function fromRow(row: StateRow): PlanCalculationState {
  return {
    projectId: row.project_id,
    planId: row.plan_id,
    lastStatus: row.last_status,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at ?? undefined,
    lastSuccessConfigHash: row.last_success_config_hash ?? undefined,
    calculatedDraftRevision: row.calculated_draft_revision,
    resultRevision: row.result_revision,
    issues: JSON.parse(row.issues_json) as CalculationIssue[],
  }
}

export function calculationStateUpsert(state: PlanCalculationState): SqlStatement {
  return {
    sql: `INSERT INTO sys_plan_calculation_state (
      project_id, plan_id, last_status, last_attempt_at, last_success_at,
      last_success_config_hash, calculated_draft_revision, result_revision, issues_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, plan_id) DO UPDATE SET
      last_status = excluded.last_status,
      last_attempt_at = excluded.last_attempt_at,
      last_success_at = excluded.last_success_at,
      last_success_config_hash = excluded.last_success_config_hash,
      calculated_draft_revision = excluded.calculated_draft_revision,
      result_revision = excluded.result_revision,
      issues_json = excluded.issues_json`,
    params: [
      state.projectId,
      state.planId,
      state.lastStatus,
      state.lastAttemptAt,
      state.lastSuccessAt ?? null,
      state.lastSuccessConfigHash ?? null,
      state.calculatedDraftRevision,
      state.resultRevision,
      JSON.stringify(state.issues),
    ],
  }
}

export class PlanCalculationStateRepository {
  constructor(private readonly database: DatabaseClient) {}

  async get(projectId: string, planId: string): Promise<PlanCalculationState | undefined> {
    const rows = await this.database.query<StateRow>(
      'SELECT * FROM sys_plan_calculation_state WHERE project_id = ? AND plan_id = ?',
      [projectId, planId],
    )
    return rows[0] ? fromRow(rows[0]) : undefined
  }

  async save(state: PlanCalculationState): Promise<void> {
    const statement = calculationStateUpsert(state)
    await this.database.execute(statement.sql, statement.params)
  }
}
