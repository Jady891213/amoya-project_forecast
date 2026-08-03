import { useMemo, useState } from 'react'
import {
  Building2,
  CalendarRange,
  GitBranch,
  Layers3,
  Milestone,
  PackageOpen,
  Plus,
} from 'lucide-react'
import type { Department, DepartmentInput } from '../../shared/domain/types'
import type { AppSnapshot } from '../state/types'
import { DepartmentDialog } from '../ui/DepartmentDialog'
import { formatDateTime } from '../ui/formatters'
import { PageBreadcrumbs } from '../components/PageBreadcrumbs'

export type MasterDataTab =
  | 'projects'
  | 'departments'
  | 'modules'
  | 'periods'
  | 'scenarios'
  | 'versions'

export const MASTER_DATA_TABS = [
  { key: 'projects' as const, label: '项目', note: '项目唯一主表，只读查看', icon: PackageOpen },
  { key: 'departments' as const, label: '部门', note: '可新增、编辑与停用', icon: Building2 },
  { key: 'modules' as const, label: '业务模块', note: '项目级清单，只读查看', icon: Layers3 },
  { key: 'periods' as const, label: '期间', note: '平台内置时间维度', icon: CalendarRange },
  { key: 'scenarios' as const, label: '场景', note: '平台级场景维度', icon: GitBranch },
  { key: 'versions' as const, label: '版本', note: '平台级版本维度', icon: Milestone },
]

interface MasterDataPageProps {
  snapshot: AppSnapshot
  onSaveDepartment: (input: DepartmentInput) => Promise<void>
  onOpenProject: (projectId: string) => void
}

