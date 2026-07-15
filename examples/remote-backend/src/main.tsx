import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { initTheme } from '@fortemi/examples-shared/ui'
import '@fortemi/examples-shared/theme.css'
import './styles.css'

// No FortemiProvider: useRemote talks to a Fortémi server, not the local database.
// Apply the persisted light/dark preference before first paint.
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
