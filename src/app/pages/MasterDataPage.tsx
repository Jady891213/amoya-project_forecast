import { useMemo, useState } from 'react'
import {
  Building2,
  CalendarRange,
  GitBranch,
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
  | 'periods'
  | 'scenarios'
  | 'plans'

export const MASTER_DATA_TABS = [
  { key: 'projects' as const, label: '项目', note: '项目唯一主表，只读查看', icon: PackageOpen },
  { key: 'plans' as const, label: '方案', note: '项目下属方案，只读查看', icon: Milestone },
  { key: 'departments' as const, label: '部门', note: '可新增、编辑与停用', icon: Building2 },
  { key: 'periods' as const, label: '期间', note: '2024年至2030年', icon: CalendarRange, dividerBefore: true },
  { key: 'scenarios' as const, label: '场景', note: '平台级场景维度', icon: GitBranch },
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
  const visiblePeriods = useMemo(
    () => snapshot.periods.filter((period) => period.year >= 2024 && period.year <= 2030),
    [snapshot.periods],
  )
  const availableYears = useMemo(
    () => [...new Set(visiblePeriods.map((period) => period.year))].sort((left, right) => left - right),
    [visiblePeriods],
  )
  const periods = visiblePeriods.filter((period) => period.year === selectedYear)
  const activeDefinition = MASTER_DATA_TABS.find((tab) => tab.key === activeTab)
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
          <p>统一查看项目、方案、部门、期间和场景；事实与计算结果回到具体项目中查看。</p>
        </div>
      </div>
      <div className="page-body">
        <div className="master-summary">
          <div className="master-summary-item"><span>项目</span><b>{snapshot.projects.length}</b><small>dim_project</small></div>
          <div className="master-summary-item"><span>方案</span><b>{snapshot.plans.length}</b><small>dim_plan</small></div>
          <div className="master-summary-item"><span>部门</span><b>{snapshot.departments.length}</b><small>dim_department</small></div>
          <div className="master-summary-item"><span>期间</span><b>{visiblePeriods.length}</b><small>dim_period</small></div>
          <div className="master-summary-item"><span>场景</span><b>{snapshot.scenarios.length}</b><small>dim_scenario</small></div>
        </div>

        <section className="master-layout">
          <nav className="master-groups" aria-label="主数据类型">
            {MASTER_DATA_TABS.map(({ key, label, note, icon: Icon, dividerBefore }) => (
              <button
                key={key}
                className={`master-group ${dividerBefore ? 'divider-before' : ''} ${activeTab === key ? 'active' : ''}`}
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
              ) : activeTab === 'projects' ? (
                <span className="readonly-mark">随项目管理同步</span>
              ) : activeTab === 'plans' ? (
                <span className="readonly-mark">随方案管理同步</span>
              ) : <span className="readonly-mark">系统维护</span>}
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

              {activeTab === 'plans' && (
                <table>
                  <thead><tr><th>方案ID</th><th>所属项目</th><th>方案名称</th><th>期间</th><th>状态</th></tr></thead>
                  <tbody>{snapshot.plans.map((plan) => (
                    <tr key={plan.planId}>
                      <td><code>{plan.planId}</code></td>
                      <td>{snapshot.projects.find((project) => project.id === plan.projectId)?.name ?? '—'}</td>
                      <td className="strong-cell">{plan.name}</td>
                      <td>{plan.startPeriod} 至 {plan.endPeriod}</td>
                      <td>{plan.status === 'active' ? (plan.isDefault ? '有效 · 默认' : '有效') : '已归档'}</td>
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
