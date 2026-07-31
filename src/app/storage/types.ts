import type { StorageRuntimeInfo } from '../../shared/api'
export type { StorageMode, StorageRuntimeInfo } from '../../shared/api'

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
