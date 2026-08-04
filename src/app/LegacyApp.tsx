import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  BarChart3,
  BriefcaseBusiness,
  Calculator,
  Database,
  Download,
  FileChartColumn,
  HardDrive,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  Sigma,
  TableProperties,
  Upload,
} from 'lucide-react'
import { createDatabase } from './storage/createDatabase'
import type { DatabaseClient, StorageRuntimeInfo } from './storage/types'
import type { AppSnapshot } from './state/types'
import { DepartmentRepository } from './repositories/departmentRepository'
import { DimensionRepository } from './repositories/dimensionRepository'
import { ProjectPlanRepository } from '../server/repositories/projectPlanRepository'
import { FactRepository } from './repositories/factRepository'
import { MetricRepository } from './repositories/metricRepository'
import { ProjectRepository } from './repositories/projectRepository'
import { ReferenceDatasetService } from './services/referenceDatasetService'
import { DatabaseBackupService } from './services/databaseBackupService'
import { ProjectCenterPage } from './legacy/pages/ProjectCenterPage'
import { DataFoundationPage } from './legacy/pages/DataFoundationPage'
import { MetricDefinitionsPage } from './legacy/pages/MetricDefinitionsPage'
import { ProjectReportPage } from './legacy/pages/ProjectReportPage'
import { ForecastConfigPage } from './legacy/pages/ForecastConfigPage'
import { PageBreadcrumbs } from './components/PageBreadcrumbs'
import { useAppDialog } from './ui/AppDialog'

type AppRoute = 'projects' | 'master-data' | 'metrics'
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
  periods: [],
  scenarios: [],
  plans: [],
  metrics: [],
  facts: [],
  storage: bootStorage,
}

