import { Suspense, useState, useEffect, useRef } from 'react'
import { VERSION } from '@fortemi/core'
import { FortemiProvider, useFortemiContext } from '@fortemi/react'
import { LoadingScreen } from './components/LoadingScreen'
import { NoteListPage } from './pages/NoteListPage'
import { SettingsPage } from './pages/SettingsPage'
import { setupCapabilities, getEnabledCapabilities } from './capabilities/setup'
import { ResearchOrganizer } from './examples/ResearchOrganizer'
import { FlashcardQuiz } from './examples/FlashcardQuiz'
import { WritingPrompts } from './examples/WritingPrompts'
import { JournalApp } from './examples/JournalApp'

/** Register real capability loaders and auto-enable previously active capabilities */
function CapabilitySetup() {
  const { capabilityManager } = useFortemiContext()
  const initialized = useRef(false)
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      setupCapabilities(capabilityManager)

      // Auto-enable capabilities that were active last session (or defaults on first visit)
      const toEnable = getEnabledCapabilities()
      for (const name of toEnable) {
        capabilityManager.enable(name as 'semantic' | 'llm').catch(() => {
          // Errors are captured in capability state — user can see them in Settings
        })
      }
    }
  }, [capabilityManager])
  return null
}

type Page = 'notes' | 'settings' | 'examples'

const EXAMPLES = [
  {
    key: 'research',
    title: 'Research Paper Organizer',
    desc: 'Tag, search, and filter papers with faceted results. Demonstrates tag-scoped data, phrase search, and search history.',
    color: '#4a9eff',
    type: 'Record keeper' as const,
  },
  {
    key: 'flashcards',
    title: 'Flashcard Quiz',
    desc: 'Study Q&A cards with semantic linking suggesting related cards. An application that uses fortemi as its data engine.',
    color: '#34a853',
    type: 'Application' as const,
  },
  {
    key: 'prompts',
    title: 'Writing Prompt Engine',
    desc: 'Type a theme and discover matching prompts by meaning. Semantic search powers creative discovery.',
    color: '#667eea',
    type: 'Application' as const,
  },
  {
    key: 'journal',
    title: 'Personal Journal',
    desc: 'Write entries with AI revision, title generation, and vocabulary-based autocomplete.',
    color: '#f5a623',
    type: 'Record keeper' as const,
  },
]

function ExamplesPage({ onBack }: { onBack: () => void }) {
  const [activeExample, setActiveExample] = useState<string | null>(null)

  const backBtn = (
    <button onClick={() => setActiveExample(null)}
      style={{ fontSize: 12, cursor: 'pointer', background: 'none', border: 'none', color: '#4a9eff', padding: 0, marginBottom: 12 }}>
      &larr; Back to Examples
    </button>
  )

  if (activeExample === 'research') return <div>{backBtn}<ResearchOrganizer /></div>
  if (activeExample === 'flashcards') return <div>{backBtn}<FlashcardQuiz /></div>
  if (activeExample === 'prompts') return <div>{backBtn}<WritingPrompts /></div>
  if (activeExample === 'journal') return <div>{backBtn}<JournalApp /></div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Example Applications</h2>
        <button onClick={onBack}
          style={{ fontSize: 12, cursor: 'pointer', background: 'none', border: 'none', color: '#4a9eff', padding: 0 }}>
          &larr; Back to main app
        </button>
      </div>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 8 }}>
        Each app uses <code>app:*</code> tags to scope its data — demonstrating how fortemi's tag system enables
        multiple applications to share one database while each sees only its own records.
      </p>
      <p style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
        Notes created here are visible in the main app too. Use "Load Sample Data" buttons for instant demos.
      </p>

      {EXAMPLES.map(ex => (
        <div key={ex.key} onClick={() => setActiveExample(ex.key)}
          style={{ padding: 16, border: '1px solid #eee', borderRadius: 8, marginBottom: 8, cursor: 'pointer', transition: 'border-color 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = ex.color }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#eee' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ex.color, flexShrink: 0 }} />
            <strong style={{ fontSize: 15 }}>{ex.title}</strong>
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, marginLeft: 4,
              background: ex.type === 'Application' ? '#e8f5e9' : '#f0f0f0',
              color: ex.type === 'Application' ? '#2e7d32' : '#666' }}>
              {ex.type}
            </span>
          </div>
          <p style={{ color: '#666', fontSize: 13, margin: '4px 0 0 16px' }}>{ex.desc}</p>
        </div>
      ))}
    </div>
  )
}

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

      {page === 'settings' ? (
        <SettingsPage onBack={() => setPage('notes')} />
      ) : page === 'examples' ? (
        <ExamplesPage onBack={() => setPage('notes')} />
      ) : (
        <NoteListPage onShowExamples={() => setPage('examples')} />
      )}
    </div>
  )
}

export function App() {
  return (
    <Suspense fallback={<LoadingScreen message="Starting database..." />}>
      <FortemiProvider persistence="idb">
        <CapabilitySetup />
        <AppShell />
      </FortemiProvider>
    </Suspense>
  )
}
