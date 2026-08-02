import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Archive,
  BarChart3,
  BriefcaseBusiness,
  Database,
  Download,
  FolderOpen,
  HardDrive,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Save,
  Sigma,
  Upload,
} from 'lucide-react'
import { ApiClient } from './api/client'
import type { AppSnapshot } from './state/types'
import type { ProjectInput } from '../shared/domain/types'
import { ProjectWorkspacePage } from './pages/ProjectWorkspacePage'
import { MasterDataPage } from './pages/MasterDataPage'
import { PageBreadcrumbs } from './components/PageBreadcrumbs'

type Route =
  | { type: 'projects'; archived: boolean }
  | { type: 'new' }
  | { type: 'workspace'; projectId: string; view: 'config' | 'calculation' | 'report' }
  | { type: 'master-data' }
  | { type: 'metrics' }

const emptySnapshot: AppSnapshot = {
  departments: [], projects: [], modules: [], periods: [], scenarios: [], versions: [], metrics: [], facts: [],
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
  }
  if (path === '/master-data') return { type: 'master-data' }
  if (path === '/metrics') return { type: 'metrics' }
  return { type: 'projects', archived: false }
}

export default function App() {
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
      if (dirty && !window.confirm('当前项目有未保存修改，确认离开吗？')) {
        window.history.forward(); return
      }
      setDirty(false); setRoute(parseRoute())
    }
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [dirty])

  useEffect(() => {
    if (route.type !== 'projects' && route.type !== 'workspace') return
    const currentPath = `${window.location.pathname}${window.location.search}`
    setLastProjectPath(currentPath)
    window.sessionStorage.setItem('amoya-last-project-path', currentPath)
  }, [route])

  function navigate(path: string) {
    if (dirty && !window.confirm('当前项目有未保存修改，确认离开吗？')) return
    setDirty(false)
    window.history.pushState({}, '', path)
    setRoute(parseRoute())
  }

  function toggleNavigation() {
    setNavCollapsed((current) => {
      const next = !current
      window.localStorage.setItem('amoya-nav-collapsed', next ? '1' : '0')
      return next
    })
  }

  function openProjectArea() {
    if (route.type === 'master-data' || route.type === 'metrics') {
      navigate(lastProjectPath)
      return
    }
    navigate('/projects')
  }

  if (loading) return <div className="app-loading"><Database size={30} /><h1>正在连接项目数据库</h1><p>初始化语义接口和 SQLite Schema…</p></div>
  if (!api || fatalError) return <div className="app-loading error-state"><Database size={30} /><h1>本地服务连接失败</h1><p>{fatalError}</p><small>请使用根目录启动文件，不要直接双击 output/web/index.html。</small><button className="btn primary" onClick={() => window.location.reload()}>重新连接</button></div>

  return <div className={`app semantic-app ${navCollapsed ? 'nav-collapsed' : ''}`}>
    <div className="shell">
      <aside className="global-nav">
        <div className="sidebar-header"><div className="sidebar-brand"><div className="brand-mark"><BarChart3 size={17} /></div><div className="sidebar-brand-copy"><b>项目测算分析工具</b><span>本地财务与 EPM 工作台</span></div></div><button type="button" className="sidebar-collapse" aria-label={navCollapsed ? '展开侧边栏' : '收起侧边栏'} title={navCollapsed ? '展开侧边栏' : '收起侧边栏'} onClick={toggleNavigation}>{navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
        <div className="nav-section"><div className="nav-title">项目数据</div><button title="项目列表" className={`nav-item ${route.type === 'projects' || route.type === 'new' || route.type === 'workspace' ? 'active' : ''}`} onClick={openProjectArea}><BriefcaseBusiness size={16} /><span className="nav-label">项目列表</span></button></div>
        <div className="nav-section"><div className="nav-title">平台配置</div><button title="主数据管理" className={`nav-item ${route.type === 'master-data' ? 'active' : ''}`} onClick={() => navigate('/master-data')}><Database size={16} /><span className="nav-label">主数据管理</span></button><button title="指标管理" className={`nav-item ${route.type === 'metrics' ? 'active' : ''}`} onClick={() => navigate('/metrics')}><Sigma size={16} /><span className="nav-label">指标管理</span></button></div>
        <div className="sidebar-footer">
          <div className="db-box"><b><HardDrive size={14} /><span className="db-box-label">本地数据库</span></b><div className="db-box-details"><span>{snapshot.storage.detail}</span><span>SQLite {snapshot.storage.sqliteVersion}</span><span>Schema v{snapshot.storage.schemaVersion} · 项目 {snapshot.projects.length} 个</span></div><div className="sidebar-db-actions"><button type="button" title="备份数据库" aria-label="备份数据库" onClick={() => void api.backup()}><Download size={14} /><span>备份</span></button><button type="button" title="恢复数据库" aria-label="恢复数据库" onClick={() => restoreInput.current?.click()}><Upload size={14} /><span>恢复</span></button></div></div>
        </div>
        <input hidden ref={restoreInput} type="file" accept=".db,application/vnd.sqlite3" onChange={(event) => { const file = event.target.files?.[0]; if (file && window.confirm('恢复数据库会替换当前数据，确认继续吗？')) void api.restoreDatabase(file).then(() => refresh()).then(() => setNotice('数据库恢复成功')) }} />
      </aside>
      {route.type === 'projects' && <ProjectList snapshot={snapshot} archived={route.archived} onNavigate={navigate} onArchive={async (id, archived) => { if (archived) await api.restore(id); else await api.archive(id); await refresh() }} />}
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
      {route.type === 'workspace' && <ProjectWorkspacePage api={api} snapshot={snapshot} projectId={route.projectId} view={route.view} onNavigate={navigate} onRefresh={refresh} onDirtyChange={setDirty} />}
    </div>
    {notice && <div className="toast-success">{notice}<button onClick={() => setNotice('')}>关闭</button></div>}
  </div>
}

