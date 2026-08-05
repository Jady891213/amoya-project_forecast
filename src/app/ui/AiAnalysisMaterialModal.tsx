import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Copy, Download, ShieldCheck, Sparkles, X } from 'lucide-react'
import type { AiAnalysisPreviewDto } from '../../shared/api'
import type { ApiClient } from '../api/client'

interface Props {
  api: ApiClient
  projectId: string
  planId: string
  onClose: () => void
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

export function AiAnalysisMaterialModal({ api, projectId, planId, onClose }: Props) {
  const [preview, setPreview] = useState<AiAnalysisPreviewDto>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    void api.aiAnalysisPreview(projectId, planId)
      .then((value) => { if (active) setPreview(value) })
      .catch((reason) => { if (active) setMessage(reason instanceof Error ? reason.message : 'AI 分析素材加载失败') })
    return () => { active = false }
  }, [api, projectId, planId])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [onClose])

  const handleCopy = async () => {
    if (!preview) return
    try {
      await copyText(preview.prompt)
      setCopied(true)
      setMessage('提示词已复制，可以直接粘贴到可信 AI 服务。')
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setMessage('提示词复制失败，请在文本框中手动选择复制。')
    }
  }

  const handleDownload = async () => {
    if (!preview || preview.status !== 'ready') return
    setBusy(true)
    setMessage('')
    try {
      await api.exportAiAnalysis(projectId, planId)
      setMessage('脱敏数据源已下载。请将提示词和附件一起交给可信 AI 服务。')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '脱敏数据源下载失败')
    } finally {
      setBusy(false)
    }
  }

  return <div className="modal-backdrop ai-material-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal-card ai-material-modal" role="dialog" aria-modal="true" aria-labelledby="ai-material-title">
      <header className="modal-header ai-material-header">
        <span className="ai-material-mark"><Sparkles size={19} /></span>
        <div><h2 id="ai-material-title">AI 分析素材</h2><p>复制固定提示词，并下载与当前成功结果一致的脱敏数据源。</p></div>
        <button className="icon-button" aria-label="关闭 AI 分析素材" onClick={onClose}><X size={17} /></button>
      </header>
      {!preview && !message && <div className="ai-material-loading">正在准备分析素材…</div>}
      {preview && <div className="ai-material-body">
        <section className="ai-prompt-panel">
          <div className="ai-material-section-head"><div><b>分析提示词</b><span>将下面内容连同脱敏 Excel 一起发送给 AI</span></div><button className="btn" onClick={() => void handleCopy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制提示词'}</button></div>
          <textarea readOnly value={preview.prompt} aria-label="AI 分析提示词" />
        </section>
        <aside className="ai-data-source-panel">
          <div className="ai-data-source-title"><ShieldCheck size={18} /><div><b>脱敏数据源</b><span>{preview.dataSourceName}</span></div></div>
          <ul>{preview.redactionSummary.map((item) => <li key={item}>{item}</li>)}</ul>
          <div className={`ai-material-warning ${preview.status === 'ready' ? 'privacy' : 'blocked'}`}><AlertTriangle size={15} /><span>{preview.warning}</span></div>
          <button className="btn primary ai-download-button" disabled={busy || preview.status !== 'ready'} onClick={() => void handleDownload()}><Download size={15} />{busy ? '正在生成…' : '下载脱敏数据源'}</button>
          {preview.status !== 'ready' && <small>完成最新计算后，重新打开本窗口即可下载。</small>}
        </aside>
      </div>}
      {message && <footer className="ai-material-feedback">{message}</footer>}
    </section>
  </div>
}
