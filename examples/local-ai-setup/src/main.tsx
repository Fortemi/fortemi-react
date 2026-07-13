import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { FortemiProvider } from '@fortemi/react'
import { App } from './App.js'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FortemiProvider persistence="memory">
      <App />
    </FortemiProvider>
  </StrictMode>,
)
