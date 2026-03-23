import { Suspense } from 'react'
import { VERSION } from '@fortemi/core'
import { FortemiProvider } from '@fortemi/react'
import { LoadingScreen } from './components/LoadingScreen'
import { NoteListPage } from './pages/NoteListPage'

export function App() {
  return (
    <Suspense fallback={<LoadingScreen message="Starting database..." />}>
      <FortemiProvider persistence="memory">
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
          <header style={{ borderBottom: '1px solid #eee', paddingBottom: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>fortemi</h1>
            <span style={{ color: '#999', fontSize: 12 }}>v{VERSION}</span>
          </header>
          <NoteListPage />
        </div>
      </FortemiProvider>
    </Suspense>
  )
}
