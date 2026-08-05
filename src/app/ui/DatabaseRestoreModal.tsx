import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AlertTriangle, CheckCircle2, FileUp, Upload, X } from 'lucide-react'
import { DATABASE_FILE_NAME } from '../../shared/database'

export function validateDatabaseFileName(name: string): string {
  if (name === DATABASE_FILE_NAME) return ''
  return `文件名称不正确，请选择名为 ${DATABASE_FILE_NAME} 的数据文件。`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function DatabaseRestoreModal({
  open,
  onClose,
  onRestore,
}: {
  open: boolean
  onClose: () => void
  onRestore: (file: File) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File>()
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !restoring) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open, restoring])

  useEffect(() => {
    if (open) return
    setFile(undefined)
    setError('')
    setDragging(false)
  }, [open])

  if (!open) return null

  function selectFile(selected?: File) {
    setFile(selected)
    setError(selected ? validateDatabaseFileName(selected.name) : '')
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    selectFile(event.dataTransfer.files?.[0])
  }

  async function restore() {
    if (!file) return
    const validation = validateDatabaseFileName(file.name)
    if (validation) {
      setError(validation)
      return
    }
    setRestoring(true)
    setError('')
    try {
      await onRestore(file)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '数据恢复失败，请检查文件后重试。')
    } finally {
      setRestoring(false)
    }
  }

  return <div className="modal-backdrop database-restore-backdrop" role="presentation">
    <section className="modal-card database-restore-modal" role="dialog" aria-modal="true" aria-labelledby="database-restore-title">
      <header className="modal-header database-restore-header">
        <span className="database-restore-title-icon"><FileUp size={19} /></span>
        <div>
          <h2 id="database-restore-title">恢复本地数据</h2>
          <p>选择之前从本工具备份的数据文件。</p>
        </div>
        <button type="button" className="icon-button" aria-label="关闭恢复窗口" disabled={restoring} onClick={onClose}><X size={16} /></button>
      </header>

      <div className="database-restore-content">
        <div className="database-file-rule">
          <b>请确认文件名称</b>
          <code>{DATABASE_FILE_NAME}</code>
          <p>为避免选错文件，仅接受以上名称。若下载时名称被自动加上编号，请先改回以上名称。</p>
        </div>

        <div
          className={`database-drop-zone ${dragging ? 'dragging' : ''} ${error ? 'invalid' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
          onDrop={handleDrop}
        >
          <Upload size={24} />
          <b>将数据文件拖到这里</b>
          <span>也可以点击下方按钮从电脑中选择</span>
          <button type="button" className="btn" disabled={restoring} onClick={() => inputRef.current?.click()}>选择数据文件</button>
          <input
            hidden
            ref={inputRef}
            type="file"
            accept=".db,application/vnd.sqlite3"
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
        </div>

        {file && <div className={`database-selected-file ${error ? 'invalid' : 'valid'}`}>
          {error ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
          <div><b>{file.name}</b><span>{formatFileSize(file.size)}</span></div>
          <button type="button" className="action-link" disabled={restoring} onClick={() => { selectFile(undefined); if (inputRef.current) inputRef.current.value = '' }}>重新选择</button>
        </div>}
        {error && <p className="database-restore-error" role="alert">{error}</p>}

        <div className="database-restore-warning"><AlertTriangle size={16} /><span>恢复后，当前项目数据会被所选文件中的内容替换。建议先点击“备份”保存当前数据。</span></div>
      </div>

      <footer className="modal-actions">
        <button type="button" className="btn" disabled={restoring} onClick={onClose}>取消</button>
        <button type="button" className="btn primary" disabled={!file || Boolean(error) || restoring} onClick={() => void restore()}>{restoring ? '正在恢复…' : '确认恢复'}</button>
      </footer>
    </section>
  </div>
}
