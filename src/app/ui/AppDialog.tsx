import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

type DialogTone = 'info' | 'warning' | 'danger'

interface DialogOptions {
  title?: string
  message: string
  tone?: DialogTone
  confirmLabel?: string
  cancelLabel?: string
}

interface DialogRequest extends Required<Pick<DialogOptions, 'message' | 'tone'>> {
  id: number
  mode: 'alert' | 'confirm'
  title: string
  confirmLabel: string
  cancelLabel: string
  resolve: (confirmed: boolean) => void
}

interface AppDialogApi {
  alert: (message: string, options?: Omit<DialogOptions, 'message'>) => Promise<void>
  confirm: (options: DialogOptions) => Promise<boolean>
}

const AppDialogContext = createContext<AppDialogApi | undefined>(undefined)

function defaultTitle(mode: DialogRequest['mode'], tone: DialogTone) {
  if (tone === 'danger') return mode === 'confirm' ? '请确认此操作' : '操作未完成'
  if (tone === 'warning') return mode === 'confirm' ? '请确认' : '请注意'
  return '操作提示'
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<DialogRequest>()
  const sequence = useRef(0)
  const confirmButton = useRef<HTMLButtonElement>(null)

  const open = useCallback((mode: DialogRequest['mode'], options: DialogOptions) => (
    new Promise<boolean>((resolve) => {
      const tone = options.tone ?? (mode === 'confirm' ? 'warning' : 'info')
      setRequest({
        id: sequence.current += 1,
        mode,
        tone,
        title: options.title ?? defaultTitle(mode, tone),
        message: options.message,
        confirmLabel: options.confirmLabel ?? (mode === 'confirm' ? '确认' : '知道了'),
        cancelLabel: options.cancelLabel ?? '取消',
        resolve,
      })
    })
  ), [])

  const close = useCallback((confirmed: boolean) => {
    setRequest((current) => {
      current?.resolve(confirmed)
      return undefined
    })
  }, [])

  useEffect(() => {
    if (!request) return
    confirmButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close, request])

  const api = useMemo<AppDialogApi>(() => ({
    alert: async (message, options = {}) => { await open('alert', { ...options, message }) },
    confirm: (options) => open('confirm', options),
  }), [open])

  const Icon = request?.tone === 'danger'
    ? AlertTriangle
    : request?.tone === 'warning'
      ? AlertTriangle
      : request?.mode === 'alert'
        ? CheckCircle2
        : Info

  return <AppDialogContext.Provider value={api}>
    {children}
    {request && <div className="app-dialog-backdrop" role="presentation">
      <section
        className={`app-dialog app-dialog-${request.tone}`}
        role={request.mode === 'alert' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={`app-dialog-title-${request.id}`}
        aria-describedby={`app-dialog-message-${request.id}`}
      >
        <div className="app-dialog-heading">
          <span className="app-dialog-icon"><Icon size={18} /></span>
          <div>
            <h2 id={`app-dialog-title-${request.id}`}>{request.title}</h2>
            <p id={`app-dialog-message-${request.id}`}>{request.message}</p>
          </div>
          <button type="button" className="icon-button app-dialog-close" aria-label="关闭弹窗" onClick={() => close(false)}><X size={16} /></button>
        </div>
        <div className="app-dialog-actions">
          {request.mode === 'confirm' && <button type="button" className="btn" onClick={() => close(false)}>{request.cancelLabel}</button>}
          <button
            ref={confirmButton}
            type="button"
            className={`btn ${request.tone === 'danger' ? 'danger-button' : 'primary'}`}
            onClick={() => close(true)}
          >{request.confirmLabel}</button>
        </div>
      </section>
    </div>}
  </AppDialogContext.Provider>
}

export function useAppDialog() {
  const context = useContext(AppDialogContext)
  if (!context) throw new Error('useAppDialog 必须在 AppDialogProvider 内使用')
  return context
}
