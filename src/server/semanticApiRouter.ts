import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename } from 'node:path'
import type { DatabaseClient } from '../app/storage/types'
import type { ApiError, DepartmentInput, ProjectInput, SaveProjectWorkspaceRequest } from '../shared/domain/types'
import { CalculationRunRepository } from './repositories/calculationRunRepository'
import { MetricRepository } from './repositories/metricRepository'
import { ProjectRepository } from './repositories/projectRepository'
import { isProjectInput, isSaveProjectWorkspaceRequest } from '../shared/api'
import { ProjectWorkspaceService } from './projectWorkspaceService'
import { ReportWorkbookService } from './services/reportWorkbookService'
import { initializeSqliteDatabase } from '../app/storage/sqlite/initialize'

const MAX_JSON_BODY = 10 * 1024 * 1024
const MAX_DATABASE_BODY = 100 * 1024 * 1024

async function readBody(request: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw Object.assign(new Error('请求内容超过允许大小'), { code: 'PAYLOAD_TOO_LARGE' })
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const bytes = await readBody(request, MAX_JSON_BODY)
  try {
    return bytes.length ? JSON.parse(bytes.toString('utf8')) : {}
  } catch {
    throw Object.assign(new Error('请求 JSON 格式无效'), { code: 'INVALID_JSON' })
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

function apiError(reason: unknown): { status: number; body: ApiError } {
  const error = reason as Error & {
    code?: string
    currentRevision?: number
    fieldErrors?: ApiError['fieldErrors']
  }
  const code = error.code ?? 'INTERNAL_ERROR'
  const status = code === 'REVISION_CONFLICT'
    ? 409
    : code === 'NOT_FOUND'
      ? 404
      : code === 'INVALID_JSON' || code === 'INVALID_REQUEST'
        ? 400
        : 500
  return {
    status,
    body: {
      code,
      message: error.message || '本地服务处理失败',
      fieldErrors: error.fieldErrors,
      currentRevision: error.currentRevision,
    },
  }
}

function invalidRequest(message: string): never {
  throw Object.assign(new Error(message), { code: 'INVALID_REQUEST' })
}

export class SemanticApiRouter {
  private readonly service: ProjectWorkspaceService
  private operation = Promise.resolve()

  constructor(
    private readonly database: DatabaseClient,
    private readonly databasePath: string,
  ) {
    this.service = new ProjectWorkspaceService(database)
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.operation.then(action, action)
    this.operation = result.then(() => undefined, () => undefined)
    return result
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    try {
      const { pathname } = url
      if (pathname === '/api/bootstrap' && request.method === 'GET') {
        sendJson(response, 200, { snapshot: await this.service.bootstrap() })
        return true
      }
      if (pathname === '/api/projects' && request.method === 'GET') {
        sendJson(response, 200, await new ProjectRepository(this.database).list())
        return true
      }
      if (pathname === '/api/projects' && request.method === 'POST') {
        const payload = await readJson(request)
        if (!isProjectInput(payload)) invalidRequest('新建项目请求不完整')
        sendJson(response, 201, await this.exclusive(() => this.service.createProject(payload as ProjectInput)))
        return true
      }
      const workspace = pathname.match(/^\/api\/projects\/([^/]+)\/workspace$/)
      if (workspace && request.method === 'GET') {
        sendJson(response, 200, await this.service.getWorkspace(decodeURIComponent(workspace[1])))
        return true
      }
      if (workspace && request.method === 'PUT') {
        const payload = await readJson(request)
        if (!isSaveProjectWorkspaceRequest(payload)) invalidRequest('项目工作区请求不完整')
        sendJson(response, 200, await this.exclusive(() => this.service.saveWorkspace(
          decodeURIComponent(workspace[1]),
          payload as SaveProjectWorkspaceRequest,
        )))
        return true
      }
      const calculation = pathname.match(/^\/api\/projects\/([^/]+)\/calculations$/)
      if (calculation && request.method === 'POST') {
        const payload = await readJson(request) as { expectedRevision?: number }
        if (!Number.isInteger(payload.expectedRevision)) invalidRequest('计算请求缺少项目修订号')
        sendJson(response, 200, await this.exclusive(() => this.service.calculate(
          decodeURIComponent(calculation[1]),
          payload.expectedRevision as number,
        )))
        return true
      }
      const latest = pathname.match(/^\/api\/projects\/([^/]+)\/calculations\/latest$/)
      if (latest && request.method === 'GET') {
        const run = await new CalculationRunRepository(this.database).latestSuccess(decodeURIComponent(latest[1]))
        if (!run) throw Object.assign(new Error('当前项目尚无成功计算批次'), { code: 'NOT_FOUND' })
        sendJson(response, 200, run)
        return true
      }
      const runPath = pathname.match(/^\/api\/projects\/([^/]+)\/calculations\/([^/]+)$/)
      if (runPath && request.method === 'GET') {
        const run = await new CalculationRunRepository(this.database).get(
          decodeURIComponent(runPath[1]),
          decodeURIComponent(runPath[2]),
        )
        if (!run) throw Object.assign(new Error('计算批次不存在'), { code: 'NOT_FOUND' })
        sendJson(response, 200, run)
        return true
      }
      const archive = pathname.match(/^\/api\/projects\/([^/]+)\/(archive|restore)$/)
      if (archive && request.method === 'POST') {
        const result = archive[2] === 'archive'
          ? await this.exclusive(() => this.service.archive(decodeURIComponent(archive[1])))
          : await this.exclusive(() => this.service.restore(decodeURIComponent(archive[1])))
        sendJson(response, 200, result)
        return true
      }
      const copyProject = pathname.match(/^\/api\/projects\/([^/]+)\/copy$/)
      if (copyProject && request.method === 'POST') {
        sendJson(response, 201, await this.exclusive(() => this.service.copy(decodeURIComponent(copyProject[1]))))
        return true
      }
      const project = pathname.match(/^\/api\/projects\/([^/]+)$/)
      if (project && request.method === 'DELETE') {
        await this.exclusive(() => this.service.delete(decodeURIComponent(project[1])))
        response.writeHead(204, { 'cache-control': 'no-store' })
        response.end()
        return true
      }
      const report = pathname.match(/^\/api\/projects\/([^/]+)\/report$/)
      if (report && request.method === 'GET') {
        sendJson(response, 200, await this.service.buildReport(
          decodeURIComponent(report[1]),
          url.searchParams.get('runId') ?? undefined,
        ))
        return true
      }
      const exportReport = pathname.match(/^\/api\/projects\/([^/]+)\/export\.xlsx$/)
      if (exportReport && request.method === 'GET') {
        const projectId = decodeURIComponent(exportReport[1])
        const reportDto = await this.service.buildReport(
          projectId,
          url.searchParams.get('runId') ?? undefined,
        )
        if (!reportDto.calculationRun) {
          throw Object.assign(new Error('当前项目没有可导出的成功计算批次'), { code: 'NOT_FOUND' })
        }
        const bytes = await new ReportWorkbookService().build(reportDto)
        const exportDate = new Date().toISOString().slice(0, 10).replaceAll('-', '')
        const safeProject = reportDto.projectSnapshot.name.replace(/[\\/:*?"<>|]/g, '_')
        const fileName = `${reportDto.projectSnapshot.code ?? 'PROJECT'}_${safeProject}_工作版_RUN-${String(reportDto.calculationRun.runNumber).padStart(4, '0')}_${exportDate}.xlsx`
        response.writeHead(200, {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          'cache-control': 'no-store',
        })
        response.end(bytes)
        return true
      }
      if (pathname === '/api/departments' && request.method === 'GET') {
        sendJson(response, 200, (await this.service.bootstrap()).departments)
        return true
      }
      if (pathname === '/api/departments' && request.method === 'POST') {
        const payload = await readJson(request) as DepartmentInput
        sendJson(response, 201, await this.exclusive(() => this.service.saveDepartment(payload)))
        return true
      }
      const department = pathname.match(/^\/api\/departments\/([^/]+)$/)
      if (department && request.method === 'PUT') {
        const payload = await readJson(request) as DepartmentInput & { status?: 'active' | 'inactive' }
        const saved = await this.exclusive(async () => {
          const result = await this.service.saveDepartment({ ...payload, id: decodeURIComponent(department[1]) })
          if (payload.status && payload.status !== result.status) {
            return this.service.setDepartmentStatus(result.id, payload.status)
          }
          return result
        })
        sendJson(response, 200, saved)
        return true
      }
      if (pathname === '/api/metrics' && request.method === 'GET') {
        sendJson(response, 200, await new MetricRepository(this.database).list())
        return true
      }
      if (pathname === '/api/database/backup' && request.method === 'GET') {
        const bytes = await this.database.exportDatabase()
        response.writeHead(200, {
          'content-type': 'application/vnd.sqlite3',
          'content-disposition': `attachment; filename="${basename(this.databasePath)}"`,
          'cache-control': 'no-store',
        })
        response.end(Buffer.from(bytes))
        return true
      }
      if (pathname === '/api/database/restore' && request.method === 'POST') {
        const bytes = await readBody(request, MAX_DATABASE_BODY)
        await this.exclusive(async () => {
          const previous = await this.database.exportDatabase()
          try {
            await this.database.importDatabase(new Uint8Array(bytes))
            await initializeSqliteDatabase(this.database)
          } catch (reason) {
            await this.database.importDatabase(previous)
            throw reason
          }
        })
        sendJson(response, 200, { ok: true, schemaVersion: this.database.runtime.schemaVersion })
        return true
      }
      return false
    } catch (reason) {
      const error = apiError(reason)
      sendJson(response, error.status, error.body)
      return true
    }
  }
}
