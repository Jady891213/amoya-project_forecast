import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Archive,
  BarChart3,
  BriefcaseBusiness,
  Database,
  Download,
  HardDrive,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Save,
  Sigma,
  Table2,
  Upload,
} from 'lucide-react'
import { ApiClient } from './api/client'
import type { AppSnapshot } from './state/types'
import type { ProjectInput } from '../shared/domain/types'
import { addMonths, countPeriods } from '../shared/domain/periods'
import { ProjectWorkspacePage } from './pages/ProjectWorkspacePage'
import { MasterDataPage } from './pages/MasterDataPage'
import { PageBreadcrumbs } from './components/PageBreadcrumbs'
import { useAppDialog } from './ui/AppDialog'
import { MultidimensionalViewPage } from './pages/MultidimensionalViewPage'

type Route =
  | { type: 'projects'; archived: boolean }
  | { type: 'new' }
  | { type: 'workspace'; projectId: string; view: 'config' | 'calculation' | 'report'; versionId?: string }
  | { type: 'master-data' }
  | { type: 'metrics' }
  | { type: 'multidimensional' }

const emptySnapshot: AppSnapshot = {
  departments: [], projects: [], periods: [], scenarios: [], versions: [], metrics: [], facts: [],
  storage: { mode: 'transient', label: '连接中', detail: '', sqliteVersion: '', schemaVersion: 0, persistent: false },
}

function parseRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, '') || '/projects'
  if (path === '/' || path === '/projects') return {
    type: 'projects',
    archived: new URLSearchParams(window.location.search).get('view') === 'archived',
  }
  if (path === '/projects/archived') return { type: 'projects', archived: true }
  if (path === '/projects/new/config') return { type: 'new' }
  const workspace = path.match(/^\/projects\/([^/]+)\/(config|calculation|report)$/)
  if (workspace) return {
    type: 'workspace',
    projectId: decodeURIComponent(workspace[1]),
    view: workspace[2] as 'config' | 'calculation' | 'report',
    versionId: new URLSearchParams(window.location.search).get('versionId') ?? undefined,
  }
  if (path === '/master-data') return { type: 'master-data' }
  if (path === '/metrics') return { type: 'metrics' }
  if (path === '/multidimensional') return { type: 'multidimensional' }
  return { type: 'projects', archived: false }
}

