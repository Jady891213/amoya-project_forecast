import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { DatabaseClient, SqlStatement, StorageRuntimeInfo } from '../types'
import { CURRENT_SCHEMA_VERSION } from './migrations'

export class PortableSqliteClient implements DatabaseClient {
  private constructor(
    private readonly sqlite3: any,
    private database: any,
    public readonly runtime: StorageRuntimeInfo,
  ) {}

  static async create(): Promise<PortableSqliteClient> {
    const sqlite3 = await (sqlite3InitModule as any)({
      print: () => undefined,
      printErr: (message: unknown) => console.warn('[SQLite WASM]', message),
    })
    return new PortableSqliteClient(
      sqlite3,
      new sqlite3.oo1.DB(':memory:', 'c'),
      {
        mode: 'portable',
        label: '便携模式',
        detail: '关闭前请导出数据库文件',
        sqliteVersion: sqlite3.version.libVersion,
        schemaVersion: 0,
        persistent: false,
      },
    )
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
    const validationFilename = `/validate-import-${Date.now()}.sqlite3`
    this.sqlite3.capi.sqlite3_js_posix_create_file(validationFilename, bytes)
    const validationDatabase = new this.sqlite3.oo1.DB(validationFilename, 'r')
    try {
      const versions: number[] = []
      validationDatabase.exec({
        sql: 'SELECT MAX(version) FROM sys_schema_migration',
        rowMode: 0,
        callback: (value: unknown) => { versions.push(Number(value)) },
      })
      if (
        !Number.isInteger(versions[0]) ||
        versions[0] < 1 ||
        versions[0] > CURRENT_SCHEMA_VERSION
      ) {
        throw new Error('数据库结构版本不受当前应用支持')
      }
    } finally {
      validationDatabase.close()
    }

    const filename = '/portable-import.sqlite3'
    const previousBytes = await this.exportDatabase()
    this.database.close()
    try {
      this.sqlite3.capi.sqlite3_js_posix_create_file(filename, bytes)
      this.database = new this.sqlite3.oo1.DB(filename, 'w')
    } catch (reason) {
      this.sqlite3.capi.sqlite3_js_posix_create_file(filename, previousBytes)
      this.database = new this.sqlite3.oo1.DB(filename, 'w')
      throw reason
    }
  }

  async close(): Promise<void> {
    this.database.close()
  }
}
