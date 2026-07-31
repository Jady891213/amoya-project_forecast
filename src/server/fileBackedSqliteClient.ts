import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type {
  DatabaseClient,
  SqlStatement,
  StorageRuntimeInfo,
} from '../app/storage/types'
import { CURRENT_SCHEMA_VERSION } from '../app/storage/sqlite/migrations'

const SQLITE_HEADER = 'SQLite format 3\u0000'
const VFS_DATABASE_PATH = '/amoya-project-forecast.db'
const VFS_IMPORT_PATH = '/amoya-project-forecast-import.db'

function hasSqliteHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false
  return Array.from(bytes.slice(0, 16))
    .map((byte) => String.fromCharCode(byte))
    .join('') === SQLITE_HEADER
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export class FileBackedSqliteClient implements DatabaseClient {
  private operation = Promise.resolve()

  private constructor(
    private readonly sqlite3: any,
    private database: any,
    private readonly databasePath: string,
    public readonly runtime: StorageRuntimeInfo,
  ) {}

  static async create(databasePath: string): Promise<FileBackedSqliteClient> {
    await mkdir(dirname(databasePath), { recursive: true })
    const sqlite3 = await (sqlite3InitModule as any)({
      print: () => undefined,
      printErr: (message: unknown) => console.warn('[SQLite]', message),
    })
    let database: any
    if (await exists(databasePath)) {
      const bytes = new Uint8Array(await readFile(databasePath))
      if (!hasSqliteHeader(bytes)) {
        throw new Error(`数据库文件损坏或不是 SQLite：${databasePath}`)
      }
      sqlite3.capi.sqlite3_js_posix_create_file(VFS_DATABASE_PATH, bytes)
      database = new sqlite3.oo1.DB(VFS_DATABASE_PATH, 'w')
    } else {
      database = new sqlite3.oo1.DB(':memory:', 'c')
    }
    return new FileBackedSqliteClient(sqlite3, database, databasePath, {
      mode: 'persistent',
      label: '本地服务',
      detail: `${basename(databasePath)} · 自动保存`,
      sqliteVersion: sqlite3.version.libVersion,
      schemaVersion: 0,
      persistent: true,
    })
  }

  private runExclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(() => undefined, () => undefined)
    return result
  }

  private async persistNow(): Promise<void> {
    const bytes = this.sqlite3.capi.sqlite3_js_db_export(this.database)
    const temporaryPath = `${this.databasePath}.tmp`
    await writeFile(temporaryPath, bytes)
    try {
      await rename(temporaryPath, this.databasePath)
    } catch (reason) {
      await writeFile(this.databasePath, bytes)
      await unlink(temporaryPath).catch(() => undefined)
      if (!await exists(this.databasePath)) throw reason
    }
  }

  async flush(): Promise<void> {
    await this.runExclusive(() => this.persistNow())
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.runExclusive(() => {
      const rows: T[] = []
      this.database.exec({
        sql,
        bind: params,
        rowMode: 'object',
        callback: (row: T) => { rows.push(row) },
      })
      return rows
    })
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.runExclusive(async () => {
      this.database.exec({ sql, bind: params })
      await this.persistNow()
    })
  }

  async batch(statements: SqlStatement[]): Promise<void> {
    await this.runExclusive(async () => {
      this.database.exec('BEGIN IMMEDIATE')
      try {
        statements.forEach((statement) =>
          this.database.exec({
            sql: statement.sql,
            bind: statement.params ?? [],
          }),
        )
        this.database.exec('COMMIT')
      } catch (reason) {
        this.database.exec('ROLLBACK')
        throw reason
      }
      await this.persistNow()
    })
  }

  async exportDatabase(): Promise<Uint8Array> {
    return this.runExclusive(() =>
      this.sqlite3.capi.sqlite3_js_db_export(this.database),
    )
  }

  async importDatabase(bytes: Uint8Array): Promise<void> {
    await this.runExclusive(async () => {
      if (!hasSqliteHeader(bytes)) {
        throw new Error('所选文件不是有效的 SQLite 数据库')
      }
      this.sqlite3.capi.sqlite3_js_posix_create_file(VFS_IMPORT_PATH, bytes)
      const validationDatabase = new this.sqlite3.oo1.DB(VFS_IMPORT_PATH, 'r')
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

      const previousBytes = this.sqlite3.capi.sqlite3_js_db_export(this.database)
      this.database.close()
      try {
        this.sqlite3.capi.sqlite3_js_posix_create_file(VFS_DATABASE_PATH, bytes)
        this.database = new this.sqlite3.oo1.DB(VFS_DATABASE_PATH, 'w')
        await this.persistNow()
      } catch (reason) {
        this.sqlite3.capi.sqlite3_js_posix_create_file(
          VFS_DATABASE_PATH,
          previousBytes,
        )
        this.database = new this.sqlite3.oo1.DB(VFS_DATABASE_PATH, 'w')
        throw reason
      }
    })
  }

  async close(): Promise<void> {
    await this.runExclusive(async () => {
      await this.persistNow()
      this.database.close()
    })
  }
}
