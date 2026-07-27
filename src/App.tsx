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
  Pencil,
  Sigma,
  TableProperties,
  Upload,
} from 'lucide-react'
import { createDatabase } from './storage/createDatabase'
import type { DatabaseClient, StorageRuntimeInfo } from './storage/types'
import type { AppSnapshot } from './app/types'
import type { Project } from './domain/types'
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
import { ProjectDialog } from './ui/ProjectDialog'

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
  const [editingProject, setEditingProject] = useState<Project>()
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
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
    if (!window.confirm('恢复数据库将替换当前 SQLite 数据。确认继续吗？')) return
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
    return <div className="app-loading"><Database size={30} /><h1>正在启动 SQLite 数据基座</h1><p>加载 WASM、校验数据库结构并初始化基础数据…</p></div>
  }
  if (fatalError || !database) {
    return <div className="app-loading error-state"><Database size={30} /><h1>应用初始化失败</h1><p>{fatalError}</p><button className="btn primary" onClick={() => window.location.reload()}>重新加载</button></div>
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
          <button className="top-icon-button" aria-label="导出SQLite数据库" title="导出SQLite数据库" onClick={() => void backupService?.download()}><Download size={15} /></button>
          <button className="top-icon-button" aria-label="导入SQLite数据库" title="导入SQLite数据库" onClick={() => importInput.current?.click()}><Upload size={15} /></button>
          <input ref={importInput} hidden type="file" accept=".sqlite,.sqlite3,application/vnd.sqlite3" onChange={(event) => void restoreDatabase(event.target.files?.[0])} />
          <span className="phase-badge">P1A · 预测配置闭环</span>
        </div>
      </header>

      {snapshot.storage.mode === 'portable' && (
        <div className="portable-banner">
          <HardDrive size={14} />
          当前为便携模式：修改只保存在内存中，关闭页面前请导出 .sqlite3 文件。
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
              <span>SQLite {snapshot.storage.sqliteVersion}</span>
              <span>Schema v{snapshot.storage.schemaVersion}</span>
              <span>项目 {snapshot.projects.length} 个</span>
              <span>基础事实 {snapshot.facts.length} 条</span>
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
                {workspaceProject.origin === 'user' && <button className="btn" onClick={() => { setEditingProject(workspaceProject); setProjectDialogOpen(true) }}><Pencil size={14} />编辑项目</button>}
                {workspaceProject.origin === 'user' && workspaceProject.status === 'calculating' && <button className="btn" onClick={() => void archiveWorkspaceProject()}><Archive size={14} />归档</button>}
              </div>
            </div>
            {workspaceView === 'forecast' ? (
              <ForecastConfigPage
                database={database}
                project={workspaceProject}
                modules={snapshot.modules.filter((module) => module.projectId === workspaceProject.id)}
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

      {projectDialogOpen && editingProject && projectRepository && (
        <ProjectDialog
          project={editingProject}
          departments={snapshot.departments}
          modules={snapshot.modules.filter((module) => module.projectId === editingProject.id && !module.isCommon)}
          onClose={() => setProjectDialogOpen(false)}
          onSave={async (input) => { await projectRepository.save(input); await refresh() }}
        />
      )}
      {actionError && <div className="toast-error">{actionError}<button onClick={() => setActionError('')}>关闭</button></div>}
      {notice && <div className="toast-success">{notice}<button onClick={() => setNotice('')}>关闭</button></div>}
    </div>
  )
}
