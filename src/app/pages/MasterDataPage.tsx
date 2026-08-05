import { useMemo, useState } from 'react'
import {
  Building2,
  CalendarRange,
  GitBranch,
  Milestone,
  PackageOpen,
  Plus,
} from 'lucide-react'
import type { Department, DepartmentInput, PivotPeriodLevel } from '../../shared/domain/types'
import type { AppSnapshot } from '../state/types'
import { DepartmentDialog } from '../ui/DepartmentDialog'
import { formatDateTime } from '../ui/formatters'
import { PageBreadcrumbs } from '../components/PageBreadcrumbs'
import { ResizableTable, type ResizableColumn } from '../components/ResizableTable'

const PERIOD_LEVEL_LABELS: Record<PivotPeriodLevel, string> = { month: '月度', quarter: '季度', year: '年度' }

const MASTER_TABLE_COLUMNS: Record<MasterDataTab, ResizableColumn[]> = {
  projects: [
    { key: 'code', label: '项目编码', width: 132 }, { key: 'name', label: '项目名称', width: 220, minWidth: 150 },
    { key: 'department', label: '申报部门', width: 160 }, { key: 'start', label: '开始期间', width: 96 },
    { key: 'end', label: '结束期间', width: 96 }, { key: 'status', label: '状态', width: 82 },
    { key: 'action', label: '操作', width: 86 },
  ],
  plans: [
    { key: 'id', label: '方案ID', width: 240, minWidth: 160 }, { key: 'project', label: '所属项目', width: 240, minWidth: 160 },
    { key: 'name', label: '方案名称', width: 160 }, { key: 'period', label: '期间', width: 190 },
    { key: 'status', label: '状态', width: 86 },
  ],
  departments: [
    { key: 'code', label: '部门编码', width: 150 }, { key: 'name', label: '部门名称', width: 240, minWidth: 150 },
    { key: 'status', label: '状态', width: 90 }, { key: 'updatedAt', label: '更新时间', width: 180 },
    { key: 'action', label: '操作', width: 86 },
  ],
  periods: [
    { key: 'member', label: '期间成员', width: 150 }, { key: 'name', label: '显示名称', width: 180 },
    { key: 'level', label: '层级', width: 86 }, { key: 'year', label: '年度', width: 86 },
    { key: 'quarter', label: '季度', width: 86 }, { key: 'months', label: '包含月份', width: 96 },
    { key: 'sort', label: '排序键', width: 100 },
  ],
  scenarios: [
    { key: 'code', label: '场景编码', width: 180 }, { key: 'name', label: '场景名称', width: 220, minWidth: 150 },
    { key: 'default', label: '默认场景', width: 110 }, { key: 'maintenance', label: '维护方式', width: 160 },
  ],
}

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
  const [periodLevel, setPeriodLevel] = useState<PivotPeriodLevel>('month')
  const visiblePeriods = useMemo(
    () => snapshot.periods.filter((period) => period.year >= 2024 && period.year <= 2030),
    [snapshot.periods],
  )
  const availableYears = useMemo(
    () => [...new Set(visiblePeriods.map((period) => period.year))].sort((left, right) => left - right),
    [visiblePeriods],
  )
  const periods = visiblePeriods.filter((period) => period.year === selectedYear)
  const periodHierarchyRows = useMemo(() => {
    if (periodLevel === 'month') return periods.map((period) => ({ id: period.period, label: period.displayName, year: period.year, quarter: `Q${period.quarter}`, memberCount: 1, sortKey: period.sortKey }))
    if (periodLevel === 'quarter') return [1, 2, 3, 4].map((quarter) => ({ id: `${selectedYear}-Q${quarter}`, label: `${selectedYear}年 Q${quarter}`, year: selectedYear, quarter: `Q${quarter}`, memberCount: 3, sortKey: selectedYear * 10 + quarter }))
    return [{ id: String(selectedYear), label: `${selectedYear}年`, year: selectedYear, quarter: '—', memberCount: 12, sortKey: selectedYear }]
  }, [periodLevel, periods, selectedYear])
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
                <div className="master-period-filters"><label className="inline-filter">层级<select value={periodLevel} onChange={(event) => setPeriodLevel(event.target.value as PivotPeriodLevel)}><option value="month">月度</option><option value="quarter">季度</option><option value="year">年度</option></select></label><label className="inline-filter">年度<select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>{availableYears.map((year) => <option key={year} value={year}>{year}年</option>)}</select></label></div>
              ) : activeTab === 'projects' ? (
                <span className="readonly-mark">随项目管理同步</span>
              ) : activeTab === 'plans' ? (
                <span className="readonly-mark">随方案管理同步</span>
              ) : <span className="readonly-mark">系统维护</span>}
            </div>

            <div className="table-wrap tall-table">
              {activeTab === 'projects' && (
                <ResizableTable columns={MASTER_TABLE_COLUMNS.projects} storageKey="amoya-table-widths-master-projects-v1">
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
                </ResizableTable>
              )}

              {activeTab === 'departments' && (
                <ResizableTable columns={MASTER_TABLE_COLUMNS.departments} storageKey="amoya-table-widths-master-departments-v1">
                  <tbody>{snapshot.departments.map((department) => (
                    <tr key={department.id}>
                      <td>{department.code}</td>
                      <td className="strong-cell">{department.name}</td>
                      <td><span className={`status status-${department.status}`}>{department.status === 'active' ? '启用' : '停用'}</span></td>
                      <td>{formatDateTime(department.updatedAt)}</td>
                      <td><button className="text-button" onClick={() => editDepartment(department)}>编辑</button></td>
                    </tr>
                  ))}</tbody>
                </ResizableTable>
              )}

              {activeTab === 'periods' && (
                <ResizableTable columns={MASTER_TABLE_COLUMNS.periods} storageKey="amoya-table-widths-master-periods-v1">
                  <tbody>{periodHierarchyRows.map((period) => (
                    <tr key={period.id}>
                      <td><code>{period.id}</code></td>
                      <td>{period.label}</td>
                      <td>{PERIOD_LEVEL_LABELS[periodLevel]}</td>
                      <td>{period.year}</td>
                      <td>{period.quarter}</td>
                      <td>{period.memberCount}</td>
                      <td>{period.sortKey}</td>
                    </tr>
                  ))}</tbody>
                </ResizableTable>
              )}

              {activeTab === 'scenarios' && (
                <ResizableTable columns={MASTER_TABLE_COLUMNS.scenarios} storageKey="amoya-table-widths-master-scenarios-v1">
                  <tbody>{snapshot.scenarios.map((scenario) => (
                    <tr key={scenario.id}>
                      <td>{scenario.code}</td>
                      <td className="strong-cell">{scenario.name}</td>
                      <td>{scenario.isDefault ? '是' : '否'}</td>
                      <td>系统内置</td>
                    </tr>
                  ))}</tbody>
                </ResizableTable>
              )}

              {activeTab === 'plans' && (
                <ResizableTable columns={MASTER_TABLE_COLUMNS.plans} storageKey="amoya-table-widths-master-plans-v1">
                  <tbody>{snapshot.plans.map((plan) => (
                    <tr key={plan.planId}>
                      <td><code>{plan.planId}</code></td>
                      <td>{snapshot.projects.find((project) => project.id === plan.projectId)?.name ?? '—'}</td>
                      <td className="strong-cell">{plan.name}</td>
                      <td>{plan.startPeriod} 至 {plan.endPeriod}</td>
                      <td>{plan.status === 'active' ? '有效' : '已归档'}</td>
                    </tr>
                  ))}</tbody>
                </ResizableTable>
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
