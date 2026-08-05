import type { DatabaseClient } from '../../shared/database'

export class MetadataRepository {
  constructor(private readonly database: DatabaseClient) {}

  async get(key: string): Promise<string | undefined> {
    const rows = await this.database.query<{ value: string }>(
      'SELECT value FROM sys_app_metadata WHERE key = ?',
      [key],
    )
    return rows[0]?.value
  }

  async set(key: string, value: string): Promise<void> {
    await this.database.execute(
      `INSERT INTO sys_app_metadata (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, new Date().toISOString()],
    )
  }
}
