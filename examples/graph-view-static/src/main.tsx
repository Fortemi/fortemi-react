import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initTheme } from '@fortemi/examples-shared/ui'
import { App } from './App.js'
import '@fortemi/examples-shared/theme.css'
import './styles.css'

// Apply the persisted light/dark preference before first paint.
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
