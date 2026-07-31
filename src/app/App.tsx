import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Archive,
  BarChart3,
  BriefcaseBusiness,
  Database,
  Download,
  FolderOpen,
  HardDrive,
  Plus,
  RotateCcw,
  Save,
  Sigma,
  Upload,
} from 'lucide-react'
import { ApiClient } from './api/client'
import type { AppSnapshot } from './state/types'
import type { Department, DepartmentInput, ProjectInput } from '../shared/domain/types'
import { DepartmentDialog } from './ui/DepartmentDialog'
import { ProjectWorkspacePage } from './pages/ProjectWorkspacePage'

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
  if (path === '/' || path === '/projects') return { type: 'projects', archived: false }
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

  function navigate(path: string) {
    if (dirty && !window.confirm('当前项目有未保存修改，确认离开吗？')) return
    setDirty(false)
    window.history.pushState({}, '', path)
    setRoute(parseRoute())
  }

  if (loading) return <div className="app-loading"><Database size={30} /><h1>正在连接项目数据库</h1><p>初始化语义接口和 SQLite Schema…</p></div>
  if (!api || fatalError) return <div className="app-loading error-state"><Database size={30} /><h1>本地服务连接失败</h1><p>{fatalError}</p><small>请使用根目录启动文件，不要直接双击 output/web/index.html。</small><button className="btn primary" onClick={() => window.location.reload()}>重新连接</button></div>

  const workspaceProject = route.type === 'workspace' ? snapshot.projects.find((item) => item.id === route.projectId) : undefined
  const pageTitle = workspaceProject?.name ?? (
    route.type === 'new' ? '新建项目' :
      route.type === 'master-data' ? '主数据管理' :
        route.type === 'metrics' ? '指标管理' :
          route.type === 'projects' && route.archived ? '归档项目' : '项目中心'
  )
  return <div className="app semantic-app">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><BarChart3 size={17} /></div><div><b>项目测算分析工具</b><span>本地财务与 EPM 工作台</span></div></div>
      <div className="top-context">{pageTitle}</div>
      <div className="top-actions"><span className="storage-status healthy"><HardDrive size={14} />{snapshot.storage.detail}</span><button className="top-icon-button" title="备份数据库" onClick={() => void api.backup()}><Download size={15} /></button><button className="top-icon-button" title="恢复数据库" onClick={() => restoreInput.current?.click()}><Upload size={15} /></button><input hidden ref={restoreInput} type="file" accept=".db,application/vnd.sqlite3" onChange={(event) => { const file = event.target.files?.[0]; if (file && window.confirm('恢复数据库会替换当前数据，确认继续吗？')) void api.restoreDatabase(file).then(() => refresh()).then(() => setNotice('数据库恢复成功')) }} /><span className="phase-badge">Schema v{snapshot.storage.schemaVersion}</span></div>
    </header>
    <div className="shell">
      {route.type !== 'workspace' && <aside className="global-nav"><div className="nav-section"><div className="nav-title">项目数据</div><button className={`nav-item ${route.type === 'projects' && !route.archived ? 'active' : ''}`} onClick={() => navigate('/projects')}><BriefcaseBusiness size={16} />项目列表</button><button className={`nav-item ${route.type === 'projects' && route.archived ? 'active' : ''}`} onClick={() => navigate('/projects/archived')}><Archive size={16} />归档项目</button></div><div className="nav-section"><div className="nav-title">平台配置</div><button className={`nav-item ${route.type === 'master-data' ? 'active' : ''}`} onClick={() => navigate('/master-data')}><Database size={16} />主数据管理</button><button className={`nav-item ${route.type === 'metrics' ? 'active' : ''}`} onClick={() => navigate('/metrics')}><Sigma size={16} />指标管理</button></div><div className="db-box"><b><HardDrive size={14} />本地数据库</b><span>{snapshot.storage.detail}</span><span>SQLite {snapshot.storage.sqliteVersion}</span><span>Schema v{snapshot.storage.schemaVersion}</span><span>项目 {snapshot.projects.length} 个</span><span>前端仅调用业务接口</span></div></aside>}
      {route.type === 'projects' && <ProjectList snapshot={snapshot} archived={route.archived} onNavigate={navigate} onArchive={async (id, archived) => { if (archived) await api.restore(id); else await api.archive(id); await refresh() }} />}
      {route.type === 'new' && <NewProjectPage snapshot={snapshot} onCancel={() => navigate('/projects')} onCreate={async (input) => { const workspace = await api.createProject(input); await refresh(); navigate(`/projects/${workspace.project.id}/config`) }} />}
      {route.type === 'master-data' && <MasterDataPage snapshot={snapshot} onSave={async (input) => { input.id ? await api.updateDepartment(input.id, input) : await api.createDepartment(input); await refresh() }} />}
      {route.type === 'metrics' && <MetricPage snapshot={snapshot} />}
      {route.type === 'workspace' && <ProjectWorkspacePage api={api} snapshot={snapshot} projectId={route.projectId} view={route.view} onNavigate={navigate} onRefresh={refresh} onDirtyChange={setDirty} />}
    </div>
    {notice && <div className="toast-success">{notice}<button onClick={() => setNotice('')}>关闭</button></div>}
  </div>
}

