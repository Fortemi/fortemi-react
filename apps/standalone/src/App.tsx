import { Suspense, useState } from 'react'
import { VERSION } from '@fortemi/core'
import { FortemiProvider } from '@fortemi/react'
import { LoadingScreen } from './components/LoadingScreen'
import { NoteListPage } from './pages/NoteListPage'
import { SettingsPage } from './pages/SettingsPage'

type Page = 'notes' | 'settings'

function AppShell() {
  const [page, setPage] = useState<Page>('notes')

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <header
        style={{
          borderBottom: '1px solid #eee',
          paddingBottom: 8,
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h1
          style={{ margin: 0, fontSize: 20, cursor: 'pointer' }}
          onClick={() => setPage('notes')}
        >
          fortemi
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#999', fontSize: 12 }}>v{VERSION}</span>
          <button
            onClick={() => setPage(page === 'settings' ? 'notes' : 'settings')}
            title="Settings"
            aria-label="Settings"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 18,
              color: page === 'settings' ? '#4a9eff' : '#666',
              lineHeight: 1,
              padding: '2px 4px',
            }}
          >
            &#9881;
          </button>
        </div>
      </header>

      {page === 'settings' ? (
        <SettingsPage onBack={() => setPage('notes')} />
      ) : (
        <NoteListPage />
      )}
    </div>
  )
}

export function App() {
  return (
    <Suspense fallback={<LoadingScreen message="Starting database..." />}>
      <FortemiProvider persistence="idb">
        <AppShell />
      </FortemiProvider>
    </Suspense>
  )
}
