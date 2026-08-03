import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import type {
  Department,
  Project,
  ProjectInput,
} from '../domain/types'

interface Props {
  project: Project
  departments: Department[]
  onSave: (input: ProjectInput) => Promise<void>
}

export function ProjectInformationEditor({
  project,
  departments,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<ProjectInput>({
    id: project.id,
    code: project.code,
    name: project.name,
    departmentId: project.departmentId,
    startPeriod: project.startPeriod,
    endPeriod: project.endPeriod,
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setDraft({
      id: project.id,
      code: project.code,
      name: project.name,
      departmentId: project.departmentId,
      startPeriod: project.startPeriod,
      endPeriod: project.endPeriod,
    })
  }, [project])

  function patch(values: Partial<ProjectInput>) {
    setDraft((current) => ({ ...current, ...values }))
    setMessage('')
  }

  async function save() {
    setSaving(true)
    setMessage('')
    try {
      await onSave(draft)
      setMessage('项目信息已保存')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '项目信息保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="project-information-editor">
      <div className="project-information-head">
        <div>
          <b>项目信息</b>
          <span>直接在项目工作区维护；项目周期被预测行引用时会阻止不安全修改。</span>
        </div>
        {message && <span className="project-information-message">{message}</span>}
        <button className="btn" disabled={saving} onClick={() => void save()}>
          <Save size={14} />保存项目信息
        </button>
      </div>
      <div className="project-information-grid">
        <label>项目编码
          <input value={draft.code ?? ''} onChange={(event) => patch({ code: event.target.value })} />
        </label>
        <label>项目名称
          <input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
        </label>
        <label>申报部门
          <select value={draft.departmentId} onChange={(event) => patch({ departmentId: event.target.value })}>
            {departments
              .filter((department) => department.status === 'active' || department.id === draft.departmentId)
              .map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}
          </select>
        </label>
        <label>开始期间
          <input type="month" value={draft.startPeriod} onChange={(event) => patch({ startPeriod: event.target.value })} />
        </label>
        <label>结束期间
          <input type="month" value={draft.endPeriod} onChange={(event) => patch({ endPeriod: event.target.value })} />
        </label>
      </div>
    </section>
  )
}
