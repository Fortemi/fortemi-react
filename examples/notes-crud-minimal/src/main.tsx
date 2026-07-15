import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { FortemiProvider } from '@fortemi/react'
import { App } from './App.js'
import { initTheme } from '@fortemi/examples-shared/ui'
import '@fortemi/examples-shared/theme.css'
import './styles.css'

// persistence="memory" keeps this demo instant and disposable — the whole
// Postgres database lives in WASM in this tab and vanishes on reload. Switch to
// "idb" (Firefox) or "opfs" (Chrome) to persist across reloads.
// Apply the persisted light/dark preference before first paint.
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FortemiProvider persistence="memory">
      <App />
    </FortemiProvider>
  </StrictMode>,
)
