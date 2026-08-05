import type { DatabaseClient } from '../../shared/database'
import type { Department, DepartmentInput } from '../../shared/domain/types'

interface DepartmentRow {
  id: string
  code: string
  name: string
  status: Department['status']
  origin: Department['origin']
  dataset_id: string | null
  created_at: string
  updated_at: string
}

function fromRow(row: DepartmentRow): Department {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    origin: row.origin,
    datasetId: row.dataset_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class DepartmentRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(): Promise<Department[]> {
    const rows = await this.database.query<DepartmentRow>(
      `SELECT * FROM dim_department
       ORDER BY CASE origin WHEN 'user' THEN 0 ELSE 1 END, code`,
    )
    return rows.map(fromRow)
  }

  async get(id: string): Promise<Department | undefined> {
    const rows = await this.database.query<DepartmentRow>(
      'SELECT * FROM dim_department WHERE id = ?',
      [id],
    )
    return rows[0] ? fromRow(rows[0]) : undefined
  }

  async save(input: DepartmentInput): Promise<Department> {
    const code = input.code.trim().toUpperCase()
    const name = input.name.trim()
    if (!code) throw new Error('部门编码不能为空')
    if (!name) throw new Error('部门名称不能为空')

    const duplicate = await this.database.query<{ id: string }>(
      'SELECT id FROM dim_department WHERE code = ? AND id <> ?',
      [code, input.id ?? ''],
    )
    if (duplicate.length > 0) throw new Error(`部门编码“${code}”已存在`)

    const existing = input.id ? await this.get(input.id) : undefined
    if (existing?.origin === 'demo') throw new Error('演示部门为只读数据')

    const now = new Date().toISOString()
    const department: Department = {
      id: existing?.id ?? crypto.randomUUID(),
      code,
      name,
      status: input.status ?? existing?.status ?? 'active',
      origin: 'user',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await this.database.execute(
      `INSERT INTO dim_department
        (id, code, name, status, origin, dataset_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code, name = excluded.name,
         status = excluded.status, updated_at = excluded.updated_at`,
      [
        department.id,
        department.code,
        department.name,
        department.status,
        department.origin,
        department.createdAt,
        department.updatedAt,
      ],
    )
    return department
  }

  async setStatus(id: string, status: Department['status']): Promise<Department> {
    const department = await this.get(id)
    if (!department) throw new Error('部门不存在')
    if (department.origin === 'demo') throw new Error('演示部门为只读数据')
    const updatedAt = new Date().toISOString()
    await this.database.execute(
      'UPDATE dim_department SET status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, id],
    )
    return { ...department, status, updatedAt }
  }
}
