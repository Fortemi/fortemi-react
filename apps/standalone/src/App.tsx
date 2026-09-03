import { lazy, Suspense, useState, useEffect, useRef } from 'react'
import { NotesRepository, VERSION, detectGpuCapabilities } from '@fortemi/core'
import { FortemiProvider, useFortemiContext } from '@fortemi/react'
import { LoadingScreen } from './components/LoadingScreen'
import { NoteListPage } from './pages/NoteListPage'
import { setupCapabilities, getEnabledCapabilities } from './capabilities/setup'
import { PROJECT_DOCS } from './data/project-docs'

const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const GraphPage = lazy(() => import('./pages/GraphPage').then((module) => ({ default: module.GraphPage })))
const ExamplesPage = lazy(() => import('./pages/ExamplesPage').then((module) => ({ default: module.ExamplesPage })))

declare global {
  interface Window {
    __FORTEMI_E2E__?: {
      persistence: 'idb'
      query: (sql: string, params?: unknown[]) => Promise<unknown>
      detectGpuCapabilities: typeof detectGpuCapabilities
    }
  }
}

function E2EDiagnostics() {
  const { db } = useFortemiContext()

  useEffect(() => {
    window.__FORTEMI_E2E__ = {
      persistence: 'idb',
      query: (sql: string, params: unknown[] = []) => db.query(sql, params),
      detectGpuCapabilities,
    }

    return () => {
      delete window.__FORTEMI_E2E__
    }
  }, [db])

  return null
}

/** Register real capability loaders and auto-enable previously active capabilities */
function CapabilitySetup() {
  const { capabilityManager, events, providerRegistry } = useFortemiContext()
  const initialized = useRef(false)
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      setupCapabilities(capabilityManager, events, providerRegistry)

      // Auto-enable capabilities that were active last session (or defaults on first visit)
      const toEnable = getEnabledCapabilities()
      for (const name of toEnable) {
        capabilityManager.enable(name as 'semantic' | 'llm').catch(() => {
          // Errors are captured in capability state — user can see them in Settings
        })
      }
    }
  }, [capabilityManager, events, providerRegistry])
  return null
}

function ProjectDocsSeed() {
  const { db, events } = useFortemiContext()
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    async function seedDocs() {
      const existing = await db.query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM note_tag
         WHERE tag = 'docs:seed:fortemi-react'`,
      )
      if (Number(existing.rows[0]?.count ?? 0) > 0) return

      const notes = new NotesRepository(db, events)
      for (const doc of PROJECT_DOCS) {
        await notes.create({
          title: doc.title,
          content: doc.content,
          tags: ['docs:seed:fortemi-react', ...doc.tags],
          source: 'docs-seed',
          visibility: 'public',
        })
      }
    }

    seedDocs().catch((err) => {
      console.warn('[Docs] Project docs seed failed:', err)
    })
  }, [db, events])

  return null
}

type Page = 'notes' | 'settings' | 'examples' | 'graph'

const THEME_KEY = 'fortemi:theme'

function AppShell() {
  const [page, setPage] = useState<Page>('notes')
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) === 'dark')

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    localStorage.setItem(THEME_KEY, next ? 'dark' : 'light')
  }

  // Dark mode: inject a stylesheet that overrides colors globally
  useEffect(() => {
    const id = 'fortemi-dark-mode'
    let style = document.getElementById(id) as HTMLStyleElement | null
    if (dark) {
      if (!style) {
        style = document.createElement('style')
        style.id = id
        document.head.appendChild(style)
      }
      style.textContent = `
        html, body { background: #000 !important; transition: background 0.4s ease; }
        h1, h2, h3, h4, strong, b { color: #000 !important; }
      `
    } else {
      if (style) style.textContent = `
        html, body { background: #fff !important; transition: background 0.4s ease; }
      `
    }
  }, [dark])

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif', minHeight: '100vh', transition: 'filter 0.4s ease', filter: dark ? 'invert(1) hue-rotate(180deg)' : 'invert(0) hue-rotate(0deg)' }}>
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
            onClick={toggleTheme}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '2px 4px', lineHeight: 1 }}
          >
            {dark ? '\u2600' : '\u263E'}
          </button>
          <button
            onClick={() => setPage(page === 'examples' ? 'notes' : 'examples')}
            title="Examples"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
              color: page === 'examples' ? '#4a9eff' : '#666', padding: '2px 4px',
            }}
          >
            Examples
          </button>
          <button
            onClick={() => setPage(page === 'graph' ? 'notes' : 'graph')}
            title="Graph"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
              color: page === 'graph' ? '#4a9eff' : '#666', padding: '2px 4px',
            }}
          >
            Graph
          </button>
          <button
            onClick={() => setPage(page === 'settings' ? 'notes' : 'settings')}
            title="Settings"
            aria-label="Settings"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 18,
              color: page === 'settings' ? '#4a9eff' : '#666', lineHeight: 1, padding: '2px 4px',
            }}
          >
            &#9881;
          </button>
        </div>
      </header>

      <Suspense fallback={<div style={{ color: '#666', fontSize: 13 }}>Loading...</div>}>
        {page === 'settings' ? (
          <SettingsPage onBack={() => setPage('notes')} />
        ) : page === 'examples' ? (
          <ExamplesPage onBack={() => setPage('notes')} />
        ) : page === 'graph' ? (
          <GraphPage onBack={() => setPage('notes')} />
        ) : (
          <NoteListPage onShowExamples={() => setPage('examples')} />
        )}
      </Suspense>
    </div>
  )
}

export function App() {
  return (
    <Suspense fallback={<LoadingScreen message="Starting database..." />}>
      <FortemiProvider persistence="idb">
        <CapabilitySetup />
        <ProjectDocsSeed />
        {import.meta.env.DEV ? <E2EDiagnostics /> : null}
        <AppShell />
      </FortemiProvider>
    </Suspense>
  )
}