function ProjectList({ snapshot, archived, onNavigate, onArchive }: { snapshot: AppSnapshot; archived: boolean; onNavigate: (path: string) => void; onArchive: (id: string, archived: boolean) => Promise<void> }) {
  const projects = snapshot.projects.filter((item) => archived ? item.status === 'archived' : item.status === 'calculating')
  const activeCount = snapshot.projects.filter((item) => item.status === 'calculating').length
  const archivedCount = snapshot.projects.filter((item) => item.status === 'archived').length
  const department = (id: string) => snapshot.departments.find((item) => item.id === id)?.name ?? '—'
  return <main className="page"><div className="page-head"><div className="page-head-main"><PageBreadcrumbs items={[{ label: '项目管理' }, { label: archived ? '归档项目' : '测算中项目' }]} /><h1>项目中心</h1><p>{archived ? '当前显示已归档项目；恢复后可继续测算。' : '进入项目后统一维护项目信息、预测配置、计算工作表和报告。'}</p></div><div className="page-head-actions"><button className={`project-archive-switch ${archived ? 'active' : ''}`} role="switch" aria-checked={archived} onClick={() => onNavigate(archived ? '/projects' : '/projects?view=archived')}><span className="switch-track"><span /></span><Archive size={14} />查看归档<span className="switch-count">{archivedCount}</span></button><button className="btn primary" onClick={() => onNavigate('/projects/new/config')}><Plus size={14} />新建项目</button></div></div><div className="page-body"><div className="project-list-context"><b>{archived ? '已归档项目' : '测算中项目'}</b><span>共 {archived ? archivedCount : activeCount} 个</span></div><div className="data-panel"><table className="data-table"><thead><tr><th>项目</th><th>客户</th><th>部门</th><th>经营期间</th><th>草稿修订</th><th>状态</th><th>操作</th></tr></thead><tbody>{projects.map((project) => <tr key={project.id}><td><b>{project.name}</b><small>{project.code || '无项目编码'}</small></td><td>{project.customer || '—'}</td><td>{department(project.departmentId)}</td><td>{project.startPeriod} · {project.durationMonths}个月</td><td>R{project.draftRevision}</td><td><span className={`status status-${project.status}`}>{project.status === 'calculating' ? '测算中' : '已归档'}</span></td><td><div className="row-actions"><button className="action-link" onClick={() => onNavigate(`/projects/${project.id}/${archived ? 'report' : 'config'}`)}><FolderOpen size={13} />进入项目</button><button className="action-link muted-action" onClick={() => void onArchive(project.id, archived)}>{archived ? <RotateCcw size={13} /> : <Archive size={13} />}{archived ? '恢复' : '归档'}</button></div></td></tr>)}{projects.length === 0 && <tr><td colSpan={7} className="empty-cell">{archived ? '当前没有归档项目' : '当前没有测算中的项目'}</td></tr>}</tbody></table></div></div></main>
}

