/**
 * Example 3: Writing Prompt Engine
 *
 * A creative APPLICATION powered by fortemi — not a note-taker.
 * Store writing prompts, ideas, and fragments. Type a theme and the app
 * searches for matching prompts to inspire your writing. Uses semantic
 * search to find prompts by mood/theme even when keywords don't match.
 *
 * Demonstrates: search-as-application-engine, tag filtering for app scope,
 * hybrid search for creative discovery, seed data for instant demo.
 */
import { useState, useCallback } from 'react'
import { enqueueFullWorkflow } from '@fortemi/core'
import { useCreateNote, useSearch, useNotes, useJobQueue, useFortemiContext } from '@fortemi/react'
import { ShardBackupSection } from '../components/ShardBackupSection'

const APP_TAG = 'app:prompts'

const SEED_PROMPTS = [
  { title: 'The Last Lighthouse Keeper', content: 'A lighthouse keeper discovers that the light they tend doesn\'t guide ships — it keeps something in the deep ocean asleep. Tonight, the bulb is flickering.', tags: ['horror', 'ocean', 'isolation'] },
  { title: 'Letters from Tomorrow', content: 'You receive a letter postmarked one year in the future. It\'s in your handwriting, and it says: "Whatever you do, don\'t open the blue door." There is no blue door in your house — yet.', tags: ['mystery', 'time', 'suspense'] },
  { title: 'The Memory Market', content: 'In a world where memories can be extracted, bottled, and sold, a black-market dealer discovers a memory that doesn\'t belong to anyone who has ever lived.', tags: ['sci-fi', 'noir', 'identity'] },
  { title: 'When the Music Stopped', content: 'Every person on Earth hears the same melody for exactly 47 seconds. Then silence. Three days later, people who heard it in a minor key begin to change.', tags: ['sci-fi', 'mystery', 'transformation'] },
  { title: 'The Cartographer of Lost Places', content: 'A mapmaker who charts places that no longer exist — sunken cities, demolished buildings, forgotten gardens — realizes the places are reappearing on their maps before they reappear in reality.', tags: ['fantasy', 'maps', 'mystery'] },
  { title: 'Gravity\'s Apprentice', content: 'A physics student accidentally discovers how to locally reverse gravity. The first thing that falls upward is a coffee cup. The second thing is their professor, and he doesn\'t come back down.', tags: ['sci-fi', 'comedy', 'physics'] },
  { title: 'The Color Thief', content: 'An artist wakes up to find that every painting they\'ve ever created has gone monochrome overnight. The missing colors are showing up in someone else\'s dreams.', tags: ['fantasy', 'art', 'surreal'] },
  { title: 'Echoes of Kindness', content: 'In a city where every act of kindness creates a visible ripple of golden light, a detective tracks a serial philanthropist whose kindness is killing people — with love.', tags: ['urban-fantasy', 'detective', 'morality'] },
]

