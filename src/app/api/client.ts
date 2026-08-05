import type {
  ApiError,
  Department,
  DepartmentInput,
  CreateProjectPlanRequest,
  MetricDefinition,
  Project,
  ProjectInput,
  ProjectReportDto,
  PivotRequest,
  PivotResponse,
  PivotMetadata,
  CreateProjectInput,
  ProjectWorkspace,
  ProjectPlan,
  SaveProjectWorkspaceRequest,
  SavePlanAdjustmentsRequest,
  SavePlanAdjustmentsResponse,
  CalculationResponse,
  AiAnalysisPreviewDto,
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

  createProject(input: CreateProjectInput): Promise<ProjectWorkspace> {
    return this.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  getWorkspace(projectId: string, planId?: string): Promise<ProjectWorkspace> {
    const query = planId ? `?planId=${encodeURIComponent(planId)}` : ''
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/workspace${query}`)
  }

  saveWorkspace(projectId: string, request: SaveProjectWorkspaceRequest): Promise<ProjectWorkspace> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/workspace`, {
      method: 'PUT',
      body: JSON.stringify(request),
    })
  }

  calculate(projectId: string, planId: string, expectedRevision: number): Promise<CalculationResponse> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/calculations`, {
      method: 'POST',
      body: JSON.stringify({ planId, expectedRevision }),
    })
  }

  saveAdjustments(projectId: string, planId: string, request: SavePlanAdjustmentsRequest): Promise<SavePlanAdjustmentsResponse> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}/adjustments`, {
      method: 'PUT', body: JSON.stringify(request),
    })
  }

  archive(projectId: string): Promise<Project> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/archive`, { method: 'POST' })
  }

  restore(projectId: string): Promise<Project> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/restore`, { method: 'POST' })
  }

  copyProject(projectId: string): Promise<ProjectWorkspace> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/copy`, { method: 'POST' })
  }

  listPlans(projectId: string): Promise<ProjectPlan[]> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/plans`)
  }

  createPlan(projectId: string, request: CreateProjectPlanRequest): Promise<ProjectWorkspace> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/plans`, {
      method: 'POST', body: JSON.stringify(request),
    })
  }

  updatePlan(projectId: string, planId: string, input: Partial<Pick<ProjectPlan, 'name' | 'startPeriod' | 'endPeriod'>>): Promise<ProjectPlan> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}`, {
      method: 'PUT', body: JSON.stringify(input),
    })
  }

  archivePlan(projectId: string, planId: string): Promise<ProjectPlan> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}/archive`, { method: 'POST' })
  }

  restorePlan(projectId: string, planId: string): Promise<ProjectPlan> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}/restore`, { method: 'POST' })
  }

  deleteProject(projectId: string): Promise<void> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' })
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

  pivot(request: PivotRequest): Promise<PivotResponse> {
    return this.request('/api/facts/pivot', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  pivotMetadata(): Promise<PivotMetadata> { return this.request('/api/facts/pivot/metadata') }

  report(projectId: string, planId?: string): Promise<ProjectReportDto> {
    const query = new URLSearchParams()
    if (planId) query.set('planId', planId)
    const suffix = query.size ? `?${query}` : ''
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/report${suffix}`)
  }

  aiAnalysisPreview(projectId: string, planId?: string): Promise<AiAnalysisPreviewDto> {
    const query = new URLSearchParams()
    if (planId) query.set('planId', planId)
    const suffix = query.size ? `?${query}` : ''
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/ai-analysis/preview${suffix}`)
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

  async exportReport(projectId: string, planId?: string): Promise<void> {
    const params = new URLSearchParams()
    if (planId) params.set('planId', planId)
    const query = params.size ? `?${params}` : ''
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

  async exportAiAnalysis(projectId: string, planId?: string): Promise<void> {
    const params = new URLSearchParams()
    if (planId) params.set('planId', planId)
    const query = params.size ? `?${params}` : ''
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/ai-analysis.xlsx${query}`, {
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
    link.download = encoded ? decodeURIComponent(encoded) : 'AI分析脱敏数据.xlsx'
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
