import { useCallback, useEffect, useState } from 'react'
import {
  Archive,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Calculator,
  Database,
  Download,
  HardDrive,
  Info,
  Layers3,
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
import { APP_VERSION } from './version'
import { nextProjectCode } from '../shared/domain/projectCode'
import { DatabaseRestoreModal } from './ui/DatabaseRestoreModal'

type Route =
  | { type: 'projects'; archived: boolean }
  | { type: 'new' }
  | { type: 'workspace'; projectId: string; view: 'config' | 'calculation' | 'report'; planId?: string }
  | { type: 'master-data' }
  | { type: 'metrics' }
  | { type: 'multidimensional' }

const emptySnapshot: AppSnapshot = {
  departments: [], projects: [], periods: [], scenarios: [], plans: [], metrics: [], facts: [],
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
    planId: new URLSearchParams(window.location.search).get('planId') ?? undefined,
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
  const [restoreOpen, setRestoreOpen] = useState(false)

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
  if (!api || fatalError) return <div className="app-loading error-state"><Database size={30} /><h1>本地服务连接失败</h1><p>{fatalError}</p><small>请使用根目录启动文件，不要直接双击 dist/index.html。</small><button className="btn primary" onClick={() => window.location.reload()}>重新连接</button></div>

  return <div className={`app semantic-app ${navCollapsed ? 'nav-collapsed' : ''}`}>
    <div className="shell">
      <aside className="global-nav">
        <div className="sidebar-header"><div className="sidebar-brand"><div className="brand-mark"><BarChart3 size={17} /></div><div className="sidebar-brand-copy"><b>项目测算分析工具</b><div className="sidebar-brand-meta"><span title={`软件版本 v${APP_VERSION}`}>v{APP_VERSION}</span><a href="https://github.com/Jady891213/amoya-project_forecast" target="_blank" rel="noreferrer" aria-label="打开 GitHub 项目主页" title="GitHub 项目主页"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.64 0 8.13c0 3.59 2.29 6.64 5.47 7.71.4.08.55-.18.55-.39 0-.19-.01-.83-.01-1.51-2.01.38-2.53-.5-2.69-.96-.09-.23-.48-.96-.82-1.15-.28-.15-.68-.53-.01-.54.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.21-3.64-.91-3.64-4.02 0-.89.31-1.62.82-2.19-.08-.2-.36-1.04.08-2.16 0 0 .67-.22 2.2.84A7.4 7.4 0 0 1 8 3.91a7.4 7.4 0 0 1 2 .27c1.53-1.06 2.2-.84 2.2-.84.44 1.12.16 1.96.08 2.16.51.57.82 1.3.82 2.19 0 3.12-1.87 3.81-3.65 4.02.29.25.54.74.54 1.51 0 1.09-.01 1.97-.01 2.24 0 .22.15.47.55.39A8.13 8.13 0 0 0 16 8.13C16 3.64 12.42 0 8 0Z" /></svg></a></div></div></div><button type="button" className="sidebar-collapse" aria-label={navCollapsed ? '展开侧边栏' : '收起侧边栏'} title={navCollapsed ? '展开侧边栏' : '收起侧边栏'} onClick={toggleNavigation}>{navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
        <div className="nav-section"><div className="nav-title">项目数据</div><button title="项目列表" className={`nav-item ${route.type === 'projects' || route.type === 'new' || route.type === 'workspace' ? 'active' : ''}`} onClick={openProjectArea}><BriefcaseBusiness size={16} /><span className="nav-label">项目列表</span></button><button title="项目报表" className={`nav-item ${route.type === 'multidimensional' ? 'active' : ''}`} onClick={() => navigate('/multidimensional')}><Table2 size={16} /><span className="nav-label">项目报表</span></button></div>
        <div className="nav-section"><div className="nav-title">平台配置</div><button title="主数据管理" className={`nav-item ${route.type === 'master-data' ? 'active' : ''}`} onClick={() => navigate('/master-data')}><Database size={16} /><span className="nav-label">主数据管理</span></button><button title="指标管理" className={`nav-item ${route.type === 'metrics' ? 'active' : ''}`} onClick={() => navigate('/metrics')}><Sigma size={16} /><span className="nav-label">指标管理</span></button></div>
        <div className="sidebar-footer">
          <div className="db-box"><b><HardDrive size={14} /><span className="db-box-label">本地数据库</span><span className="db-info" tabIndex={0} aria-label="查看本地数据库说明"><Info size={13} /><span className="db-info-tooltip" role="tooltip">数据自动保存在本机<br />SQLite {snapshot.storage.sqliteVersion}<br />数据结构版本 {snapshot.storage.schemaVersion}</span></span></b><div className="db-box-details"><span>{snapshot.storage.detail.split(' · ')[0] || 'amoya_project_forecast.db'}</span><span>共 {snapshot.projects.length} 个项目</span></div><div className="sidebar-db-actions"><button type="button" title="导出完整数据备份" aria-label="导出完整数据备份" onClick={() => void api.backup()}><Download size={14} /><span>备份</span></button><button type="button" title="从备份恢复全部项目" aria-label="从备份恢复全部项目" onClick={() => setRestoreOpen(true)}><Upload size={14} /><span>恢复</span></button></div></div>
        </div>
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
      {route.type === 'workspace' && <ProjectWorkspacePage key={`${route.projectId}:${route.view}:${route.planId ?? 'default'}`} api={api} snapshot={snapshot} projectId={route.projectId} planId={route.planId} view={route.view} onNavigate={navigate} onRefresh={refresh} onDirtyChange={setDirty} />}
    </div>
    {notice && <div className="toast-success">{notice}<button onClick={() => setNotice('')}>关闭</button></div>}
    <DatabaseRestoreModal
      open={restoreOpen}
      onClose={() => setRestoreOpen(false)}
      onRestore={async (file) => {
        await api.restoreDatabase(file)
        await refresh()
        setNotice('项目数据恢复成功')
      }}
    />
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
  const activeProjectIds = new Set(snapshot.projects.filter((item) => item.status === 'calculating').map((item) => item.id))
  const calculatedProjectCount = new Set(snapshot.facts.filter((item) => activeProjectIds.has(item.projectId)).map((item) => item.projectId)).size
  const activePlanCount = snapshot.plans.filter((item) => item.status === 'active').length
  const activeDepartmentCount = snapshot.departments.filter((item) => item.status === 'active').length
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
      <section className="project-kpi-grid" aria-label="项目概览">
        <article className="project-kpi-card"><span className="project-kpi-icon"><BriefcaseBusiness size={18} /></span><div><span>测算中项目</span><b>{activeCount}</b><small>另有 {archivedCount} 个归档项目</small></div></article>
        <article className="project-kpi-card"><span className="project-kpi-icon green"><Calculator size={18} /></span><div><span>已有测算结果</span><b>{calculatedProjectCount}</b><small>{Math.max(0, activeCount - calculatedProjectCount)} 个项目待计算</small></div></article>
        <article className="project-kpi-card"><span className="project-kpi-icon purple"><Layers3 size={18} /></span><div><span>有效测算方案</span><b>{activePlanCount}</b><small>支持同项目多方案</small></div></article>
        <article className="project-kpi-card"><span className="project-kpi-icon amber"><Building2 size={18} /></span><div><span>启用申报部门</span><b>{activeDepartmentCount}</b><small>随主数据同步更新</small></div></article>
      </section>
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

function NewProjectPage({ snapshot, onCancel, onCreate }: { snapshot: AppSnapshot; onCancel: () => void; onCreate: (input: import('../shared/domain/types').CreateProjectInput) => Promise<void> }) {
  const firstDepartment = snapshot.departments.find((item) => item.status === 'active')
  const currentPeriod = new Date().toISOString().slice(0, 7)
  const [draft, setDraft] = useState<import('../shared/domain/types').CreateProjectInput>({ name: '', code: nextProjectCode(snapshot.projects.map((item) => item.code)), departmentId: firstDepartment?.id ?? '', startPeriod: currentPeriod, endPeriod: addMonths(currentPeriod, 11) })
  const [error, setError] = useState('')
  const patch = (values: Partial<import('../shared/domain/types').CreateProjectInput>) => setDraft((current) => ({ ...current, ...values }))
  const periodCount = countPeriods(draft.startPeriod, draft.endPeriod)
  return <main className="page"><div className="page-head"><div className="page-head-main"><PageBreadcrumbs items={[{ label: '项目管理', onClick: onCancel }, { label: '新建项目' }]} /><h1>新建项目</h1></div></div><div className="page-body"><section className="new-project-form"><h2>项目信息</h2><div className="project-information-grid compact-project-master-form"><label>项目编码<input value={draft.code} onChange={(e) => patch({ code: e.target.value })} /></label><label>项目名称<input value={draft.name} onChange={(e) => patch({ name: e.target.value })} /></label><label>申报部门<select value={draft.departmentId} onChange={(e) => patch({ departmentId: e.target.value })}>{snapshot.departments.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><h2 className="new-project-section-title">业务参数</h2><div className="project-information-grid project-period-fields"><label>开始期间<input type="month" value={draft.startPeriod} onChange={(e) => patch({ startPeriod: e.target.value })} /></label><label>结束期间<input type="month" value={draft.endPeriod} onChange={(e) => patch({ endPeriod: e.target.value })} /></label><div className={`period-count-preview ${periodCount < 1 ? 'error' : ''}`}><span>项目周期</span><b>{periodCount < 1 ? '结束期间不能早于开始期间' : `共 ${periodCount} 个月`}</b></div></div>{error && <div className="page-alert error">{error}</div>}<div className="form-footer"><button className="btn" onClick={onCancel}>取消</button><button className="btn primary" disabled={periodCount < 1} onClick={() => void onCreate(draft).catch((reason) => setError(reason instanceof Error ? reason.message : '创建失败'))}><Save size={14} />保存并进入项目</button></div></section></div></main>
}

function MetricPage({ snapshot }: { snapshot: AppSnapshot }) {
  const calculatedCount = snapshot.metrics.filter((item) => item.metricType === 'calculated').length
  const leafCount = snapshot.metrics.filter((item) => item.metricType === 'base' && item.isLeaf).length
  const summaryCount = snapshot.metrics.filter((item) => item.metricType === 'base' && !item.isLeaf).length
  const profitCount = snapshot.metrics.filter((item) => item.category === 'profit').length
  const cashCount = snapshot.metrics.length - profitCount
  const aggregationLabel: Record<string, string> = { sum: '求和', recompute: '重新计算', ending: '期末值' }
  return <main className="page">
    <div className="page-head"><div className="page-head-main"><PageBreadcrumbs items={[{ label: '平台配置' }, { label: '指标管理' }]} /><h1>指标管理</h1><p>基础指标与系统计算指标统一管理；项目特有公式不进入全局指标。</p></div></div>
    <div className="page-body metric-management-page">
      <section className="project-kpi-grid metric-kpi-grid" aria-label="指标概览">
        <article className="project-kpi-card"><span className="project-kpi-icon"><BarChart3 size={18} /></span><div><span>指标总数</span><b>{snapshot.metrics.length}</b><small>统一指标维度成员</small></div></article>
        <article className="project-kpi-card"><span className="project-kpi-icon green"><Database size={18} /></span><div><span>明细指标</span><b>{leafCount}</b><small>预测行与现金事实归属</small></div></article>
        <article className="project-kpi-card"><span className="project-kpi-icon purple"><Sigma size={18} /></span><div><span>系统计算</span><b>{calculatedCount}</b><small>按统一公式动态计算</small></div></article>
        <article className="project-kpi-card"><span className="project-kpi-icon amber"><Layers3 size={18} /></span><div><span>汇总指标</span><b>{summaryCount}</b><small>损益 {profitCount} · 现金流 {cashCount}</small></div></article>
      </section>
      <div className="project-list-context"><b>指标定义</b><span>共 {snapshot.metrics.length} 个</span></div>
      <div className="data-panel"><table className="data-table metric-management-table"><thead><tr><th>编码</th><th>指标</th><th>父级</th><th>级次</th><th>性质</th><th>分类</th><th>计算定义</th><th>期间汇总</th><th>说明</th></tr></thead><tbody>{snapshot.metrics.map((metric) => {
        const parent = metric.parentCode ? snapshot.metrics.find((item) => item.code === metric.parentCode) : undefined
        const nature = metric.metricType === 'calculated' ? '计算指标' : metric.isLeaf ? '明细指标' : '汇总指标'
        return <tr key={metric.code}>
        <td><code>{metric.code}</code></td>
        <td><b className="metric-name-cell" style={{ paddingLeft: `${metric.hierarchyLevel * 18}px` }}>{metric.hierarchyLevel > 0 ? '└ ' : ''}{metric.name}</b></td>
        <td>{parent?.name ?? '—'}</td><td>{metric.hierarchyLevel + 1} 级</td>
        <td><span className={`metric-pill ${metric.metricType === 'calculated' ? 'calculated' : metric.isLeaf ? 'base' : 'profit'}`}>{nature}</span></td>
        <td><span className={`metric-pill ${metric.category === 'profit' ? 'profit' : 'cash'}`}>{metric.category === 'profit' ? '损益' : '现金流'}</span></td>
        <td>{metric.expression ? <span className="metric-expression"><Sigma size={13} />{metric.expression}</span> : <span className="metric-fact-label">事实录入</span>}</td>
        <td><span className="metric-aggregation-pill">{aggregationLabel[metric.periodAggregation] ?? metric.periodAggregation}</span></td>
        <td className="metric-description-cell">{metric.description}</td>
      </tr>})}</tbody></table></div>
    </div>
  </main>
}
