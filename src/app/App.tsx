import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowLeft,
  BarChart3,
  BriefcaseBusiness,
  Calculator,
  Database,
  Download,
  FileChartColumn,
  HardDrive,
  Sigma,
  TableProperties,
  Upload,
} from 'lucide-react'
import { createDatabase } from './storage/createDatabase'
import type { DatabaseClient, StorageRuntimeInfo } from './storage/types'
import type { AppSnapshot } from './state/types'
import { DepartmentRepository } from './repositories/departmentRepository'
import { DimensionRepository } from './repositories/dimensionRepository'
import { FactRepository } from './repositories/factRepository'
import { MetricRepository } from './repositories/metricRepository'
import { ProjectRepository } from './repositories/projectRepository'
import { ReferenceDatasetService } from './services/referenceDatasetService'
import { DatabaseBackupService } from './services/databaseBackupService'
import { ProjectCenterPage } from './pages/ProjectCenterPage'
import { DataFoundationPage } from './pages/DataFoundationPage'
import { MetricDefinitionsPage } from './pages/MetricDefinitionsPage'
import { ProjectReportPage } from './pages/ProjectReportPage'
import { ForecastConfigPage } from './pages/ForecastConfigPage'

type AppRoute = 'projects' | 'archived' | 'master-data' | 'metrics'
type WorkspaceView = 'forecast' | 'calculation' | 'report'

const bootStorage: StorageRuntimeInfo = {
  mode: 'transient',
  label: 'SQLite 初始化中',
  detail: '',
  sqliteVersion: '',
  schemaVersion: 0,
  persistent: false,
}

const emptySnapshot: AppSnapshot = {
  departments: [],
  projects: [],
  modules: [],
  periods: [],
  scenarios: [],
  versions: [],
  metrics: [],
  facts: [],
  storage: bootStorage,
}

const routeTitles: Record<AppRoute, string> = {
  projects: '项目中心',
  archived: '归档项目',
  'master-data': '主数据管理',
  metrics: '指标管理',
}

