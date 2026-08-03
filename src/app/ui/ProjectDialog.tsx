import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type {
  Department,
  Project,
  ProjectInput,
} from '../domain/types'
import { addMonths } from '../domain/periods'

interface ProjectDialogProps {
  project?: Project
  departments: Department[]
  onClose: () => void
  onSave: (input: ProjectInput) => Promise<void>
}

export function ProjectDialog({
  project,
  departments,
  onClose,
  onSave,
}: ProjectDialogProps) {
  const [code, setCode] = useState(project?.code ?? '')
  const [name, setName] = useState(project?.name ?? '')
  const [departmentId, setDepartmentId] = useState(
    project?.departmentId ??
      departments.find(
        (department) =>
          department.origin === 'user' && department.status === 'active',
      )?.id ??
      '',
  )
  const [startPeriod, setStartPeriod] = useState(
    project?.startPeriod ?? new Date().toISOString().slice(0, 7),
  )
  const [endPeriod, setEndPeriod] = useState(
    project?.endPeriod ?? addMonths(new Date().toISOString().slice(0, 7), 11),
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({
        id: project?.id,
        code,
        name,
        departmentId,
        startPeriod,
        endPeriod,
      })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal-card" onSubmit={submit}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">真实项目主数据</p>
            <h2>{project ? '编辑项目' : '新建项目'}</h2>
            <p className="muted">
              项目信息保存后，可在项目工作区直接维护项目信息、损益与现金计划行。
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="form-grid two-columns">
          <label>
            <span>项目编码</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="选填，填写后需唯一"
            />
          </label>
          <label>
            <span>项目名称 *</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="请输入项目名称"
              autoFocus
            />
          </label>
          <label>
            <span>申报部门 *</span>
            <select
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              <option value="">请选择部门</option>
              {departments
                .filter(
                  (department) =>
                    (department.origin === 'user' &&
                      department.status === 'active') ||
                    department.id === project?.departmentId,
                )
                .map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>开始期间 *</span>
            <input
              type="month"
              value={startPeriod}
              onChange={(event) => setStartPeriod(event.target.value)}
            />
          </label>
          <label>
            <span>结束期间 *</span>
            <input
              type="month"
              value={endPeriod}
              onChange={(event) => setEndPeriod(event.target.value)}
            />
          </label>
        </div>

        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? '保存中…' : '保存项目'}
          </button>
        </div>
      </form>
    </div>
  )
}