export default function App() {
  const dialog = useAppDialog()
  const [api, setApi] = useState<ApiClient>()
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot)
  const [route, setRoute] = useState<Route>(parseRoute)
  const [loading, setLoading] = useState(true)
  const [fatalError, setFatalError] = useState('')
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(() => window.localStorage.getItem('amoya-nav-collapsed') === '1')
  const [lastProjectPath, setLastProjectPath] = useState(() => window.sessionStorage.getItem('amoya-last-project-path') || '/projects')
  const restoreInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async (client = api) => {
    if (!client) return
    const result = await client.bootstrap()
    setSnapshot(result.snapshot)
  }, [api])

  useEffect(() => {
    let cancelled = false
    void ApiClient.create().then(async (client) => {
      if (cancelled) return
      setApi(client)
      const result = await client.bootstrap()
      if (!cancelled) setSnapshot(result.snapshot)
    }).catch((reason) => {
      if (!cancelled) setFatalError(reason instanceof Error ? reason.message : '应用初始化失败')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const pop = () => {
      if (!dirty) { setRoute(parseRoute()); return }
      const target = `${window.location.pathname}${window.location.search}`
      window.history.forward()
      void dialog.confirm({
        title: '离开当前项目？',
        message: '当前项目有未保存修改，离开后这些修改将会丢失。',
        tone: 'warning',
        confirmLabel: '放弃修改并离开',
      }).then((confirmed) => {
        if (!confirmed) return
        setDirty(false)
        window.history.pushState({}, '', target)
        setRoute(parseRoute())
      })
    }
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [dialog, dirty])

  useEffect(() => {
    if (route.type !== 'projects' && route.type !== 'workspace') return
    const currentPath = `${window.location.pathname}${window.location.search}`
    setLastProjectPath(currentPath)
    window.sessionStorage.setItem('amoya-last-project-path', currentPath)
  }, [route])

  async function navigate(path: string) {
    if (dirty && !await dialog.confirm({
      title: '离开当前项目？',
      message: '当前项目有未保存修改，离开后这些修改将会丢失。',
      tone: 'warning',
      confirmLabel: '放弃修改并离开',
    })) return
    setDirty(false)
    window.history.pushState({}, '', path)
    setRoute(parseRoute())
  }

  async function restoreDatabase(file?: File) {
    if (!file) return
    try {
      const confirmed = await dialog.confirm({
        title: '恢复本地数据？',
        message: `将从“${file.name}”恢复全部项目，当前数据库内容会被替换。建议先备份现有数据。`,
        tone: 'danger',
        confirmLabel: '确认恢复',
      })
      if (!confirmed) return
      await api?.restoreDatabase(file)
      await refresh()
      setNotice('项目数据恢复成功')
    } catch (reason) {
      await dialog.alert(reason instanceof Error ? reason.message : '项目数据恢复失败', {
        title: '恢复失败',
        tone: 'danger',
      })
    } finally {
      if (restoreInput.current) restoreInput.current.value = ''
    }
  }

  function toggleNavigation() {
    setNavCollapsed((current) => {
      const next = !current
      window.localStorage.setItem('amoya-nav-collapsed', next ? '1' : '0')
      return next
    })
  }

  function openProjectArea() {
    if (route.type === 'master-data' || route.type === 'metrics' || route.type === 'multidimensional') {
      navigate(lastProjectPath)
      return
    }
    navigate('/projects')
  }

  if (loading) return <div className="app-loading"><Database size={30} /><h1>正在打开本地项目数据</h1><p>正在准备项目和测算内容…</p></div>
  if (!api || fatalError) return <div className="app-loading error-state"><Database size={30} /><h1>本地服务连接失败</h1><p>{fatalError}</p><small>请使用根目录启动文件，不要直接双击 output/web/index.html。</small><button className="btn primary" onClick={() => window.location.reload()}>重新连接</button></div>

  return <div className={`app semantic-app ${navCollapsed ? 'nav-collapsed' : ''}`}>
    <div className="shell">
      <aside className="global-nav">
        <div className="sidebar-header"><div className="sidebar-brand"><div className="brand-mark"><BarChart3 size={17} /></div><div className="sidebar-brand-copy"><b>项目测算分析工具</b><span>本地财务与 EPM 工作台</span></div></div><button type="button" className="sidebar-collapse" aria-label={navCollapsed ? '展开侧边栏' : '收起侧边栏'} title={navCollapsed ? '展开侧边栏' : '收起侧边栏'} onClick={toggleNavigation}>{navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
        <div className="nav-section"><div className="nav-title">项目数据</div><button title="项目列表" className={`nav-item ${route.type === 'projects' || route.type === 'new' || route.type === 'workspace' ? 'active' : ''}`} onClick={openProjectArea}><BriefcaseBusiness size={16} /><span className="nav-label">项目列表</span></button><button title="多维测算" className={`nav-item ${route.type === 'multidimensional' ? 'active' : ''}`} onClick={() => navigate('/multidimensional')}><Table2 size={16} /><span className="nav-label">多维测算</span></button></div>
        <div className="nav-section"><div className="nav-title">平台配置</div><button title="主数据管理" className={`nav-item ${route.type === 'master-data' ? 'active' : ''}`} onClick={() => navigate('/master-data')}><Database size={16} /><span className="nav-label">主数据管理</span></button><button title="指标管理" className={`nav-item ${route.type === 'metrics' ? 'active' : ''}`} onClick={() => navigate('/metrics')}><Sigma size={16} /><span className="nav-label">指标管理</span></button></div>
        <div className="sidebar-footer">
          <div className="db-box"><b><HardDrive size={14} /><span className="db-box-label">本地数据库</span><span className="db-info" tabIndex={0} aria-label="查看本地数据库说明"><Info size={13} /><span className="db-info-tooltip" role="tooltip">数据自动保存在本机<br />SQLite {snapshot.storage.sqliteVersion}<br />数据结构版本 {snapshot.storage.schemaVersion}</span></span></b><div className="db-box-details"><span>{snapshot.storage.detail.split(' · ')[0] || 'amoya_project_forecast.db'}</span><span>共 {snapshot.projects.length} 个项目</span></div><div className="sidebar-db-actions"><button type="button" title="导出完整数据备份" aria-label="导出完整数据备份" onClick={() => void api.backup()}><Download size={14} /><span>备份</span></button><button type="button" title="从备份恢复全部项目" aria-label="从备份恢复全部项目" onClick={() => restoreInput.current?.click()}><Upload size={14} /><span>恢复</span></button></div></div>
        </div>
        <input hidden ref={restoreInput} type="file" accept=".db,application/vnd.sqlite3" onChange={(event) => void restoreDatabase(event.target.files?.[0])} />
      </aside>
      {route.type === 'projects' && <ProjectList snapshot={snapshot} archived={route.archived} onNavigate={navigate} onArchive={async (id, archived) => { if (archived) await api.restore(id); else await api.archive(id); await refresh() }} onCopy={async (id) => { const copied = await api.copyProject(id); await refresh(); setNotice('项目已复制'); navigate(`/projects/${copied.project.id}/config`) }} onDelete={async (id) => { await api.deleteProject(id); await refresh(); setNotice('项目已删除') }} />}
      {route.type === 'new' && <NewProjectPage snapshot={snapshot} onCancel={() => navigate('/projects')} onCreate={async (input) => { const workspace = await api.createProject(input); await refresh(); navigate(`/projects/${workspace.project.id}/config`) }} />}
      {route.type === 'master-data' && <MasterDataPage
        snapshot={snapshot}
        onOpenProject={(projectId) => navigate(`/projects/${projectId}/config`)}
        onSaveDepartment={async (input) => {
          input.id ? await api.updateDepartment(input.id, input) : await api.createDepartment(input)
          await refresh()
        }}
      />}
      {route.type === 'metrics' && <MetricPage snapshot={snapshot} />}
      {route.type === 'multidimensional' && <MultidimensionalViewPage api={api} snapshot={snapshot} />}
      {route.type === 'workspace' && <ProjectWorkspacePage key={`${route.projectId}:${route.view}:${route.versionId ?? 'default'}`} api={api} snapshot={snapshot} projectId={route.projectId} versionId={route.versionId} view={route.view} onNavigate={navigate} onRefresh={refresh} onDirtyChange={setDirty} />}
    </div>
    {notice && <div className="toast-success">{notice}<button onClick={() => setNotice('')}>关闭</button></div>}
  </div>
}

function ProjectList({ snapshot, archived, onNavigate, onArchive, onCopy, onDelete }: {
  snapshot: AppSnapshot
  archived: boolean
  onNavigate: (path: string) => void
  onArchive: (id: string, archived: boolean) => Promise<void>
  onCopy: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const dialog = useAppDialog()
  const projects = snapshot.projects.filter((item) => archived ? item.status === 'archived' : item.status === 'calculating')
  const activeCount = snapshot.projects.filter((item) => item.status === 'calculating').length
  const archivedCount = snapshot.projects.filter((item) => item.status === 'archived').length
  const department = (id: string) => snapshot.departments.find((item) => item.id === id)?.name ?? '—'
  const openProject = (projectId: string) => onNavigate(`/projects/${projectId}/${archived ? 'report' : 'config'}`)
  const runAction = async (action: () => Promise<void>) => {
    try {
      await action()
    } catch (reason) {
      await dialog.alert(reason instanceof Error ? reason.message : '项目操作失败', { tone: 'danger' })
    }
  }

  async function deleteProject(projectId: string, projectName: string) {
    const confirmed = await dialog.confirm({
      title: '永久删除项目？',
      message: `“${projectName}”的项目配置、计算结果和报告将一并删除，且无法恢复。`,
      tone: 'danger',
      confirmLabel: '永久删除',
    })
    if (confirmed) await runAction(() => onDelete(projectId))
  }

  return <main className="page">
    <div className="page-head">
      <div className="page-head-main">
        <PageBreadcrumbs items={[{ label: '项目管理' }, { label: archived ? '归档项目' : '测算中项目' }]} />
        <h1>项目中心</h1>
        <p>{archived ? '当前显示已归档项目；恢复后可继续测算。' : '点击项目名称或整行即可进入项目。'}</p>
      </div>
      <div className="page-head-actions">
        <button className={`project-archive-switch ${archived ? 'active' : ''}`} role="switch" aria-checked={archived} onClick={() => onNavigate(archived ? '/projects' : '/projects?view=archived')}><span className="switch-track"><span /></span><Archive size={14} />查看归档<span className="switch-count">{archivedCount}</span></button>
        <button className="btn primary" onClick={() => onNavigate('/projects/new/config')}><Plus size={14} />新建项目</button>
      </div>
    </div>
    <div className="page-body">
      <div className="project-list-context"><b>{archived ? '已归档项目' : '测算中项目'}</b><span>共 {archived ? archivedCount : activeCount} 个</span></div>
      <div className="data-panel">
        <table className="data-table project-list-table">
          <thead><tr><th>项目</th><th>申报部门</th><th>项目期间</th><th>月数</th><th>最近更新</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {projects.map((project) => <tr key={project.id} className="clickable-project-row" onClick={() => openProject(project.id)}>
              <td><button className="project-name-button" onClick={(event) => { event.stopPropagation(); openProject(project.id) }}><b>{project.name}</b><small>{project.code || '无项目编码'}</small></button></td>
              <td>{department(project.departmentId)}</td>
              <td>{project.startPeriod} 至 {project.endPeriod}</td>
              <td>{countPeriods(project.startPeriod, project.endPeriod)}个月</td>
              <td>{new Date(project.updatedAt).toLocaleDateString('zh-CN')}</td>
              <td><span className={`status status-${project.status}`}>{project.status === 'calculating' ? '测算中' : '已归档'}</span></td>
              <td><div className="row-actions">
                {archived ? <>
                  <button className="action-link" onClick={(event) => { event.stopPropagation(); void runAction(() => onArchive(project.id, true)) }}>恢复</button>
                  <button className="action-link danger-action" title="永久删除项目" onClick={(event) => { event.stopPropagation(); void deleteProject(project.id, project.name) }}>删除</button>
                </> : <>
                  <button className="action-link" title="复制项目配置" onClick={(event) => { event.stopPropagation(); void runAction(() => onCopy(project.id)) }}>复制</button>
                  <button className="action-link muted-action" onClick={(event) => { event.stopPropagation(); void runAction(() => onArchive(project.id, false)) }}>归档</button>
                </>}
              </div></td>
            </tr>)}
            {projects.length === 0 && <tr><td colSpan={7} className="empty-cell">{archived ? '当前没有归档项目' : '当前没有测算中的项目'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  </main>
}

function NewProjectPage({ snapshot, onCancel, onCreate }: { snapshot: AppSnapshot; onCancel: () => void; onCreate: (input: ProjectInput) => Promise<void> }) {
  const firstDepartment = snapshot.departments.find((item) => item.status === 'active')
  const currentPeriod = new Date().toISOString().slice(0, 7)
  const [draft, setDraft] = useState<ProjectInput>({ name: '', code: '', departmentId: firstDepartment?.id ?? '', startPeriod: currentPeriod, endPeriod: addMonths(currentPeriod, 11) })
  const [error, setError] = useState('')
  const patch = (values: Partial<ProjectInput>) => setDraft((current) => ({ ...current, ...values }))
  const periodCount = countPeriods(draft.startPeriod, draft.endPeriod)
  return <main className="page"><div className="page-head"><div className="page-head-main"><PageBreadcrumbs items={[{ label: '项目管理', onClick: onCancel }, { label: '新建项目' }]} /><h1>新建项目</h1></div></div><div className="page-body"><section className="new-project-form"><h2>项目信息</h2><div className="project-information-grid compact-project-master-form"><label>项目编码<input value={draft.code} onChange={(e) => patch({ code: e.target.value })} /></label><label>项目名称<input value={draft.name} onChange={(e) => patch({ name: e.target.value })} /></label><label>申报部门<select value={draft.departmentId} onChange={(e) => patch({ departmentId: e.target.value })}>{snapshot.departments.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><h2 className="new-project-section-title">业务参数</h2><div className="project-information-grid project-period-fields"><label>开始期间<input type="month" value={draft.startPeriod} onChange={(e) => patch({ startPeriod: e.target.value })} /></label><label>结束期间<input type="month" value={draft.endPeriod} onChange={(e) => patch({ endPeriod: e.target.value })} /></label><div className={`period-count-preview ${periodCount < 1 ? 'error' : ''}`}><span>项目周期</span><b>{periodCount < 1 ? '结束期间不能早于开始期间' : `共 ${periodCount} 个月`}</b></div></div>{error && <div className="page-alert error">{error}</div>}<div className="form-footer"><button className="btn" onClick={onCancel}>取消</button><button className="btn primary" disabled={periodCount < 1} onClick={() => void onCreate(draft).catch((reason) => setError(reason instanceof Error ? reason.message : '创建失败'))}><Save size={14} />保存并进入项目</button></div></section></div></main>
}

function MetricPage({ snapshot }: { snapshot: AppSnapshot }) {
  return <main className="page"><div className="page-head"><div className="page-head-main"><PageBreadcrumbs items={[{ label: '平台配置' }, { label: '指标管理' }]} /><h1>指标管理</h1><p>基础指标与系统计算指标统一管理；项目特有公式不进入全局指标。</p></div></div><div className="page-body"><div className="data-panel"><table className="data-table"><thead><tr><th>编码</th><th>指标</th><th>类型</th><th>分类</th><th>表达式</th><th>期间汇总</th><th>说明</th></tr></thead><tbody>{snapshot.metrics.map((metric) => <tr key={metric.code}><td><code>{metric.code}</code></td><td>{metric.name}</td><td>{metric.metricType === 'base' ? '基础指标' : '系统计算'}</td><td>{metric.category === 'profit' ? '损益' : '现金流'}</td><td>{metric.expression || '事实写入'}</td><td>{metric.periodAggregation}</td><td>{metric.description}</td></tr>)}</tbody></table></div></div></main>
}
