import type { DatabaseClient } from './types'
import { initializeSqliteDatabase } from './sqlite/initialize'

declare const __PORTABLE_MODE__: boolean

export async function createDatabase(): Promise<DatabaseClient> {
  const database = __PORTABLE_MODE__
    ? await (await import('./sqlite/portableClient')).PortableSqliteClient.create()
    : await (await import('./sqlite/workerClient')).SqliteWorkerClient.create(false)
  await initializeSqliteDatabase(database)
  return database
}
