import type { DatabaseClient, SqlStatement, StorageRuntimeInfo } from './types'

interface RuntimeResponse {
  token: string
  runtime: StorageRuntimeInfo
}

interface ApiError {
  error?: string
}

export class RemoteDatabaseClient implements DatabaseClient {
  private constructor(
    private readonly token: string,
    public readonly runtime: StorageRuntimeInfo,
  ) {}

  static async create(): Promise<RemoteDatabaseClient> {
    const response = await fetch('/api/runtime', { cache: 'no-store' })
    if (!response.ok) {
      throw new Error('本地数据服务尚未启动')
    }
    const payload = await response.json() as RuntimeResponse
    return new RemoteDatabaseClient(payload.token, payload.runtime)
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    parse: (response: Response) => Promise<T>,
  ): Promise<T> {
    const response = await fetch(path, {
      ...init,
      cache: 'no-store',
      headers: {
        'x-amoya-token': this.token,
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) {
      let message = `本地数据服务请求失败（${response.status}）`
      try {
        const payload = await response.json() as ApiError
        if (payload.error) message = payload.error
      } catch {
        // 非 JSON 错误仍使用状态码说明。
      }
      throw new Error(message)
    }
    return parse(response)
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.request(
      '/api/database/query',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql, params }),
      },
      async (response) => response.json() as Promise<T[]>,
    )
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.request(
      '/api/database/execute',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql, params }),
      },
      async () => undefined,
    )
  }

  async batch(statements: SqlStatement[]): Promise<void> {
    await this.request(
      '/api/database/batch',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statements }),
      },
      async () => undefined,
    )
  }

  async exportDatabase(): Promise<Uint8Array> {
    return this.request(
      '/api/database/export',
      { method: 'GET' },
      async (response) => new Uint8Array(await response.arrayBuffer()),
    )
  }

  async importDatabase(bytes: Uint8Array): Promise<void> {
    await this.request(
      '/api/database/import',
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes as BodyInit,
      },
      async () => undefined,
    )
  }

  async close(): Promise<void> {
    // 数据库连接由本地服务管理，页面关闭不能关闭共享服务。
  }
}
