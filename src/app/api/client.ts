import type {
  ApiError,
  CalculationRun,
  Department,
  DepartmentInput,
  MetricDefinition,
  Project,
  ProjectInput,
  ProjectReportDto,
  ProjectWorkspace,
  SaveProjectWorkspaceRequest,
} from '../../shared/api'
import type { AppSnapshot } from '../state/types'

interface RuntimeResponse {
  token: string
}

export class SemanticApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: ApiError,
  ) {
    super(detail.message)
  }
}

export class ApiClient {
  private constructor(private readonly token: string) {}

  static async create() {
    const response = await fetch('/api/runtime', { cache: 'no-store' })
    if (!response.ok) throw new Error('本地数据服务尚未启动')
    const runtime = await response.json() as RuntimeResponse
    return new ApiClient(runtime.token)
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, {
      ...init,
      cache: 'no-store',
      headers: {
        'x-amoya-token': this.token,
        ...(init.body && !(init.body instanceof Uint8Array)
          ? { 'content-type': 'application/json' }
          : {}),
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) {
      let detail: ApiError = {
        code: 'HTTP_ERROR',
        message: `本地服务请求失败（${response.status}）`,
      }
      try { detail = await response.json() as ApiError } catch { /* use fallback */ }
      throw new SemanticApiError(response.status, detail)
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  bootstrap(): Promise<{ snapshot: AppSnapshot }> {
    return this.request('/api/bootstrap')
  }

  createProject(input: ProjectInput): Promise<ProjectWorkspace> {
    return this.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  getWorkspace(projectId: string): Promise<ProjectWorkspace> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/workspace`)
  }

  saveWorkspace(projectId: string, request: SaveProjectWorkspaceRequest): Promise<ProjectWorkspace> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/workspace`, {
      method: 'PUT',
      body: JSON.stringify(request),
    })
  }

  calculate(projectId: string, expectedRevision: number): Promise<{
    success: boolean
    run: CalculationRun
    issues: Array<{ severity: 'error' | 'warning'; message: string }>
  }> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/calculations`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision }),
    })
  }

  archive(projectId: string): Promise<Project> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/archive`, { method: 'POST' })
  }

  restore(projectId: string): Promise<Project> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/restore`, { method: 'POST' })
  }

  createDepartment(input: DepartmentInput): Promise<Department> {
    return this.request('/api/departments', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  updateDepartment(id: string, input: DepartmentInput): Promise<Department> {
    return this.request(`/api/departments/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }

  metrics(): Promise<MetricDefinition[]> {
    return this.request('/api/metrics')
  }

  report(projectId: string, runId?: string): Promise<ProjectReportDto> {
    const query = runId ? `?runId=${encodeURIComponent(runId)}` : ''
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/report${query}`)
  }

  async backup(): Promise<void> {
    const response = await fetch('/api/database/backup', {
      headers: { 'x-amoya-token': this.token },
    })
    if (!response.ok) throw new Error('数据库备份失败')
    const blob = await response.blob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'amoya_project_forecast.db'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async exportReport(projectId: string, runId?: string): Promise<void> {
    const query = runId ? `?runId=${encodeURIComponent(runId)}` : ''
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export.xlsx${query}`, {
      headers: { 'x-amoya-token': this.token },
    })
    if (!response.ok) {
      const detail = await response.json() as ApiError
      throw new Error(detail.message)
    }
    const disposition = response.headers.get('content-disposition') ?? ''
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1]
    const blob = await response.blob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = encoded ? decodeURIComponent(encoded) : '项目测算报告.xlsx'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async restoreDatabase(file: File): Promise<void> {
    const response = await fetch('/api/database/restore', {
      method: 'POST',
      headers: {
        'x-amoya-token': this.token,
        'content-type': 'application/octet-stream',
      },
      body: file,
    })
    if (!response.ok) {
      const detail = await response.json() as ApiError
      throw new Error(detail.message)
    }
  }
}
