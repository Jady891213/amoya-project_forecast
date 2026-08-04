import type { ProjectVersion } from '../../shared/domain/types'
import type { DatabaseClient, SqlStatement } from '../../app/storage/types'

interface ProjectVersionRow {
  project_id: string
  version_id: string
  code: string
  display_name: string
  relation_status: ProjectVersion['status']
  is_default: number
  sort_order: number
  draft_revision: number
  relation_created_at: string
  relation_updated_at: string
}

function fromRow(row: ProjectVersionRow): ProjectVersion {
  return {
    projectId: row.project_id,
    versionId: row.version_id,
    code: row.code,
    name: row.display_name,
    status: row.relation_status,
    isDefault: Boolean(row.is_default),
    sortOrder: row.sort_order,
    draftRevision: row.draft_revision,
    createdAt: row.relation_created_at,
    updatedAt: row.relation_updated_at,
  }
}

export class ProjectVersionRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(projectId: string): Promise<ProjectVersion[]> {
    const rows = await this.database.query<ProjectVersionRow>(
      `SELECT relation.project_id, relation.version_id, version.code,
              relation.display_name, relation.status AS relation_status,
              relation.is_default, relation.sort_order, relation.draft_revision,
              relation.created_at AS relation_created_at,
              relation.updated_at AS relation_updated_at
       FROM rel_project_version relation
       JOIN dim_version version ON version.id = relation.version_id
       WHERE relation.project_id = ?
       ORDER BY relation.status, relation.sort_order, relation.created_at`,
      [projectId],
    )
    return rows.map(fromRow)
  }

  async get(projectId: string, versionId: string): Promise<ProjectVersion | undefined> {
    return (await this.list(projectId)).find((item) => item.versionId === versionId)
  }

  async ensureDefault(projectId: string): Promise<ProjectVersion> {
    const existing = await this.list(projectId)
    if (existing.length) return existing.find((item) => item.isDefault) ?? existing[0]
    const now = new Date().toISOString()
    await this.database.execute(
      `INSERT INTO rel_project_version (
        project_id, version_id, display_name, status, is_default,
        sort_order, draft_revision, created_at, updated_at
      ) VALUES (?, 'working', '基准方案', 'active', 1, 1, 0, ?, ?)`,
      [projectId, now, now],
    )
    return (await this.get(projectId, 'working'))!
  }

  async enable(projectId: string, versionId: string): Promise<ProjectVersion> {
    const members = await this.database.query<{ id: string; name: string }>(
      `SELECT id, name FROM dim_version
       WHERE id = ? AND origin = 'system' AND status = 'working'`,
      [versionId],
    )
    const member = members[0]
    if (!member) throw Object.assign(new Error('请选择系统预置版本'), { code: 'INVALID_REQUEST' })
    const existing = await this.list(projectId)
    if (existing.some((item) => item.versionId === versionId)) {
      throw Object.assign(new Error(`版本“${member.name}”已在当前项目中启用`), { code: 'INVALID_REQUEST' })
    }
    const now = new Date().toISOString()
    const fixedSortOrder: Record<string, number> = { version_1: 2, version_2: 3, version_3: 4 }
    const sortOrder = fixedSortOrder[versionId] ?? existing.length + 1
    await this.database.execute(
      `INSERT INTO rel_project_version (
        project_id, version_id, display_name, status, is_default,
        sort_order, draft_revision, created_at, updated_at
      ) VALUES (?, ?, ?, 'active', 0, ?, 0, ?, ?)`,
      [projectId, versionId, member.name, sortOrder, now, now],
    )
    return (await this.get(projectId, versionId))!
  }

  async setStatus(projectId: string, versionId: string, status: ProjectVersion['status']): Promise<ProjectVersion> {
    const current = await this.get(projectId, versionId)
    if (!current) throw Object.assign(new Error('项目版本不存在'), { code: 'NOT_FOUND' })
    if (current.isDefault && status === 'inactive') {
      throw Object.assign(new Error('基准方案不能停用'), { code: 'INVALID_REQUEST' })
    }
    await this.database.execute(
      `UPDATE rel_project_version SET status = ?, updated_at = ?
       WHERE project_id = ? AND version_id = ?`,
      [status, new Date().toISOString(), projectId, versionId],
    )
    return (await this.get(projectId, versionId))!
  }

  async assertRevision(projectId: string, versionId: string, expectedRevision: number): Promise<ProjectVersion> {
    const current = await this.get(projectId, versionId)
    if (!current) throw Object.assign(new Error('项目版本不存在'), { code: 'NOT_FOUND' })
    if (current.draftRevision !== expectedRevision) {
      throw Object.assign(new Error('当前版本已在其他页面更新，请刷新后重试'), {
        code: 'REVISION_CONFLICT',
        currentRevision: current.draftRevision,
      })
    }
    return current
  }

  incrementRevisionStatement(projectId: string, versionId: string): SqlStatement {
    return {
      sql: `UPDATE rel_project_version
            SET draft_revision = draft_revision + 1, updated_at = ?
            WHERE project_id = ? AND version_id = ?`,
      params: [new Date().toISOString(), projectId, versionId],
    }
  }
}
