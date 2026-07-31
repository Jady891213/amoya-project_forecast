import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { DatabaseClient, SqlStatement, StorageRuntimeInfo } from '../storage/types'

export class NodeSqliteClient implements DatabaseClient {
  private constructor(
    private readonly sqlite3: any,
    private database: any,
    public readonly runtime: StorageRuntimeInfo,
  ) {}

  static async create(): Promise<NodeSqliteClient> {
    const sqlite3 = await (sqlite3InitModule as any)({
      print: () => undefined,
      printErr: () => undefined,
    })
    return new NodeSqliteClient(sqlite3, new sqlite3.oo1.DB(':memory:', 'c'), {
      mode: 'transient',
      label: '测试内存库',
      detail: 'Vitest',
      sqliteVersion: sqlite3.version.libVersion,
      schemaVersion: 0,
      persistent: false,
    })
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows: T[] = []
    this.database.exec({
      sql,
      bind: params,
      rowMode: 'object',
      callback: (row: T) => { rows.push(row) },
    })
    return rows
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.database.exec({ sql, bind: params })
  }

  async batch(statements: SqlStatement[]): Promise<void> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      statements.forEach((statement) =>
        this.database.exec({ sql: statement.sql, bind: statement.params ?? [] }),
      )
      this.database.exec('COMMIT')
    } catch (reason) {
      this.database.exec('ROLLBACK')
      throw reason
    }
  }

  async exportDatabase(): Promise<Uint8Array> {
    return this.sqlite3.capi.sqlite3_js_db_export(this.database)
  }

  async importDatabase(bytes: Uint8Array): Promise<void> {
    this.database.close()
    const filename = `/test-import-${crypto.randomUUID()}.sqlite3`
    this.sqlite3.capi.sqlite3_js_posix_create_file(filename, bytes)
    this.database = new this.sqlite3.oo1.DB(filename, 'w')
  }

  async close(): Promise<void> {
    this.database.close()
  }
}
