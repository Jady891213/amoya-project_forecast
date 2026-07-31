import type { DatabaseClient, SqlStatement, StorageRuntimeInfo } from '../types'
import type { SqliteRequest, SqliteResponse } from './protocol'

export class SqliteWorkerClient implements DatabaseClient {
  private nextId = 1
  private readonly pending = new Map<
    number,
    {
      resolve: (value: SqliteResponse) => void
      reject: (reason: Error) => void
    }
  >()

  private constructor(
    private readonly worker: Worker,
    public readonly runtime: StorageRuntimeInfo,
  ) {
    worker.addEventListener('message', (event: MessageEvent<SqliteResponse>) => {
      const pending = this.pending.get(event.data.id)
      if (!pending) return
      this.pending.delete(event.data.id)
      if (event.data.ok) pending.resolve(event.data)
      else pending.reject(new Error(event.data.error))
    })
    worker.addEventListener('error', (event) => {
      this.pending.forEach(({ reject }) =>
        reject(new Error(event.message || 'SQLite Worker 运行失败')),
      )
      this.pending.clear()
    })
  }

  static async create(portable: boolean): Promise<SqliteWorkerClient> {
    const worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), {
      type: 'module',
      name: 'project-forecast-sqlite',
    })
    const provisional: StorageRuntimeInfo = {
      mode: portable ? 'portable' : 'transient',
      label: 'SQLite 初始化中',
      detail: '',
      sqliteVersion: '',
      schemaVersion: 0,
      persistent: false,
    }
    const client = new SqliteWorkerClient(worker, provisional)
    try {
      const response = await client.call({
        id: 0,
        type: 'init',
        portable,
      })
      if (!response.ok || !response.runtime) {
        throw new Error('SQLite Worker 未返回运行状态')
      }
      Object.assign(client.runtime, response.runtime)
      return client
    } catch (reason) {
      worker.terminate()
      throw reason
    }
  }

  private call(request: SqliteRequest, transfer: Transferable[] = []) {
    const id = this.nextId++
    const payload = { ...request, id } as SqliteRequest
    return new Promise<SqliteResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage(payload, transfer)
    })
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const response = await this.call({ id: 0, type: 'query', sql, params })
    return (response.ok ? response.value : []) as T[]
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.call({ id: 0, type: 'execute', sql, params })
  }

  async batch(statements: SqlStatement[]): Promise<void> {
    await this.call({ id: 0, type: 'batch', statements })
  }

  async exportDatabase(): Promise<Uint8Array> {
    const response = await this.call({ id: 0, type: 'export' })
    return response.ok ? (response.value as Uint8Array) : new Uint8Array()
  }

  async importDatabase(bytes: Uint8Array): Promise<void> {
    const transferable = bytes.slice()
    await this.call(
      { id: 0, type: 'import', bytes: transferable },
      [transferable.buffer],
    )
  }

  async close(): Promise<void> {
    await this.call({ id: 0, type: 'close' })
    this.worker.terminate()
  }
}
