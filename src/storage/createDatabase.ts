import type { DatabaseClient } from './types'
import { initializeSqliteDatabase } from './sqlite/initialize'
import { RemoteDatabaseClient } from './remoteClient'

declare const __PORTABLE_MODE__: boolean
declare const __SERVICE_MODE__: boolean

export async function createDatabase(): Promise<DatabaseClient> {
  if (__SERVICE_MODE__) {
    return RemoteDatabaseClient.create()
  }
  const database = __PORTABLE_MODE__
    ? await (await import('./sqlite/portableClient')).PortableSqliteClient.create()
    : await (await import('./sqlite/workerClient')).SqliteWorkerClient.create(false)
  await initializeSqliteDatabase(database)
  return database
}
