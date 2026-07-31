/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { SqliteRequest, SqliteResponse } from './protocol'
import type { StorageRuntimeInfo } from '../types'
import { CURRENT_SCHEMA_VERSION } from './migrations'

const scope = self as unknown as DedicatedWorkerGlobalScope
const DATABASE_FILENAME = '/project-forecast-p0.sqlite3'

let sqlite3: any
let database: any
let runtime: StorageRuntimeInfo
let portable = false

function send(response: SqliteResponse, transfer: Transferable[] = []) {
  scope.postMessage(response, transfer)
}

function objectRows(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  database.exec({
    sql,
    bind: params as any,
    rowMode: 'object',
    callback: (row: unknown) => {
      rows.push(row as Record<string, unknown>)
    },
  })
  return rows
}

function execute(sql: string, params: unknown[] = []) {
  database.exec({ sql, bind: params as any })
}

async function openDatabase(isPortable: boolean) {
  portable = isPortable
  sqlite3 = await (sqlite3InitModule as any)({
    print: () => undefined,
    printErr: (message: unknown) => console.warn('[SQLite WASM]', message),
  })

  if (!portable && sqlite3.oo1.OpfsDb) {
    try {
      database = new sqlite3.oo1.OpfsDb(DATABASE_FILENAME, 'c')
      runtime = {
        mode: 'persistent',
        label: 'SQLite 本地库',
        detail: 'OPFS 自动持久化',
        sqliteVersion: sqlite3.version.libVersion,
        schemaVersion: 0,
        persistent: true,
      }
      return
    } catch (reason) {
      console.warn('[SQLite WASM] OPFS unavailable, using transient database', reason)
    }
  }

  database = new sqlite3.oo1.DB(':memory:', 'c')
  runtime = {
    mode: portable ? 'portable' : 'transient',
    label: portable ? '便携模式' : '临时 SQLite',
    detail: portable ? '关闭前请导出数据库文件' : '当前浏览器不支持 OPFS',
    sqliteVersion: sqlite3.version.libVersion,
    schemaVersion: 0,
    persistent: false,
  }
}

async function importDatabase(bytes: Uint8Array) {
  const validationFilename = `/validate-import-${Date.now()}.sqlite3`
  sqlite3.capi.sqlite3_js_posix_create_file(validationFilename, bytes)
  const validationDatabase = new sqlite3.oo1.DB(validationFilename, 'r')
  try {
    const versions: number[] = []
    validationDatabase.exec({
      sql: 'SELECT MAX(version) FROM sys_schema_migration',
      rowMode: 0,
      callback: (row: unknown[]) => {
        versions.push(Number(row[0]))
      },
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

  const previousBytes = sqlite3.capi.sqlite3_js_db_export(database)
  database?.close()
  if (!portable && sqlite3.oo1.OpfsDb) {
    try {
      await sqlite3.oo1.OpfsDb.importDb(DATABASE_FILENAME, bytes)
      database = new sqlite3.oo1.OpfsDb(DATABASE_FILENAME, 'c')
    } catch (reason) {
      await sqlite3.oo1.OpfsDb.importDb(DATABASE_FILENAME, previousBytes)
      database = new sqlite3.oo1.OpfsDb(DATABASE_FILENAME, 'c')
      throw reason
    }
    return
  }

  const filename = '/portable-import.sqlite3'
  try {
    sqlite3.capi.sqlite3_js_posix_create_file(filename, bytes)
    database = new sqlite3.oo1.DB(filename, 'w')
  } catch (reason) {
    sqlite3.capi.sqlite3_js_posix_create_file(filename, previousBytes)
    database = new sqlite3.oo1.DB(filename, 'w')
    throw reason
  }
}

scope.onmessage = async (event: MessageEvent<SqliteRequest>) => {
  const request = event.data
  try {
    switch (request.type) {
      case 'init':
        await openDatabase(request.portable)
        send({ id: request.id, ok: true, runtime })
        return
      case 'query':
        send({
          id: request.id,
          ok: true,
          value: objectRows(request.sql, request.params),
        })
        return
      case 'execute':
        execute(request.sql, request.params)
        send({ id: request.id, ok: true })
        return
      case 'batch':
        execute('BEGIN IMMEDIATE')
        try {
          request.statements.forEach((statement) =>
            execute(statement.sql, statement.params),
          )
          execute('COMMIT')
        } catch (reason) {
          execute('ROLLBACK')
          throw reason
        }
        send({ id: request.id, ok: true })
        return
      case 'export': {
        const bytes = sqlite3.capi.sqlite3_js_db_export(database)
        send({ id: request.id, ok: true, value: bytes }, [bytes.buffer])
        return
      }
      case 'import':
        await importDatabase(request.bytes)
        send({ id: request.id, ok: true })
        return
      case 'close':
        database?.close()
        send({ id: request.id, ok: true })
        scope.close()
        return
    }
  } catch (reason) {
    send({
      id: request.id,
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    })
  }
}
