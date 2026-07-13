import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { FortemiProvider } from '@fortemi/react'
import { App } from './App.js'
import './styles.css'

// persistence="memory" keeps this demo instant and disposable — the whole
// Postgres database lives in WASM in this tab and vanishes on reload. Switch to
// "idb" (Firefox) or "opfs" (Chrome) to persist across reloads.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FortemiProvider persistence="memory">
      <App />
    </FortemiProvider>
  </StrictMode>,
)
