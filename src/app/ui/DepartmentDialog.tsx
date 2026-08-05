import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type { Department } from '../../shared/domain/types'

interface DepartmentDialogProps {
  department?: Department
  onClose: () => void
  onSave: (input: {
    id?: string
    code: string
    name: string
    status: Department['status']
  }) => Promise<void>
}

export function DepartmentDialog({
  department,
  onClose,
  onSave,
}: DepartmentDialogProps) {
  const [code, setCode] = useState(department?.code ?? '')
  const [name, setName] = useState(department?.name ?? '')
  const [status, setStatus] = useState<Department['status']>(
    department?.status ?? 'active',
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setCode(department?.code ?? '')
    setName(department?.name ?? '')
    setStatus(department?.status ?? 'active')
  }, [department])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({ id: department?.id, code, name, status })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal-card compact-modal" onSubmit={submit}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">组织主数据</p>
            <h2>{department ? '编辑部门' : '新增部门'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="form-grid">
          <label>
            <span>部门编码 *</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="例如：FIN"
              autoFocus
            />
          </label>
          <label>
            <span>部门名称 *</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：财务部"
            />
          </label>
          <label>
            <span>状态</span>
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as Department['status'])
              }
            >
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </label>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? '保存中…' : '保存部门'}
          </button>
        </div>
      </form>
    </div>
  )
}
