/**
 * Example 1: Research Paper Organizer
 *
 * Demonstrates: tag-scoped filtering, faceted search, phrase search, search history.
 * All notes are tagged 'app:research' so they only appear in this app.
 * The main app can still see them — that's the power of fortemi's tag system.
 */
import { useState, useCallback } from 'react'
import { useCreateNote, useSearch, useSearchHistory, useJobQueue, useNotes } from '@fortemi/react'

const APP_TAG = 'app:research'

const SEED_PAPERS = [
  { title: 'Attention Is All You Need', content: 'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. The best performing models also connect the encoder and decoder through an attention mechanism.', tags: ['transformers', 'nlp', 'deep-learning'] },
  { title: 'BERT: Pre-training of Deep Bidirectional Transformers', content: 'We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers. BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers.', tags: ['transformers', 'nlp', 'pre-training'] },
  { title: 'ImageNet Classification with Deep CNNs', content: 'We trained a large, deep convolutional neural network to classify the 1.2 million high-resolution images in the ImageNet LSVRC-2010 contest into the 1000 different classes. On the test data, we achieved top-1 and top-5 error rates that are considerably better than the previous state-of-the-art.', tags: ['computer-vision', 'cnn', 'deep-learning'] },
  { title: 'Generative Adversarial Networks', content: 'We propose a new framework for estimating generative models via an adversarial process, in which we simultaneously train two models: a generative model G that captures the data distribution, and a discriminative model D that estimates the probability that a sample came from the training data rather than G.', tags: ['generative-models', 'deep-learning', 'unsupervised'] },
  { title: 'Deep Residual Learning for Image Recognition', content: 'We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously. We explicitly reformulate the layers as learning residual functions with reference to the layer inputs, instead of learning unreferenced functions.', tags: ['computer-vision', 'cnn', 'deep-learning'] },
]

export function ResearchOrganizer() {
  useJobQueue(2000)
  const { createNote } = useCreateNote()
  const { data, loading, search, clear } = useSearch()
  const { history, addEntry } = useSearchHistory()
  const { data: allNotes } = useNotes({ sort: 'created_at', order: 'desc', tags: [APP_TAG] })
  const [title, setTitle] = useState('')
  const [abstract, setAbstract] = useState('')
  const [tags, setTags] = useState('')
  const [query, setQuery] = useState('')
  const [showStarred, setShowStarred] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const handleCreate = async () => {
    if (!abstract.trim()) return
    const tagList = [...tags.split(',').map(t => t.trim()).filter(Boolean), APP_TAG]
    await createNote({ content: abstract, title: title || undefined, tags: tagList })
    setTitle(''); setAbstract(''); setTags('')
  }

  const handleSeed = async () => {
    setSeeding(true)
    for (const paper of SEED_PAPERS) {
      await createNote({ content: paper.content, title: paper.title, tags: [...paper.tags, APP_TAG] })
    }
    setSeeding(false)
  }

  const handleSearch = useCallback(async (q: string) => {
    setQuery(q)
    if (q.trim()) {
      addEntry(q)
      await search(q, { tags: [APP_TAG], include_facets: true, is_starred: showStarred || undefined })
    } else { clear() }
  }, [search, clear, addEntry, showStarred])

  const noteCount = allNotes?.total ?? 0

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Research Paper Organizer</h2>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
        Paste paper abstracts, tag them, and search with faceted results. All data is scoped via the <code>app:research</code> tag.
        <span style={{ color: '#999', marginLeft: 8 }}>{noteCount} papers</span>
      </p>

      {noteCount === 0 && (
        <button onClick={handleSeed} disabled={seeding}
          style={{ padding: '6px 14px', background: '#f5a623', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, marginBottom: 12 }}>
          {seeding ? 'Loading...' : 'Load 5 Sample Papers'}
        </button>
      )}

      {/* Create form */}
      <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, marginBottom: 16, background: '#f8f9fa' }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Paper title"
          style={{ width: '100%', padding: 6, border: '1px solid #ddd', borderRadius: 4, marginBottom: 6, fontSize: 13, boxSizing: 'border-box' }} />
        <textarea value={abstract} onChange={e => setAbstract(e.target.value)} placeholder="Paste abstract..." rows={3}
          style={{ width: '100%', padding: 6, border: '1px solid #ddd', borderRadius: 4, marginBottom: 6, fontSize: 13, boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags: ml, nlp, cv"
            style={{ flex: 1, padding: 6, border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }} />
          <button onClick={handleCreate}
            style={{ padding: '6px 14px', background: '#4a9eff', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
            Add Paper
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input value={query} onChange={e => { setQuery(e.target.value); void handleSearch(e.target.value) }}
          placeholder='Search papers... (try "exact phrase")'
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#666', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={showStarred} onChange={e => setShowStarred(e.target.checked)} />
          Starred
        </label>
      </div>

      {!query && history.length > 0 && (
        <div style={{ marginBottom: 12, fontSize: 11, color: '#999' }}>
          Recent: {history.slice(0, 5).map((h, i) => (
            <span key={h}>{i > 0 && ', '}<span onClick={() => void handleSearch(h)} style={{ cursor: 'pointer', color: '#4a9eff' }}>{h}</span></span>
          ))}
        </div>
      )}

      {loading && <p style={{ color: '#999' }}>Searching...</p>}
      {data && (
        <div>
          <p style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>{data.total} result{data.total !== 1 ? 's' : ''} via {data.mode}</p>
          {data.facets?.tags && data.facets.tags.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {data.facets.tags.filter(f => f.tag !== APP_TAG).map(f => (
                <span key={f.tag} onClick={() => void handleSearch(f.tag)}
                  style={{ display: 'inline-block', background: '#e8f0fe', color: '#1a73e8', borderRadius: 4, padding: '2px 8px', fontSize: 11, marginRight: 4, cursor: 'pointer' }}>
                  #{f.tag} ({f.count})
                </span>
              ))}
            </div>
          )}
          {data.results.map(r => (
            <div key={r.id} style={{ padding: 10, border: '1px solid #eee', borderRadius: 6, marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#999', minWidth: 36 }}>{r.rank.toFixed(2)}</span>
                <strong style={{ fontSize: 14 }}>{r.title ?? 'Untitled'}</strong>
                {r.has_embedding && <span style={{ background: '#e8f5e9', color: '#2e7d32', borderRadius: 3, padding: '0 4px', fontSize: 9 }}>E</span>}
              </div>
              <div style={{ color: '#666', fontSize: 12, marginTop: 4 }} dangerouslySetInnerHTML={{ __html: r.snippet }} />
              {r.tags.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {r.tags.filter(t => t !== APP_TAG).map(t => (
                    <span key={t} style={{ display: 'inline-block', background: '#f0f0f0', borderRadius: 3, padding: '1px 5px', fontSize: 10, marginRight: 3 }}>#{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