export default function App() {
  const [database, setDatabase] = useState<DatabaseClient>()
  const [route, setRoute] = useState<AppRoute>('projects')
  const [workspaceProjectId, setWorkspaceProjectId] = useState('')
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('forecast')
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot)
  const [loading, setLoading] = useState(true)
  const [fatalError, setFatalError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const importInput = useRef<HTMLInputElement>(null)

  const projectRepository = useMemo(
    () => database ? new ProjectRepository(database) : undefined,
    [database],
  )
  const backupService = useMemo(
    () => database ? new DatabaseBackupService(database) : undefined,
    [database],
  )

  const refresh = useCallback(async (client = database) => {
    if (!client) return
    const projectsRepo = new ProjectRepository(client)
    const dimensions = new DimensionRepository(client)
    const [departments, projects, periods, scenarios, versions, metrics, facts] =
      await Promise.all([
        new DepartmentRepository(client).list(),
        projectsRepo.list(),
        dimensions.listPeriods(),
        dimensions.listScenarios(),
        dimensions.listVersions(),
        new MetricRepository(client).list(),
        new FactRepository(client).list(),
      ])
    const moduleGroups = await Promise.all(projects.map((project) => projectsRepo.listModules(project.id)))
    setSnapshot({
      departments,
      projects,
      modules: moduleGroups.flat(),
      periods,
      scenarios,
      versions,
      metrics,
      facts,
      storage: { ...client.runtime },
    })
  }, [database])

  useEffect(() => {
    let cancelled = false
    let client: DatabaseClient | undefined
    async function boot() {
      try {
        client = await createDatabase()
        if (cancelled) {
          await client.close()
          return
        }
        await new ReferenceDatasetService(client).ensureInitialized()
        if (!cancelled) {
          setDatabase(client)
          await refresh(client)
        }
      } catch (reason) {
        if (!cancelled) setFatalError(reason instanceof Error ? reason.message : '应用初始化失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void boot()
    return () => {
      cancelled = true
      if (client) void client.close()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (snapshot.storage.mode !== 'portable') return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [snapshot.storage.mode])

  const workspaceProject = snapshot.projects.find((project) => project.id === workspaceProjectId)
  const storageTone = snapshot.storage.persistent ? 'healthy' : 'warning'

  async function archiveWorkspaceProject() {
    if (!workspaceProject || workspaceProject.origin !== 'user' || !projectRepository) return
    try {
      await projectRepository.archive(workspaceProject.id)
      await refresh()
      setWorkspaceProjectId('')
      setRoute('archived')
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '归档失败')
    }
  }

  async function restoreDatabase(file?: File) {
    if (!file || !backupService) return
    if (!window.confirm('恢复数据库将替换当前 amoya_project_forecast.db。确认继续吗？')) return
    try {
      await backupService.restore(file)
      await refresh()
      setWorkspaceProjectId('')
      setNotice('数据库恢复成功')
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '数据库恢复失败')
    } finally {
      if (importInput.current) importInput.current.value = ''
    }
  }

  if (loading) {
    return <div className="app-loading"><Database size={30} /><h1>正在连接本地数据服务</h1><p>校验 SQLite 数据库、结构版本与基础数据…</p></div>
  }
  if (fatalError || !database) {
    return <div className="app-loading error-state"><Database size={30} /><h1>本地数据服务连接失败</h1><p>{fatalError}</p><small>请双击根目录启动文件，或进入 src 执行 pnpm start:local；不要直接打开 output/web/index.html。</small><button className="btn primary" onClick={() => window.location.reload()}>重新连接</button></div>
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><BarChart3 size={17} /></div>
          <div><b>项目测算分析工具</b><span>本地财务与 EPM 工作台</span></div>
        </div>
        <div className="top-context">{workspaceProject?.name ?? routeTitles[route]}</div>
        <div className="top-actions">
          <span className={`storage-status ${storageTone}`}>
            <HardDrive size={14} /> {snapshot.storage.label} · {snapshot.storage.detail}
          </span>
          {snapshot.storage.mode === 'portable' && (
            <>
              <button className="top-icon-button" aria-label="导出数据库备份" title="导出数据库备份" onClick={() => void backupService?.download()}><Download size={15} /></button>
              <button className="top-icon-button" aria-label="恢复数据库备份" title="恢复数据库备份" onClick={() => importInput.current?.click()}><Upload size={15} /></button>
            </>
          )}
          <input ref={importInput} hidden type="file" accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3" onChange={(event) => void restoreDatabase(event.target.files?.[0])} />
          <span className="phase-badge">P1C · 税与现金流闭环</span>
        </div>
      </header>

      {snapshot.storage.mode === 'portable' && (
        <div className="portable-banner">
          <HardDrive size={14} />
          当前为便携模式：可正常保存并计算，但刷新或关闭页面会重置内存数据；离开前请导出 .sqlite3 文件。
          <button onClick={() => void backupService?.download()}>立即导出</button>
        </div>
      )}

      <div className="shell">
        {!workspaceProject && (
          <aside className="global-nav">
            <div className="nav-section">
              <div className="nav-title">项目数据</div>
              <button className={`nav-item ${route === 'projects' ? 'active' : ''}`} onClick={() => setRoute('projects')}><BriefcaseBusiness size={16} />项目列表</button>
              <button className={`nav-item ${route === 'archived' ? 'active' : ''}`} onClick={() => setRoute('archived')}><Archive size={16} />归档项目</button>
            </div>
            <div className="nav-section">
              <div className="nav-title">平台配置</div>
              <button className={`nav-item ${route === 'master-data' ? 'active' : ''}`} onClick={() => setRoute('master-data')}><Database size={16} />主数据管理</button>
              <button className={`nav-item ${route === 'metrics' ? 'active' : ''}`} onClick={() => setRoute('metrics')}><Sigma size={16} />指标管理</button>
            </div>
            <div className="db-box">
              <b><HardDrive size={14} /> {snapshot.storage.label}</b>
              <span>{snapshot.storage.detail}</span>
              <span>SQLite {snapshot.storage.sqliteVersion}</span>
              <span>Schema v{snapshot.storage.schemaVersion}</span>
              <span>项目 {snapshot.projects.length} 个</span>
              <span>基础事实 {snapshot.facts.length} 条</span>
              {snapshot.storage.mode === 'persistent' && (
                <div className="data-management-actions">
                  <span>数据实时同步到本地 DB 文件</span>
                  <button onClick={() => void backupService?.download()}><Download size={13} />备份</button>
                  <button onClick={() => importInput.current?.click()}><Upload size={13} />恢复</button>
                </div>
              )}
            </div>
          </aside>
        )}

        {workspaceProject ? (
          <main className="workspace">
            <div className="workspace-head">
              <button className="back-btn" onClick={() => setWorkspaceProjectId('')}><ArrowLeft size={15} />项目中心</button>
              <span className="project-title">{workspaceProject.name}</span>
              <span className="project-version">基准场景 · 工作版</span>
              <div className="workspace-tabs">
                <button
                  className={`workspace-tab ${workspaceView === 'forecast' ? 'active' : ''}`}
                  disabled={workspaceProject.status === 'archived'}
                  onClick={() => setWorkspaceView('forecast')}
                ><Calculator size={14} />预测配置</button>
                <button className={`workspace-tab ${workspaceView === 'calculation' ? 'active' : ''}`} onClick={() => setWorkspaceView('calculation')}><TableProperties size={14} />计算表格</button>
                <button className={`workspace-tab ${workspaceView === 'report' ? 'active' : ''}`} onClick={() => setWorkspaceView('report')}><FileChartColumn size={14} />项目报表</button>
              </div>
              <div className="workspace-head-actions">
                {workspaceProject.origin === 'user' && workspaceProject.status === 'calculating' && <button className="btn" onClick={() => void archiveWorkspaceProject()}><Archive size={14} />归档</button>}
              </div>
            </div>
            {workspaceView === 'forecast' ? (
              <ForecastConfigPage
                database={database}
                project={workspaceProject}
                departments={snapshot.departments}
                modules={snapshot.modules.filter((module) => module.projectId === workspaceProject.id)}
                onProjectSave={async (input) => {
                  await projectRepository?.save(input)
                  await refresh()
                }}
                onCalculated={async () => {
                  await refresh()
                  setWorkspaceView('calculation')
                }}
              />
            ) : (
              <ProjectReportPage
                database={database}
                snapshot={snapshot}
                requestedProjectId={workspaceProject.id}
                view={workspaceView}
                onReturnToForecast={() => setWorkspaceView('forecast')}
              />
            )}
          </main>
        ) : (
          <main className="page">
            {route === 'projects' && <ProjectCenterPage database={database} snapshot={snapshot} mode="active" onRefresh={refresh} onOpenProject={(id) => { setWorkspaceProjectId(id); setWorkspaceView('forecast') }} />}
            {route === 'archived' && <ProjectCenterPage database={database} snapshot={snapshot} mode="archived" onRefresh={refresh} onOpenProject={(id) => { setWorkspaceProjectId(id); setWorkspaceView('report') }} />}
            {route === 'master-data' && <DataFoundationPage database={database} snapshot={snapshot} onRefresh={refresh} onOpenReport={(id) => { setWorkspaceProjectId(id); setWorkspaceView('calculation') }} />}
            {route === 'metrics' && <MetricDefinitionsPage metrics={snapshot.metrics} />}
          </main>
        )}
      </div>

      {actionError && <div className="toast-error">{actionError}<button onClick={() => setActionError('')}>关闭</button></div>}
      {notice && <div className="toast-success">{notice}<button onClick={() => setNotice('')}>关闭</button></div>}
    </div>
  )
}
