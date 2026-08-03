import { useMemo, useState } from 'react'
import { Archive, FolderOpen, Plus, RotateCcw } from 'lucide-react'
import type { DatabaseClient } from '../../storage/types'
import type { Project, ProjectInput } from '../../domain/types'
import type { AppSnapshot } from '../../state/types'
import { ProjectRepository } from '../../repositories/projectRepository'
import { ProjectDialog } from '../../ui/ProjectDialog'
import { formatDateTime } from '../../ui/formatters'
import { PageBreadcrumbs } from '../../components/PageBreadcrumbs'

interface ProjectCenterPageProps {
  database: DatabaseClient
  snapshot: AppSnapshot
  onRefresh: () => Promise<void>
  onOpenProject: (projectId: string, archived: boolean) => void
}

export function ProjectCenterPage({
  database,
  snapshot,
  onRefresh,
  onOpenProject,
}: ProjectCenterPageProps) {
  const [showArchived, setShowArchived] = useState(false)
  const [query, setQuery] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [error, setError] = useState('')
  const projectRepository = useMemo(
    () => new ProjectRepository(database),
    [database],
  )

  const projects = snapshot.projects.filter((project) => {
    if (!showArchived && project.status !== 'calculating') return false
    if (showArchived && project.status !== 'archived') return false
    if (departmentId && project.departmentId !== departmentId) return false
    if (!query.trim()) return true
    const department =
      snapshot.departments.find((item) => item.id === project.departmentId)
        ?.name ?? ''
    return [project.name, project.code, department]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  })

  const departmentName = (id: string) =>
    snapshot.departments.find((department) => department.id === id)?.name ??
    '未找到部门'

  function openNewProject() {
    const canCreate = snapshot.departments.some(
      (department) =>
        department.origin === 'user' && department.status === 'active',
    )
    if (!canCreate) {
      setError('请先在“主数据管理”中新增一个启用状态的用户部门')
      return
    }
    setDialogOpen(true)
  }

  async function saveProject(input: ProjectInput) {
    await projectRepository.save(input)
    await onRefresh()
  }

  async function updateStatus(project: Project) {
    setError('')
    try {
      if (project.status === 'calculating') {
        await projectRepository.archive(project.id)
      } else {
        await projectRepository.restore(project.id)
      }
      await onRefresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head-main">
          <PageBreadcrumbs items={[{ label: '项目管理' }, { label: showArchived ? '归档项目' : '测算中项目' }]} />
          <h1>项目中心</h1>
          <p>
            {!showArchived
              ? '管理正在测算的项目；进入项目后查看计算结果与财务报表。'
              : '当前显示已归档项目；恢复后可继续测算。'}
          </p>
        </div>
        <div className="page-head-actions">
          <button className={`project-archive-switch ${showArchived ? 'active' : ''}`} role="switch" aria-checked={showArchived} onClick={() => setShowArchived((current) => !current)}><span className="switch-track"><span /></span><Archive size={14} />查看归档<span className="switch-count">{snapshot.projects.filter((item) => item.status === 'archived').length}</span></button>
          <button className="btn primary" onClick={openNewProject}>
            <Plus size={14} /> 新建项目
          </button>
        </div>
      </div>

      <div className="page-body">
        <div className="section-bar">
          <input
            className="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目名称或申报部门"
          />
          <select
            className="select"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">全部部门</option>
            {snapshot.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <span className="result-count">共 {projects.length} 个项目</span>
        </div>

        <div className="summary-line">
          <span>
            测算中项目
            <b>{snapshot.projects.filter((item) => item.status === 'calculating').length}</b>
          </span>
          <span>
            已归档
            <b>{snapshot.projects.filter((item) => item.status === 'archived').length}</b>
          </span>
          <span>
            已有事实
            <b>{snapshot.projects.filter((project) => snapshot.facts.some((fact) => fact.projectId === project.id)).length}</b>
          </span>
          <span>
            暂无事实
            <b>{snapshot.projects.filter((project) => !snapshot.facts.some((fact) => fact.projectId === project.id)).length}</b>
          </span>
        </div>

        {error && <div className="page-alert error">{error}</div>}

        <div className="data-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '24%' }}>项目名称</th>
                <th>申报部门</th>
                <th>项目期间</th>
                <th>数据状态</th>
                <th>项目状态</th>
                <th style={{ width: 180 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const factCount = snapshot.facts.filter(
                  (fact) => fact.projectId === project.id,
                ).length
                return (
                  <tr key={project.id}>
                    <td>
                      <span className="project-name">{project.name}</span>
                      <span className="sub">
                        {project.code || '无业务编码'} · {formatDateTime(project.updatedAt)}
                      </span>
                    </td>
                    <td>{departmentName(project.departmentId)}</td>
                    <td>{project.startPeriod}—{project.endPeriod}</td>
                    <td>
                      <span className="sub">{factCount > 0 ? `${factCount} 条事实` : '暂无事实'}</span>
                    </td>
                    <td>
                      <span className={`status status-${project.status}`}>
                        {project.status === 'calculating' ? '测算中' : '已归档'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="action-link"
                          onClick={() => onOpenProject(project.id, showArchived)}
                        >
                          <FolderOpen size={13} /> 进入项目
                        </button>
                        {project.origin === 'user' && (
                          <button
                            className="action-link muted-action"
                            onClick={() => updateStatus(project)}
                          >
                            {project.status === 'calculating' ? <Archive size={13} /> : <RotateCcw size={13} />}
                            {project.status === 'calculating' ? '归档' : '恢复'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    {!showArchived
                      ? '当前没有符合条件的测算中项目'
                      : '当前没有归档项目'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="empty-hint">
            项目只使用“测算中／已归档”两种状态；当前阶段不包含审核流或跨项目分析。
          </div>
        </div>
      </div>

      {dialogOpen && (
        <ProjectDialog
          departments={snapshot.departments}
          modules={[]}
          onClose={() => setDialogOpen(false)}
          onSave={saveProject}
        />
      )}
    </>
  )
}