export function WritingPrompts() {
  useJobQueue(2000)
  const { db } = useFortemiContext()
  const { createNote } = useCreateNote()
  const { data: searchData, loading, search, clear } = useSearch()
  const { data: allPrompts } = useNotes({ sort: 'created_at', order: 'desc', tags: [APP_TAG] })
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [tags, setTags] = useState('')
  const [theme, setTheme] = useState('')
  const [seeding, setSeeding] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!prompt.trim()) return
    const tagList = [...tags.split(',').map(t => t.trim()).filter(Boolean), APP_TAG]
    const note = await createNote({ content: prompt, title: title || undefined, tags: tagList })
    await enqueueFullWorkflow(db, note.id)
    setTitle(''); setPrompt(''); setTags('')
  }

  const handleSeed = async () => {
    setSeeding(true)
    for (const p of SEED_PROMPTS) {
      const note = await createNote({ content: p.content, title: p.title, tags: [...p.tags, APP_TAG] })
      await enqueueFullWorkflow(db, note.id)
    }
    setSeeding(false)
  }

  const handleThemeSearch = useCallback(async (q: string) => {
    setTheme(q)
    if (q.trim()) {
      await search(q, { tags: [APP_TAG], include_facets: true })
    } else { clear() }
  }, [search, clear])

  const promptCount = allPrompts?.total ?? 0
  const displayPrompts = theme.trim() ? searchData?.results : null

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Writing Prompt Engine</h2>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
        Type a theme, mood, or genre and discover matching prompts. Semantic search finds prompts by meaning, not just keywords.
        <span style={{ color: '#999', marginLeft: 8 }}>{promptCount} prompts</span>
      </p>

      <ShardBackupSection appTag={APP_TAG} appName="Writing Prompts" />

      {promptCount === 0 && (
        <button onClick={handleSeed} disabled={seeding}
          style={{ padding: '6px 14px', background: '#f5a623', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, marginBottom: 12 }}>
          {seeding ? 'Loading...' : 'Load 8 Sample Prompts'}
        </button>
      )}

      {/* Theme search — the core UX */}
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginBottom: 8 }}>What do you want to write about?</div>
        <input value={theme} onChange={e => { setTheme(e.target.value); void handleThemeSearch(e.target.value) }}
          placeholder="e.g. ocean mystery, time travel, a detective story..."
          style={{ width: '100%', padding: '10px 14px', border: 'none', borderRadius: 8, fontSize: 15, boxSizing: 'border-box', outline: 'none' }} />
      </div>

      {/* Search results */}
      {loading && <p style={{ color: '#999' }}>Finding inspiration...</p>}

      {displayPrompts && displayPrompts.length > 0 && (
        <div>
          <p style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>
            {searchData!.total} prompt{searchData!.total !== 1 ? 's' : ''} match your theme via {searchData!.mode} search
          </p>
          {searchData!.facets?.tags && searchData!.facets.tags.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {searchData!.facets.tags.filter(f => f.tag !== APP_TAG).map(f => (
                <span key={f.tag} onClick={() => void handleThemeSearch(f.tag)}
                  style={{ display: 'inline-block', background: 'rgba(102,126,234,0.1)', color: '#667eea', borderRadius: 4, padding: '2px 8px', fontSize: 11, marginRight: 4, cursor: 'pointer' }}>
                  {f.tag} ({f.count})
                </span>
              ))}
            </div>
          )}
          {displayPrompts.map(r => (
            <div key={r.id} onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              style={{ padding: 12, border: expandedId === r.id ? '2px solid #667eea' : '1px solid #eee', borderRadius: 8, marginBottom: 8, cursor: 'pointer', transition: 'all 0.15s' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#999', minWidth: 36 }}>{r.rank.toFixed(2)}</span>
                <strong style={{ fontSize: 14 }}>{r.title ?? 'Untitled Prompt'}</strong>
              </div>
              {expandedId === r.id ? (
                <div style={{ marginTop: 8, padding: 12, background: '#f8f4ff', borderRadius: 6, fontSize: 14, lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  {r.snippet.replace(/<\/?mark>/g, '')}
                </div>
              ) : (
                <div style={{ color: '#666', fontSize: 12, marginTop: 4 }} dangerouslySetInnerHTML={{ __html: r.snippet }} />
              )}
              {r.tags.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {r.tags.filter(t => t !== APP_TAG).map(t => (
                    <span key={t} style={{ display: 'inline-block', background: '#f0f0f0', borderRadius: 3, padding: '1px 5px', fontSize: 10, marginRight: 3 }}>#{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {theme.trim() && displayPrompts && displayPrompts.length === 0 && (
        <p style={{ color: '#999', textAlign: 'center', padding: 20 }}>No prompts match that theme yet. Add one below!</p>
      )}

      {/* Add prompt form */}
      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: '#666', fontWeight: 500 }}>Add a new prompt</summary>
        <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, marginTop: 8, background: '#f8f9fa' }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Prompt title"
            style={{ width: '100%', padding: 6, border: '1px solid #ddd', borderRadius: 4, marginBottom: 6, fontSize: 13, boxSizing: 'border-box' }} />
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="The story begins when..." rows={3}
            style={{ width: '100%', padding: 6, border: '1px solid #ddd', borderRadius: 4, marginBottom: 6, fontSize: 13, fontFamily: 'Georgia, serif', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Genre tags: sci-fi, horror"
              style={{ flex: 1, padding: 6, border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }} />
            <button onClick={handleCreate}
              style={{ padding: '6px 14px', background: '#667eea', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
              Add Prompt
            </button>
          </div>
        </div>
      </details>
    </div>
  )
}