export function MasterDataPage({
  snapshot,
  onSaveDepartment,
  onOpenProject,
}: MasterDataPageProps) {
  const [activeTab, setActiveTab] = useState<MasterDataTab>('projects')
  const [editingDepartment, setEditingDepartment] = useState<Department>()
  const [departmentDialogOpen, setDepartmentDialogOpen] = useState(false)
  const [selectedYear, setSelectedYear] = useState(2026)
  const availableYears = useMemo(
    () => [...new Set(snapshot.periods.map((period) => period.year))].sort((left, right) => left - right),
    [snapshot.periods],
  )
  const periods = snapshot.periods.filter((period) => period.year === selectedYear)
  const activeDefinition = MASTER_DATA_TABS.find((tab) => tab.key === activeTab)
  const projectName = (id: string) =>
    snapshot.projects.find((project) => project.id === id)?.name ?? '未知项目'
  const departmentName = (id: string) =>
    snapshot.departments.find((department) => department.id === id)?.name ?? '未知部门'

  function editDepartment(department?: Department) {
    setEditingDepartment(department)
    setDepartmentDialogOpen(true)
  }

  return (
    <main className="page master-data-page">
      <div className="page-head">
        <div className="page-head-main">
          <PageBreadcrumbs items={[{ label: '平台配置' }, { label: '主数据管理' }]} />
          <h1>主数据管理</h1>
          <p>统一查看项目、部门、业务模块、期间、场景和版本；事实与计算结果回到具体项目中查看。</p>
        </div>
      </div>
      <div className="page-body">
        <div className="master-summary">
          <div className="master-summary-item"><span>项目</span><b>{snapshot.projects.length}</b><small>dim_project</small></div>
          <div className="master-summary-item"><span>部门</span><b>{snapshot.departments.length}</b><small>dim_department</small></div>
          <div className="master-summary-item"><span>业务模块</span><b>{snapshot.modules.length}</b><small>含项目公共模块</small></div>
          <div className="master-summary-item"><span>期间</span><b>{snapshot.periods.length}</b><small>dim_period</small></div>
          <div className="master-summary-item"><span>场景 / 版本</span><b>{snapshot.scenarios.length} / {snapshot.versions.length}</b><small>平台级分析维度</small></div>
        </div>

        <section className="master-layout">
          <nav className="master-groups" aria-label="主数据类型">
            {MASTER_DATA_TABS.map(({ key, label, note, icon: Icon }) => (
              <button
                key={key}
                className={`master-group ${activeTab === key ? 'active' : ''}`}
                onClick={() => setActiveTab(key)}
              >
                <Icon size={16} />
                <span><b>{label}</b><small>{note}</small></span>
              </button>
            ))}
          </nav>

          <div className="master-detail">
            <div className="section-heading">
              <div>
                <h2>{activeDefinition?.label}主数据</h2>
                <p className="muted">数据库表按 dim_ 前缀分类；页面只通过语义接口读取和维护。</p>
              </div>
              {activeTab === 'departments' ? (
                <button className="btn primary" onClick={() => editDepartment()}>
                  <Plus size={14} />新增部门
                </button>
              ) : activeTab === 'periods' ? (
                <label className="inline-filter">
                  年度
                  <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
                    {availableYears.map((year) => <option key={year} value={year}>{year}年</option>)}
                  </select>
                </label>
              ) : <span className="readonly-mark">只读</span>}
            </div>

            <div className="table-wrap tall-table">
              {activeTab === 'projects' && (
                <table>
                  <thead><tr><th>项目编码</th><th>项目名称</th><th>申报部门</th><th>开始期间</th><th>结束期间</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>{snapshot.projects.map((project) => (
                    <tr key={project.id}>
                      <td>{project.code ?? '—'}</td>
                      <td className="strong-cell">{project.name}</td>
                      <td>{departmentName(project.departmentId)}</td>
                      <td>{project.startPeriod}</td>
                      <td>{project.endPeriod}</td>
                      <td><span className={`status status-${project.status}`}>{project.status === 'calculating' ? '测算中' : '已归档'}</span></td>
                      <td><button className="text-button" onClick={() => onOpenProject(project.id)}>进入项目</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}

              {activeTab === 'departments' && (
                <table>
                  <thead><tr><th>部门编码</th><th>部门名称</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
                  <tbody>{snapshot.departments.map((department) => (
                    <tr key={department.id}>
                      <td>{department.code}</td>
                      <td className="strong-cell">{department.name}</td>
                      <td><span className={`status status-${department.status}`}>{department.status === 'active' ? '启用' : '停用'}</span></td>
                      <td>{formatDateTime(department.updatedAt)}</td>
                      <td><button className="text-button" onClick={() => editDepartment(department)}>编辑</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}

              {activeTab === 'modules' && (
                <table>
                  <thead><tr><th>项目</th><th>模块编码</th><th>模块名称</th><th>类型</th></tr></thead>
                  <tbody>{snapshot.modules.map((module) => (
                    <tr key={module.id}>
                      <td>{projectName(module.projectId)}</td>
                      <td>{module.code}</td>
                      <td className="strong-cell">{module.name}</td>
                      <td>{module.isCommon ? '系统公共模块' : '项目业务模块'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}

              {activeTab === 'periods' && (
                <table>
                  <thead><tr><th>期间</th><th>显示名称</th><th>年度</th><th>季度</th><th>月份</th><th>排序键</th></tr></thead>
                  <tbody>{periods.map((period) => (
                    <tr key={period.period}>
                      <td><code>{period.period}</code></td>
                      <td>{period.displayName}</td>
                      <td>{period.year}</td>
                      <td>Q{period.quarter}</td>
                      <td>{period.monthNumber}</td>
                      <td>{period.sortKey}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}

              {activeTab === 'scenarios' && (
                <table>
                  <thead><tr><th>场景编码</th><th>场景名称</th><th>默认场景</th><th>维护方式</th></tr></thead>
                  <tbody>{snapshot.scenarios.map((scenario) => (
                    <tr key={scenario.id}>
                      <td>{scenario.code}</td>
                      <td className="strong-cell">{scenario.name}</td>
                      <td>{scenario.isDefault ? '是' : '否'}</td>
                      <td>系统内置</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}

              {activeTab === 'versions' && (
                <table>
                  <thead><tr><th>版本编码</th><th>版本名称</th><th>类型</th><th>可修改</th><th>维护方式</th></tr></thead>
                  <tbody>{snapshot.versions.map((version) => (
                    <tr key={version.id}>
                      <td>{version.code}</td>
                      <td className="strong-cell">{version.name}</td>
                      <td>{version.status === 'working' ? '工作版本' : '只读快照'}</td>
                      <td>{version.isMutable ? '是' : '否'}</td>
                      <td>系统内置</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      </div>

      {departmentDialogOpen && (
        <DepartmentDialog
          department={editingDepartment}
          onClose={() => setDepartmentDialogOpen(false)}
          onSave={onSaveDepartment}
        />
      )}
    </main>
  )
}
