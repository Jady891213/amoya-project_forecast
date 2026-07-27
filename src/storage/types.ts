export type StorageMode = 'persistent' | 'portable' | 'transient'

export interface StorageRuntimeInfo {
  mode: StorageMode
  label: string
  detail: string
  sqliteVersion: string
  schemaVersion: number
  persistent: boolean
}

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
