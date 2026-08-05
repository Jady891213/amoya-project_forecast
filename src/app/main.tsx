import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { AppDialogProvider } from './ui/AppDialog'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppDialogProvider>
      <App />
    </AppDialogProvider>
  </StrictMode>,
)