export default function App() {
  const dialog = useAppDialog()
  const [database, setDatabase] = useState<DatabaseClient>()
  const [route, setRoute] = useState<AppRoute>('projects')
  const [workspaceProjectId, setWorkspaceProjectId] = useState('')
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('forecast')
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot)
  const [loading, setLoading] = useState(true)
  const [fatalError, setFatalError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [navCollapsed, setNavCollapsed] = useState(() => window.localStorage.getItem('amoya-nav-collapsed') === '1')
  const [lastWorkspaceProjectId, setLastWorkspaceProjectId] = useState('')
  const [lastWorkspaceView, setLastWorkspaceView] = useState<WorkspaceView>('forecast')
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
    const [departments, projects, periods, scenarios, plans, metrics, facts] =
      await Promise.all([
        new DepartmentRepository(client).list(),
        projectsRepo.list(),
        dimensions.listPeriods(),
        dimensions.listScenarios(),
        new ProjectPlanRepository(client).listAll(),
        new MetricRepository(client).list(),
        new FactRepository(client).list(),
      ])
    setSnapshot({
      departments,
      projects,
      periods,
      scenarios,
      plans,
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

  useEffect(() => {
    if (!workspaceProjectId) return
    setLastWorkspaceProjectId(workspaceProjectId)
    setLastWorkspaceView(workspaceView)
  }, [workspaceProjectId, workspaceView])

  const workspaceProject = snapshot.projects.find((project) => project.id === workspaceProjectId)

  async function archiveWorkspaceProject() {
    if (!workspaceProject || workspaceProject.origin !== 'user' || !projectRepository) return
    try {
      await projectRepository.archive(workspaceProject.id)
      await refresh()
      setWorkspaceProjectId('')
      setRoute('projects')
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '归档失败')
    }
  }

  async function restoreDatabase(file?: File) {
    if (!file || !backupService) return
    try {
      if (!await dialog.confirm({
        title: '恢复本地数据？',
        message: `将从“${file.name}”恢复全部项目，当前数据库内容会被替换。建议先备份现有数据。`,
        tone: 'danger',
        confirmLabel: '确认恢复',
      })) return
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

  function toggleNavigation() {
    setNavCollapsed((current) => {
      const next = !current
      window.localStorage.setItem('amoya-nav-collapsed', next ? '1' : '0')
      return next
    })
  }

  function openWorkspace(projectId: string, view: WorkspaceView) {
    setWorkspaceProjectId(projectId)
    setWorkspaceView(view)
  }

  function openPlatformRoute(nextRoute: Exclude<AppRoute, 'projects'>) {
    setWorkspaceProjectId('')
    setRoute(nextRoute)
  }

  function openProjectArea() {
    if (!workspaceProject && route !== 'projects' && lastWorkspaceProjectId && snapshot.projects.some((project) => project.id === lastWorkspaceProjectId)) {
      openWorkspace(lastWorkspaceProjectId, lastWorkspaceView)
      return
    }
    setWorkspaceProjectId('')
    setLastWorkspaceProjectId('')
    setRoute('projects')
  }

  if (loading) {
    return <div className="app-loading"><Database size={30} /><h1>正在连接本地数据服务</h1><p>校验 SQLite 数据库、结构版本与基础数据…</p></div>
  }
  if (fatalError || !database) {
    return <div className="app-loading error-state"><Database size={30} /><h1>本地数据服务连接失败</h1><p>{fatalError}</p><small>请双击根目录启动文件，或进入 src 执行 pnpm start:local；不要直接打开 output/web/index.html。</small><button className="btn primary" onClick={() => window.location.reload()}>重新连接</button></div>
  }

  return (
    <div className={`app ${navCollapsed ? 'nav-collapsed' : ''}`}>
      <div className="shell">
        <aside className="global-nav">
            <div className="sidebar-header"><div className="sidebar-brand"><div className="brand-mark"><BarChart3 size={17} /></div><div className="sidebar-brand-copy"><b>项目测算分析工具</b><span>本地财务与 EPM 工作台</span></div></div><button type="button" className="sidebar-collapse" aria-label={navCollapsed ? '展开侧边栏' : '收起侧边栏'} title={navCollapsed ? '展开侧边栏' : '收起侧边栏'} onClick={toggleNavigation}>{navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
            <div className="nav-section">
              <div className="nav-title">项目数据</div>
              <button title="项目列表" className={`nav-item ${route === 'projects' || workspaceProject ? 'active' : ''}`} onClick={openProjectArea}><BriefcaseBusiness size={16} /><span className="nav-label">项目列表</span></button>
            </div>
            <div className="nav-section">
              <div className="nav-title">平台配置</div>
              <button title="主数据管理" className={`nav-item ${route === 'master-data' && !workspaceProject ? 'active' : ''}`} onClick={() => openPlatformRoute('master-data')}><Database size={16} /><span className="nav-label">主数据管理</span></button>
              <button title="指标管理" className={`nav-item ${route === 'metrics' && !workspaceProject ? 'active' : ''}`} onClick={() => openPlatformRoute('metrics')}><Sigma size={16} /><span className="nav-label">指标管理</span></button>
            </div>
            <div className="sidebar-footer">
              <div className="db-box"><b><HardDrive size={14} /><span className="db-box-label">本地数据库</span><span className="db-info" tabIndex={0} aria-label="查看本地数据库说明"><Info size={13} /><span className="db-info-tooltip" role="tooltip">数据保存在当前浏览器<br />SQLite {snapshot.storage.sqliteVersion}<br />数据结构版本 {snapshot.storage.schemaVersion}</span></span></b><div className="db-box-details"><span>amoya_project_forecast.db</span><span>共 {snapshot.projects.length} 个项目</span>{snapshot.storage.mode === 'portable' && <span className="portable-db-note">关闭前请备份数据</span>}</div><div className="sidebar-db-actions"><button onClick={() => void backupService?.download()} title="导出完整数据备份" aria-label="导出完整数据备份"><Download size={14} /><span>备份</span></button><button onClick={() => importInput.current?.click()} title="从备份恢复全部项目" aria-label="从备份恢复全部项目"><Upload size={14} /><span>恢复</span></button></div></div>
            </div>
            <input ref={importInput} hidden type="file" accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3" onChange={(event) => void restoreDatabase(event.target.files?.[0])} />
          </aside>

        {workspaceProject ? (
          <main className="workspace">
            <div className="workspace-head">
              <div className="workspace-heading"><PageBreadcrumbs back={{ label: '返回', onClick: openProjectArea }} items={[{ label: workspaceProject.name }]} /></div>
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
            {route === 'projects' && <ProjectCenterPage database={database} snapshot={snapshot} onRefresh={refresh} onOpenProject={(id, archived) => openWorkspace(id, archived ? 'report' : 'forecast')} />}
            {route === 'master-data' && <DataFoundationPage database={database} snapshot={snapshot} onRefresh={refresh} onOpenReport={(id) => openWorkspace(id, 'calculation')} />}
            {route === 'metrics' && <MetricDefinitionsPage metrics={snapshot.metrics} />}
          </main>
        )}
      </div>

      {actionError && <div className="toast-error">{actionError}<button onClick={() => setActionError('')}>关闭</button></div>}
      {notice && <div className="toast-success">{notice}<button onClick={() => setNotice('')}>关闭</button></div>}
    </div>
  )
}
