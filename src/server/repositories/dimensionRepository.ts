import type { DatabaseClient } from '../../app/storage/types'
import type { PeriodDimension, Scenario } from '../../shared/domain/types'
import { ProjectRepository } from './projectRepository'

interface PeriodRow {
  period: string
  display_name: string
  year: number
  quarter: number
  month_number: number
  sort_key: number
}

export class DimensionRepository {
  private readonly projects: ProjectRepository

  constructor(private readonly database: DatabaseClient) {
    this.projects = new ProjectRepository(database)
  }

  async listPeriods(): Promise<PeriodDimension[]> {
    const rows = await this.database.query<PeriodRow>(
      "SELECT * FROM dim_period WHERE period BETWEEN '2024-01' AND '2030-12' ORDER BY sort_key",
    )
    return rows.map((row) => ({
      period: row.period,
      displayName: row.display_name,
      year: row.year,
      quarter: row.quarter,
      monthNumber: row.month_number,
      sortKey: row.sort_key,
    }))
  }

  listScenarios(): Promise<Scenario[]> {
    return this.projects.listScenarios()
  }

}