function ProjectList({ snapshot, archived, onNavigate, onArchive }: { snapshot: AppSnapshot; archived: boolean; onNavigate: (path: string) => void; onArchive: (id: string, archived: boolean) => Promise<void> }) {
  const projects = snapshot.projects.filter((item) => archived ? item.status === 'archived' : item.status === 'calculating')
  const department = (id: string) => snapshot.departments.find((item) => item.id === id)?.name ?? '—'
  return <main className="page"><div className="page-head"><div><h1>{archived ? '归档项目' : '项目中心'}</h1><p>{archived ? '归档项目只读保留，恢复后继续测算。' : '进入项目后统一维护项目信息、预测配置、计算工作表和报告。'}</p></div>{!archived && <button className="btn primary" onClick={() => onNavigate('/projects/new/config')}><Plus size={14} />新建项目</button>}</div><div className="page-body"><div className="data-panel"><table className="data-table"><thead><tr><th>项目</th><th>客户</th><th>部门</th><th>经营期间</th><th>草稿修订</th><th>状态</th><th>操作</th></tr></thead><tbody>{projects.map((project) => <tr key={project.id}><td><b>{project.name}</b><small>{project.code || '无项目编码'}</small></td><td>{project.customer || '—'}</td><td>{department(project.departmentId)}</td><td>{project.startPeriod} · {project.durationMonths}个月</td><td>R{project.draftRevision}</td><td><span className={`status status-${project.status}`}>{project.status === 'calculating' ? '测算中' : '已归档'}</span></td><td><div className="row-actions"><button className="action-link" onClick={() => onNavigate(`/projects/${project.id}/${archived ? 'report' : 'config'}`)}><FolderOpen size={13} />进入项目</button><button className="action-link muted-action" onClick={() => void onArchive(project.id, archived)}>{archived ? <RotateCcw size={13} /> : <Archive size={13} />}{archived ? '恢复' : '归档'}</button></div></td></tr>)}{projects.length === 0 && <tr><td colSpan={7} className="empty-cell">暂无项目</td></tr>}</tbody></table></div></div></main>
}

