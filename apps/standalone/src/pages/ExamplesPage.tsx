import { useState } from 'react'
import { ResearchOrganizer } from '../examples/ResearchOrganizer'
import { FlashcardQuiz } from '../examples/FlashcardQuiz'
import { WritingPrompts } from '../examples/WritingPrompts'
import { JournalApp } from '../examples/JournalApp'

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

export function ExamplesPage({ onBack }: { onBack: () => void }) {
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
