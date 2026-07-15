import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { FortemiProvider } from '@fortemi/react'
import { App } from './App.js'
import { initTheme } from '@fortemi/examples-shared/ui'
import '@fortemi/examples-shared/theme.css'
import './styles.css'

// Apply the persisted light/dark preference before first paint.
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FortemiProvider persistence="memory">
      <App />
    </FortemiProvider>
  </StrictMode>,
)
