import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import type {
  Department,
  Project,
  ProjectInput,
  ProjectModule,
} from '../domain/types'

interface ModuleDraft {
  key: string
  code: string
  name: string
}

interface ProjectDialogProps {
  project?: Project
  departments: Department[]
  modules: ProjectModule[]
  onClose: () => void
  onSave: (input: ProjectInput) => Promise<void>
}

function toModuleDrafts(modules: ProjectModule[]): ModuleDraft[] {
  return modules.map((module) => ({
    key: module.id,
    code: module.code,
    name: module.name,
  }))
}

export function ProjectDialog({
  project,
  departments,
  modules,
  onClose,
  onSave,
}: ProjectDialogProps) {
  const [code, setCode] = useState(project?.code ?? '')
  const [name, setName] = useState(project?.name ?? '')
  const [customer, setCustomer] = useState(project?.customer ?? '')
  const [departmentId, setDepartmentId] = useState(
    project?.departmentId ??
      departments.find(
        (department) =>
          department.origin === 'user' && department.status === 'active',
      )?.id ??
      '',
  )
  const [owner, setOwner] = useState(project?.owner ?? '')
  const [startPeriod, setStartPeriod] = useState(
    project?.startPeriod ?? new Date().toISOString().slice(0, 7),
  )
  const [durationMonths, setDurationMonths] = useState(
    project?.durationMonths ?? 12,
  )
  const [remark, setRemark] = useState(project?.remark ?? '')
  const [moduleDrafts, setModuleDrafts] = useState<ModuleDraft[]>(
    toModuleDrafts(modules),
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setModuleDrafts(toModuleDrafts(modules))
  }, [modules])

  function addModule() {
    setModuleDrafts((current) => [
      ...current,
      { key: crypto.randomUUID(), code: '', name: '' },
    ])
  }

  function updateModule(
    key: string,
    field: 'code' | 'name',
    value: string,
  ) {
    setModuleDrafts((current) =>
      current.map((module) =>
        module.key === key ? { ...module, [field]: value } : module,
      ),
    )
  }

  function removeModule(key: string) {
    setModuleDrafts((current) =>
      current.filter((module) => module.key !== key),
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({
        id: project?.id,
        code,
        name,
        customer,
        departmentId,
        owner,
        startPeriod,
        durationMonths: Number(durationMonths),
        remark,
        modules: moduleDrafts.map(({ code: moduleCode, name: moduleName }) => ({
          code: moduleCode,
          name: moduleName,
        })),
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
            <span>客户</span>
            <input
              value={customer}
              onChange={(event) => setCustomer(event.target.value)}
              placeholder="请输入客户名称"
            />
          </label>
          <label>
            <span>所属部门 *</span>
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
            <span>负责人</span>
            <input
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder="请输入负责人"
            />
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
            <span>预测周期（月）*</span>
            <input
              type="number"
              min={1}
              max={36}
              value={durationMonths}
              onChange={(event) =>
                setDurationMonths(Number(event.target.value))
              }
            />
          </label>
          <label className="full-width">
            <span>备注</span>
            <textarea
              rows={3}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              placeholder="说明项目背景或当前状态"
            />
          </label>
        </div>

        <section className="module-editor">
          <div className="section-heading">
            <div>
              <h3>业务模块</h3>
              <p className="muted">预测行项目可归属到下列业务模块；系统始终保留“公共”模块。</p>
            </div>
            <button type="button" className="button ghost" onClick={addModule}>
              <Plus size={14} /> 添加模块
            </button>
          </div>
          {moduleDrafts.length === 0 ? (
            <div className="inline-empty">当前项目未设置业务模块</div>
          ) : (
            <div className="module-drafts">
              {moduleDrafts.map((module) => (
                <div className="module-draft-row" key={module.key}>
                  <input
                    value={module.code}
                    onChange={(event) =>
                      updateModule(module.key, 'code', event.target.value)
                    }
                    placeholder="模块编码"
                  />
                  <input
                    value={module.name}
                    onChange={(event) =>
                      updateModule(module.key, 'name', event.target.value)
                    }
                    placeholder="模块名称"
                  />
                  <button
                    type="button"
                    className="icon-button danger"
                    onClick={() => removeModule(module.key)}
                    aria-label="删除业务模块"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

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
