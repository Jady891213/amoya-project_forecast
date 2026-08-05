import type { IncomingMessage, ServerResponse } from 'node:http'
import { DATABASE_FILE_NAME, type DatabaseClient } from '../shared/database'
import type { ApiError, CreateProjectInput, CreateProjectPlanRequest, DepartmentInput, PivotExportRequest, PivotRequest, SaveProjectWorkspaceRequest } from '../shared/domain/types'
import type { SavePlanAdjustmentsRequest } from '../shared/api'
import { MetricRepository } from './repositories/metricRepository'
import { ProjectRepository } from './repositories/projectRepository'
import { ProjectPlanRepository } from './repositories/projectPlanRepository'
import { isCreateProjectInput, isSaveProjectWorkspaceRequest } from '../shared/api'
import { ProjectWorkspaceService } from './projectWorkspaceService'
import { ReportWorkbookService } from './services/reportWorkbookService'
import { AiAnalysisMaterialService } from './services/aiAnalysisMaterialService'
import { PivotService } from './services/pivotService'
import { PivotWorkbookService } from './services/pivotWorkbookService'
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
  const status = code === 'REVISION_CONFLICT' || code === 'ADJUSTMENTS_OUTSIDE_PERIOD'
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
        if (!isCreateProjectInput(payload)) invalidRequest('新建项目请求不完整')
        sendJson(response, 201, await this.exclusive(() => this.service.createProject(payload as CreateProjectInput)))
        return true
      }
      const workspace = pathname.match(/^\/api\/projects\/([^/]+)\/workspace$/)
      if (workspace && request.method === 'GET') {
        sendJson(response, 200, await this.service.getWorkspace(
          decodeURIComponent(workspace[1]),
          url.searchParams.get('planId') ?? undefined,
        ))
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
        const payload = await readJson(request) as { expectedRevision?: number; planId?: string }
        if (!Number.isInteger(payload.expectedRevision) || !payload.planId) invalidRequest('计算请求缺少方案或修订号')
        sendJson(response, 200, await this.exclusive(() => this.service.calculate(
          decodeURIComponent(calculation[1]),
          payload.planId as string,
          payload.expectedRevision as number,
        )))
        return true
      }
      const adjustments = pathname.match(/^\/api\/projects\/([^/]+)\/plans\/([^/]+)\/adjustments$/)
      if (adjustments && request.method === 'PUT') {
        const payload = await readJson(request) as SavePlanAdjustmentsRequest
        if (!Number.isInteger(payload.expectedResultRevision) || !Array.isArray(payload.adjustments)) invalidRequest('底稿调整请求不完整')
        sendJson(response, 200, await this.exclusive(() => this.service.saveAdjustments(
          decodeURIComponent(adjustments[1]),
          decodeURIComponent(adjustments[2]),
          payload.expectedResultRevision,
          payload.adjustments,
        )))
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
      const projectPlans = pathname.match(/^\/api\/projects\/([^/]+)\/plans$/)
      if (projectPlans && request.method === 'GET') {
        sendJson(response, 200, await new ProjectPlanRepository(this.database).list(decodeURIComponent(projectPlans[1])))
        return true
      }
      if (projectPlans && request.method === 'POST') {
        const payload = await readJson(request) as CreateProjectPlanRequest
        if (!payload.name?.trim() || !payload.startPeriod || !payload.endPeriod) invalidRequest('方案信息不完整')
        sendJson(response, 201, await this.exclusive(() => this.service.createPlan(
          decodeURIComponent(projectPlans[1]), payload,
        )))
        return true
      }
      const projectPlan = pathname.match(/^\/api\/projects\/([^/]+)\/plans\/([^/]+)$/)
      if (projectPlan && request.method === 'PUT') {
        const payload = await readJson(request) as { name?: string; startPeriod?: string; endPeriod?: string }
        const projectId = decodeURIComponent(projectPlan[1])
        const planId = decodeURIComponent(projectPlan[2])
        const saved = await this.exclusive(() => this.service.updatePlan(projectId, planId, payload))
        sendJson(response, 200, saved)
        return true
      }
      const planStatus = pathname.match(/^\/api\/projects\/([^/]+)\/plans\/([^/]+)\/(archive|restore)$/)
      if (planStatus && request.method === 'POST') {
        const projectId = decodeURIComponent(planStatus[1])
        const planId = decodeURIComponent(planStatus[2])
        const saved = planStatus[3] === 'archive'
          ? await this.exclusive(() => this.service.archivePlan(projectId, planId))
          : await this.exclusive(() => this.service.restorePlan(projectId, planId))
        sendJson(response, 200, saved)
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
          url.searchParams.get('planId') ?? undefined,
        ))
        return true
      }
      const aiAnalysisPreview = pathname.match(/^\/api\/projects\/([^/]+)\/ai-analysis\/preview$/)
      if (aiAnalysisPreview && request.method === 'GET') {
        const reportDto = await this.service.buildReport(
          decodeURIComponent(aiAnalysisPreview[1]),
          url.searchParams.get('planId') ?? undefined,
        )
        sendJson(response, 200, new AiAnalysisMaterialService().preview(reportDto))
        return true
      }
      const aiAnalysisExport = pathname.match(/^\/api\/projects\/([^/]+)\/ai-analysis\.xlsx$/)
      if (aiAnalysisExport && request.method === 'GET') {
        const reportDto = await this.service.buildReport(
          decodeURIComponent(aiAnalysisExport[1]),
          url.searchParams.get('planId') ?? undefined,
        )
        const service = new AiAnalysisMaterialService()
        const preview = service.preview(reportDto)
        const bytes = await service.buildWorkbook(reportDto)
        response.writeHead(200, {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(preview.dataSourceName)}`,
          'cache-control': 'no-store',
        })
        response.end(bytes)
        return true
      }
      const exportReport = pathname.match(/^\/api\/projects\/([^/]+)\/export\.xlsx$/)
      if (exportReport && request.method === 'GET') {
        const projectId = decodeURIComponent(exportReport[1])
        const reportDto = await this.service.buildReport(
          projectId,
          url.searchParams.get('planId') ?? undefined,
        )
        if (!reportDto.calculationState?.lastSuccessAt) {
          throw Object.assign(new Error('当前方案尚无可导出的成功计算结果'), { code: 'NOT_FOUND' })
        }
        const taxBasis = url.searchParams.get('taxBasis') === 'tax_inclusive'
          ? 'tax_inclusive'
          : 'tax_exclusive'
        const displayUnit = url.searchParams.get('displayUnit') === 'yuan'
          ? 'yuan'
          : 'wan'
        const bytes = await new ReportWorkbookService().build(reportDto, { taxBasis, displayUnit })
        const exportDate = new Date().toISOString().slice(0, 10).replaceAll('-', '')
        const safeProject = reportDto.project.name.replace(/[\\/:*?"<>|]/g, '_')
        const safePlan = reportDto.plan.name.replace(/[\\/:*?"<>|]/g, '_')
        const fileName = `${reportDto.project.code ?? 'PROJECT'}_${safeProject}_${safePlan}_${exportDate}.xlsx`
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
      if (pathname === '/api/facts/pivot' && request.method === 'POST') {
        const payload = await readJson(request) as PivotRequest
        sendJson(response, 200, await new PivotService(this.database).build(payload))
        return true
      }
      if (pathname === '/api/facts/pivot/export.xlsx' && request.method === 'POST') {
        const payload = await readJson(request) as PivotExportRequest
        if (!payload?.request || typeof payload.hideNoDataRows !== 'boolean') invalidRequest('项目报表下载条件不完整')
        const pivot = new PivotService(this.database)
        const [metadata, result] = await Promise.all([pivot.metadata(), pivot.build(payload.request)])
        const bytes = await new PivotWorkbookService().build(metadata, result, payload)
        const stamp = new Date().toISOString().slice(0, 16).replaceAll('-', '').replace('T', '_').replace(':', '')
        const fileName = `项目报表_${stamp}.xlsx`
        response.writeHead(200, {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          'cache-control': 'no-store',
        })
        response.end(bytes)
        return true
      }
      if (pathname === '/api/facts/pivot/metadata' && request.method === 'GET') {
        sendJson(response, 200, await new PivotService(this.database).metadata())
        return true
      }
      if (pathname === '/api/database/backup' && request.method === 'GET') {
        const bytes = await this.database.exportDatabase()
        response.writeHead(200, {
          'content-type': 'application/vnd.sqlite3',
          'content-disposition': `attachment; filename="${DATABASE_FILE_NAME}"`,
          'cache-control': 'no-store',
        })
        response.end(Buffer.from(bytes))
        return true
      }
      if (pathname === '/api/database/restore' && request.method === 'POST') {
        if (request.headers['x-amoya-file-name'] !== DATABASE_FILE_NAME) {
          invalidRequest(`请选择名为 ${DATABASE_FILE_NAME} 的本地数据文件`)
        }
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