function NewProjectPage({ snapshot, onCancel, onCreate }: { snapshot: AppSnapshot; onCancel: () => void; onCreate: (input: ProjectInput) => Promise<void> }) {
  const firstDepartment = snapshot.departments.find((item) => item.status === 'active')
  const [draft, setDraft] = useState<ProjectInput>({ name: '', code: '', customer: '', departmentId: firstDepartment?.id ?? '', owner: '', startPeriod: new Date().toISOString().slice(0, 7), durationMonths: 12, remark: '', modules: [] })
  const [error, setError] = useState('')
  const patch = (values: Partial<ProjectInput>) => setDraft((current) => ({ ...current, ...values }))
  return <main className="page"><div className="page-head"><div className="page-head-main"><PageBreadcrumbs items={[{ label: '项目管理', onClick: onCancel }, { label: '新建项目' }]} /><h1>新建项目</h1><p>先登记项目级信息；首次保存后进入完整项目配置。</p></div></div><div className="page-body"><section className="new-project-form"><div className="project-information-grid"><label>项目编码<input value={draft.code} onChange={(e) => patch({ code: e.target.value })} /></label><label>项目名称<input value={draft.name} onChange={(e) => patch({ name: e.target.value })} /></label><label>客户<input value={draft.customer} onChange={(e) => patch({ customer: e.target.value })} /></label><label>部门<select value={draft.departmentId} onChange={(e) => patch({ departmentId: e.target.value })}>{snapshot.departments.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>负责人<input value={draft.owner} onChange={(e) => patch({ owner: e.target.value })} /></label><label>开始期间<input type="month" value={draft.startPeriod} onChange={(e) => patch({ startPeriod: e.target.value })} /></label><label>经营周期（月）<input type="number" min={1} max={36} value={draft.durationMonths} onChange={(e) => patch({ durationMonths: Number(e.target.value) })} /></label><label className="project-remark">备注<input value={draft.remark} onChange={(e) => patch({ remark: e.target.value })} /></label></div>{error && <div className="page-alert error">{error}</div>}<div className="form-footer"><button className="btn" onClick={onCancel}>取消</button><button className="btn primary" onClick={() => void onCreate(draft).catch((reason) => setError(reason instanceof Error ? reason.message : '创建失败'))}><Save size={14} />保存并进入项目</button></div></section></div></main>
}

function MetricPage({ snapshot }: { snapshot: AppSnapshot }) {
  return <main className="page"><div className="page-head"><div className="page-head-main"><PageBreadcrumbs items={[{ label: '平台配置' }, { label: '指标管理' }]} /><h1>指标管理</h1><p>基础指标与系统计算指标统一管理；项目特有公式不进入全局指标。</p></div></div><div className="page-body"><div className="data-panel"><table className="data-table"><thead><tr><th>编码</th><th>指标</th><th>类型</th><th>分类</th><th>表达式</th><th>期间汇总</th><th>说明</th></tr></thead><tbody>{snapshot.metrics.map((metric) => <tr key={metric.code}><td><code>{metric.code}</code></td><td>{metric.name}</td><td>{metric.metricType === 'base' ? '基础指标' : '系统计算'}</td><td>{metric.category === 'profit' ? '损益' : '现金流'}</td><td>{metric.expression || '事实写入'}</td><td>{metric.periodAggregation}</td><td>{metric.description}</td></tr>)}</tbody></table></div></div></main>
}
