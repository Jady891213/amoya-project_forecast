import type { SqlStatement, StorageRuntimeInfo } from '../types'

export type SqliteRequest =
  | { id: number; type: 'init'; portable: boolean }
  | { id: number; type: 'query'; sql: string; params?: unknown[] }
  | { id: number; type: 'execute'; sql: string; params?: unknown[] }
  | { id: number; type: 'batch'; statements: SqlStatement[] }
  | { id: number; type: 'export' }
  | { id: number; type: 'import'; bytes: Uint8Array }
  | { id: number; type: 'close' }

export type SqliteResponse =
  | {
      id: number
      ok: true
      value?: unknown
      runtime?: StorageRuntimeInfo
    }
  | { id: number; ok: false; error: string }
