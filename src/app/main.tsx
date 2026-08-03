import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { AppDialogProvider } from './ui/AppDialog'

declare const __SERVICE_MODE__: boolean

const appModule = __SERVICE_MODE__
  ? import('./App')
  : import('./LegacyApp')

void appModule.then(({ default: App }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppDialogProvider>
        <App />
      </AppDialogProvider>
    </StrictMode>,
  )
})
