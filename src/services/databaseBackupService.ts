import type { DatabaseClient } from '../storage/types'
import { CURRENT_SCHEMA_VERSION } from '../storage/sqlite/migrations'
import { initializeSqliteDatabase } from '../storage/sqlite/initialize'

const SQLITE_HEADER = 'SQLite format 3\u0000'

function hasSqliteHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false
  return Array.from(bytes.slice(0, 16))
    .map((byte) => String.fromCharCode(byte))
    .join('') === SQLITE_HEADER
}

export class DatabaseBackupService {
  constructor(private readonly database: DatabaseClient) {}

  async download(): Promise<void> {
    const bytes = await this.database.exportDatabase()
    const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.sqlite3' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `项目测算数据_${new Date().toISOString().slice(0, 10)}.sqlite3`
    link.click()
    URL.revokeObjectURL(url)
  }

  async restore(file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!hasSqliteHeader(bytes)) throw new Error('所选文件不是有效的 SQLite 数据库')
    await this.database.importDatabase(bytes)
    const rows = await this.database.query<{ version: number }>(
      'SELECT MAX(version) AS version FROM sys_schema_migration',
    )
    if (!rows[0]?.version || rows[0].version > CURRENT_SCHEMA_VERSION) {
      throw new Error('数据库结构版本不受当前应用支持')
    }
    await initializeSqliteDatabase(this.database)
  }
}
