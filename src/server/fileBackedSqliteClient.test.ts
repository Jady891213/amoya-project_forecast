import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileBackedSqliteClient } from './fileBackedSqliteClient'
import { initializeSqliteDatabase } from '../app/storage/sqlite/initialize'

let temporaryDirectory = ''

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true })
    temporaryDirectory = ''
  }
})

describe('FileBackedSqliteClient', () => {
  it('每次写入后同步标准DB文件并可在重启后恢复', async () => {
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'amoya-project-forecast-TMP-to-delete-'),
    )
    const databasePath = join(temporaryDirectory, 'amoya_project_forecast.db')
    const database = await FileBackedSqliteClient.create(databasePath)
    await initializeSqliteDatabase(database)
    await database.execute(
      `INSERT OR REPLACE INTO sys_app_metadata (key, value, updated_at)
       VALUES ('test:persistence', 'saved', ?)`,
      [new Date().toISOString()],
    )
    const bytes = await readFile(databasePath)
    expect(bytes.subarray(0, 16).toString()).toBe('SQLite format 3\u0000')
    await database.close()

    const reopened = await FileBackedSqliteClient.create(databasePath)
    const rows = await reopened.query<{ value: string }>(
      `SELECT value FROM sys_app_metadata WHERE key = 'test:persistence'`,
    )
    expect(rows).toEqual([{ value: 'saved' }])
    await reopened.close()
  })
})