function NewProjectPage({ snapshot, onCancel, onCreate }: { snapshot: AppSnapshot; onCancel: () => void; onCreate: (input: ProjectInput) => Promise<void> }) {
  const firstDepartment = snapshot.departments.find((item) => item.status === 'active')
  const [draft, setDraft] = useState<ProjectInput>({ name: '', code: '', customer: '', departmentId: firstDepartment?.id ?? '', owner: '', startPeriod: new Date().toISOString().slice(0, 7), durationMonths: 12, remark: '', modules: [] })
  const [error, setError] = useState('')
  const patch = (values: Partial<ProjectInput>) => setDraft((current) => ({ ...current, ...values }))
  return <main className="page"><div className="page-head"><div><h1>新建项目</h1><p>先登记项目级信息；首次保存后进入完整项目配置。</p></div></div><div className="page-body"><section className="new-project-form"><div className="project-information-grid"><label>项目编码<input value={draft.code} onChange={(e) => patch({ code: e.target.value })} /></label><label>项目名称<input value={draft.name} onChange={(e) => patch({ name: e.target.value })} /></label><label>客户<input value={draft.customer} onChange={(e) => patch({ customer: e.target.value })} /></label><label>部门<select value={draft.departmentId} onChange={(e) => patch({ departmentId: e.target.value })}>{snapshot.departments.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>负责人<input value={draft.owner} onChange={(e) => patch({ owner: e.target.value })} /></label><label>开始期间<input type="month" value={draft.startPeriod} onChange={(e) => patch({ startPeriod: e.target.value })} /></label><label>经营周期（月）<input type="number" min={1} max={36} value={draft.durationMonths} onChange={(e) => patch({ durationMonths: Number(e.target.value) })} /></label><label className="project-remark">备注<input value={draft.remark} onChange={(e) => patch({ remark: e.target.value })} /></label></div>{error && <div className="page-alert error">{error}</div>}<div className="form-footer"><button className="btn" onClick={onCancel}>取消</button><button className="btn primary" onClick={() => void onCreate(draft).catch((reason) => setError(reason instanceof Error ? reason.message : '创建失败'))}><Save size={14} />保存并进入项目</button></div></section></div></main>
}

function MasterDataPage({ snapshot, onSave }: { snapshot: AppSnapshot; onSave: (input: DepartmentInput) => Promise<void> }) {
  const [dialog, setDialog] = useState<Department | undefined | null>(null)
  return <main className="page"><div className="page-head"><div><h1>主数据管理</h1><p>项目、部门、业务模块、期间、场景和版本；事实数据不在此维护。</p></div><button className="btn primary" onClick={() => setDialog(undefined)}><Plus size={14} />新增部门</button></div><div className="page-body"><div className="data-panel"><table className="data-table"><thead><tr><th>部门编码</th><th>部门名称</th><th>状态</th><th>项目数</th><th>操作</th></tr></thead><tbody>{snapshot.departments.map((department) => <tr key={department.id}><td>{department.code}</td><td>{department.name}</td><td>{department.status === 'active' ? '启用' : '停用'}</td><td>{snapshot.projects.filter((item) => item.departmentId === department.id).length}</td><td><button className="action-link" onClick={() => setDialog(department)}>编辑</button></td></tr>)}</tbody></table></div></div>{dialog !== null && <DepartmentDialog department={dialog} onClose={() => setDialog(null)} onSave={onSave} />}</main>
}

function MetricPage({ snapshot }: { snapshot: AppSnapshot }) {
  return <main className="page"><div className="page-head"><div><h1>指标管理</h1><p>基础指标与系统计算指标统一管理；项目特有公式不进入全局指标。</p></div></div><div className="page-body"><div className="data-panel"><table className="data-table"><thead><tr><th>编码</th><th>指标</th><th>类型</th><th>分类</th><th>表达式</th><th>期间汇总</th><th>说明</th></tr></thead><tbody>{snapshot.metrics.map((metric) => <tr key={metric.code}><td><code>{metric.code}</code></td><td>{metric.name}</td><td>{metric.metricType === 'base' ? '基础指标' : '系统计算'}</td><td>{metric.category === 'profit' ? '损益' : '现金流'}</td><td>{metric.expression || '事实写入'}</td><td>{metric.periodAggregation}</td><td>{metric.description}</td></tr>)}</tbody></table></div></div></main>
}
