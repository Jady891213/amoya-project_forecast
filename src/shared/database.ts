import type { StorageRuntimeInfo } from './api'

export const DATABASE_FILE_NAME = 'amoya_project_forecast.db'

export type { StorageMode, StorageRuntimeInfo } from './api'

export interface SqlStatement {
  sql: string
  params?: unknown[]
}

export interface DatabaseClient {
  readonly runtime: StorageRuntimeInfo
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<void>
  batch(statements: SqlStatement[]): Promise<void>
  exportDatabase(): Promise<Uint8Array>
  importDatabase(bytes: Uint8Array): Promise<void>
  close(): Promise<void>
}
