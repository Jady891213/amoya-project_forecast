import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { FileBackedSqliteClient } from './fileBackedSqliteClient'
import { initializeSqliteDatabase } from '../app/storage/sqlite/initialize'
import type { SqlStatement } from '../app/storage/types'

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(sourceRoot, '..')
const staticRoot = resolve(workspaceRoot, 'output/web')
const databasePath = resolve(
  process.env.AMOYA_DB_PATH || resolve(workspaceRoot, 'data/amoya_project_forecast.db'),
)
const host = '127.0.0.1'
const port = Number(process.env.AMOYA_PORT || 4173)
const baseUrl = `http://${host}:${port}`
const token = randomBytes(24).toString('hex')
const MAX_JSON_BODY = 10 * 1024 * 1024
const MAX_DATABASE_BODY = 100 * 1024 * 1024

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : '本地服务处理失败'
}

async function readBody(request: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new Error('请求内容超过允许大小')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function requestIsTrusted(request: IncomingMessage): boolean {
  if (request.headers['x-amoya-token'] !== token) return false
  const origin = request.headers.origin
  if (origin && origin !== baseUrl) return false
  const fetchSite = request.headers['sec-fetch-site']
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none'
}

function openBrowser(url: string) {
  if (process.env.AMOYA_NO_OPEN === '1') return
  const command = process.platform === 'darwin'
    ? ['open', [url]] as const
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]] as const
      : ['xdg-open', [url]] as const
  const child = spawn(command[0], command[1], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

async function serveStatic(pathname: string, response: ServerResponse) {
  const requested = pathname === '/' ? '/index.html' : pathname
  const filePath = resolve(staticRoot, `.${requested}`)
  const relativePath = relative(staticRoot, filePath)
  if (relativePath.startsWith('..') || relativePath === '') {
    sendJson(response, 403, { error: '禁止访问该路径' })
    return
  }
  let selectedPath = filePath
  try {
    const info = await stat(selectedPath)
    if (!info.isFile()) throw new Error('not file')
  } catch {
    selectedPath = resolve(staticRoot, 'index.html')
  }
  const bytes = await readFile(selectedPath)
  response.writeHead(200, {
    'content-type': contentTypes[extname(selectedPath)] || 'application/octet-stream',
    'cache-control': basename(selectedPath) === 'index.html'
      ? 'no-store'
      : 'public, max-age=31536000, immutable',
  })
  response.end(bytes)
}

async function main() {
  const database = await FileBackedSqliteClient.create(databasePath)
  await initializeSqliteDatabase(database)
  await database.flush()

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', baseUrl)
      if (url.pathname === '/api/health') {
        sendJson(response, 200, { ok: true, database: basename(databasePath) })
        return
      }
      if (url.pathname === '/api/runtime') {
        sendJson(response, 200, { token, runtime: database.runtime })
        return
      }
      if (url.pathname.startsWith('/api/')) {
        if (!requestIsTrusted(request)) {
          sendJson(response, 403, { error: '本地服务访问校验失败' })
          return
        }
        if (url.pathname === '/api/database/export' && request.method === 'GET') {
          const bytes = await database.exportDatabase()
          response.writeHead(200, {
            'content-type': 'application/vnd.sqlite3',
            'content-disposition': `attachment; filename="${basename(databasePath)}"`,
            'cache-control': 'no-store',
          })
          response.end(Buffer.from(bytes))
          return
        }
        if (url.pathname === '/api/database/import' && request.method === 'POST') {
          const bytes = await readBody(request, MAX_DATABASE_BODY)
          await database.importDatabase(new Uint8Array(bytes))
          sendJson(response, 200, { ok: true })
          return
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: '请求方法不受支持' })
          return
        }
        const payload = JSON.parse(
          (await readBody(request, MAX_JSON_BODY)).toString('utf8'),
        ) as {
          sql?: string
          params?: unknown[]
          statements?: SqlStatement[]
        }
        if (url.pathname === '/api/database/query' && payload.sql) {
          sendJson(
            response,
            200,
            await database.query(payload.sql, payload.params ?? []),
          )
          return
        }
        if (url.pathname === '/api/database/execute' && payload.sql) {
          await database.execute(payload.sql, payload.params ?? [])
          sendJson(response, 200, { ok: true })
          return
        }
        if (
          url.pathname === '/api/database/batch' &&
          Array.isArray(payload.statements)
        ) {
          await database.batch(payload.statements)
          sendJson(response, 200, { ok: true })
          return
        }
        sendJson(response, 400, { error: '本地数据请求不完整' })
        return
      }
      await serveStatic(url.pathname, response)
    } catch (reason) {
      console.error(reason)
      sendJson(response, 500, { error: errorMessage(reason) })
    }
  })

  let closing = false
  async function shutdown() {
    if (closing) return
    closing = true
    server.close()
    await database.close()
    process.exit(0)
  }
  process.once('SIGINT', () => { void shutdown() })
  process.once('SIGTERM', () => { void shutdown() })

  server.once('error', async (reason: NodeJS.ErrnoException) => {
    if (reason.code === 'EADDRINUSE') {
      try {
        const health = await fetch(`${baseUrl}/api/health`)
        if (health.ok) {
          console.log(`项目测算服务已经运行：${baseUrl}`)
          openBrowser(baseUrl)
          await database.close()
          process.exit(0)
        }
      } catch {
        // 端口由其他程序占用，使用下方明确错误。
      }
      console.error(`端口 ${port} 已被其他程序占用`)
    } else {
      console.error(reason)
    }
    await database.close()
    process.exit(1)
  })
  server.listen(port, host, () => {
    console.log(`项目测算服务：${baseUrl}`)
    console.log(`SQLite 数据库：${databasePath}`)
    openBrowser(baseUrl)
  })
}

void main().catch((reason) => {
  console.error(reason)
  process.exit(1)
})
