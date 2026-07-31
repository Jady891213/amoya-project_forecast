import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

declare const __SERVICE_MODE__: boolean

const appModule = __SERVICE_MODE__
  ? import('./App')
  : import('./LegacyApp')

void appModule.then(({ default: App }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
