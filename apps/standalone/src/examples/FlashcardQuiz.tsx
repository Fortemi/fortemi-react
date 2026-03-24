/**
 * Example 2: Flashcard Quiz App
 *
 * A real APPLICATION powered by fortemi — not just a record keeper.
 * Notes store Q&A pairs (question in title, answer in content).
 * The app uses search to find cards by topic and semantic similarity
 * to suggest related cards during study sessions.
 *
 * Demonstrates: tag-scoped data, search-as-application-engine,
 * useRelatedNotes for "study next" suggestions, note metadata for tracking.
 */
import { useState, useCallback } from 'react'
import { enqueueFullWorkflow } from '@fortemi/core'
import { useCreateNote, useSearch, useNotes, useNote, useRelatedNotes, useJobQueue, useFortemiContext } from '@fortemi/react'
import { ShardBackupSection } from '../components/ShardBackupSection'

const APP_TAG = 'app:flashcard'

const SEED_CARDS = [
  { q: 'What is the CAP theorem?', a: 'The CAP theorem states that a distributed data store can provide at most two of three guarantees: Consistency (every read receives the most recent write), Availability (every request receives a response), and Partition tolerance (the system continues to operate despite network partitions).', tags: ['distributed-systems'] },
  { q: 'What is eventual consistency?', a: 'Eventual consistency is a consistency model where, given enough time without new updates, all replicas of a data item will converge to the same value. It trades strong consistency for higher availability and partition tolerance.', tags: ['distributed-systems'] },
  { q: 'What is a hash table?', a: 'A hash table is a data structure that maps keys to values using a hash function. It provides O(1) average-case lookup, insertion, and deletion. Collisions are handled via chaining or open addressing.', tags: ['data-structures'] },
  { q: 'What is Big O notation?', a: 'Big O notation describes the upper bound of an algorithm\'s time or space complexity as input size grows. Common classes: O(1) constant, O(log n) logarithmic, O(n) linear, O(n log n) linearithmic, O(n^2) quadratic.', tags: ['algorithms'] },
  { q: 'What is a B-tree?', a: 'A B-tree is a self-balancing tree data structure that maintains sorted data and allows searches, insertions, and deletions in O(log n) time. It is optimized for systems that read and write large blocks of data, like databases and filesystems.', tags: ['data-structures', 'databases'] },
  { q: 'What is consensus in distributed systems?', a: 'Consensus is the process by which distributed nodes agree on a single value. Algorithms like Paxos and Raft solve this problem. Consensus is essential for leader election, atomic broadcast, and replicated state machines.', tags: ['distributed-systems'] },
]

export function FlashcardQuiz() {
  useJobQueue(2000)
  const { db } = useFortemiContext()
  const { createNote } = useCreateNote()
  const { data: searchData, search, clear } = useSearch()
  const { data: allCards } = useNotes({ sort: 'created_at', order: 'desc', tags: [APP_TAG] })
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [cardTags, setCardTags] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [studyId, setStudyId] = useState<string | null>(null)
  const [showAnswer, setShowAnswer] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [mode, setMode] = useState<'browse' | 'study'>('browse')

  const handleCreate = async () => {
    if (!question.trim() || !answer.trim()) return
    const tags = [...cardTags.split(',').map(t => t.trim()).filter(Boolean), APP_TAG]
    const note = await createNote({ content: answer, title: question, tags })
    await enqueueFullWorkflow(db, note.id)
    setQuestion(''); setAnswer(''); setCardTags('')
  }

  const handleSeed = async () => {
    setSeeding(true)
    for (const card of SEED_CARDS) {
      const note = await createNote({ content: card.a, title: card.q, tags: [...card.tags, APP_TAG] })
      await enqueueFullWorkflow(db, note.id)
    }
    setSeeding(false)
  }

  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q)
    if (q.trim()) {
      await search(q, { tags: [APP_TAG], include_facets: true })
    } else { clear() }
  }, [search, clear])

  const startStudy = (id: string) => {
    setStudyId(id)
    setShowAnswer(false)
    setMode('study')
  }

  const cardCount = allCards?.total ?? 0
  const cards = searchQuery.trim() ? searchData?.results : allCards?.items

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Flashcard Quiz</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setMode('browse')} style={{ padding: '3px 10px', fontSize: 12, borderRadius: 10, border: 'none', cursor: 'pointer', background: mode === 'browse' ? '#4a9eff' : '#f0f0f0', color: mode === 'browse' ? 'white' : '#333' }}>Browse</button>
          <button onClick={() => setMode('study')} style={{ padding: '3px 10px', fontSize: 12, borderRadius: 10, border: 'none', cursor: 'pointer', background: mode === 'study' ? '#4a9eff' : '#f0f0f0', color: mode === 'study' ? 'white' : '#333' }}>Study</button>
        </div>
      </div>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
        Q&A flashcards powered by fortemi. Search finds cards by topic; semantic linking suggests related cards.
        <span style={{ color: '#999', marginLeft: 8 }}>{cardCount} cards</span>
      </p>

      <ShardBackupSection appTag={APP_TAG} appName="Flashcards" />

      {cardCount === 0 && (
        <button onClick={handleSeed} disabled={seeding}
          style={{ padding: '6px 14px', background: '#f5a623', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, marginBottom: 12 }}>
          {seeding ? 'Loading...' : 'Load 6 Sample Cards'}
        </button>
      )}

      {mode === 'study' && studyId ? (
        <StudyCard noteId={studyId} showAnswer={showAnswer} onReveal={() => setShowAnswer(true)} onNext={(id) => { setStudyId(id); setShowAnswer(false) }} onBack={() => setMode('browse')} />
      ) : (
        <>
          {/* Create card */}
          <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, marginBottom: 16, background: '#f8f9fa' }}>
            <input value={question} onChange={e => setQuestion(e.target.value)} placeholder="Question"
              style={{ width: '100%', padding: 6, border: '1px solid #ddd', borderRadius: 4, marginBottom: 6, fontSize: 13, fontWeight: 600, boxSizing: 'border-box' }} />
            <textarea value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Answer" rows={2}
              style={{ width: '100%', padding: 6, border: '1px solid #ddd', borderRadius: 4, marginBottom: 6, fontSize: 13, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={cardTags} onChange={e => setCardTags(e.target.value)} placeholder="Tags: algorithms, ds"
                style={{ flex: 1, padding: 6, border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }} />
              <button onClick={handleCreate}
                style={{ padding: '6px 14px', background: '#34a853', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
                Add Card
              </button>
            </div>
          </div>

          {/* Search cards */}
          <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); void handleSearch(e.target.value) }}
            placeholder="Search cards by topic..."
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box', marginBottom: 12 }} />

          {searchData?.facets?.tags && searchData.facets.tags.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {searchData.facets.tags.filter(f => f.tag !== APP_TAG).map(f => (
                <span key={f.tag} onClick={() => void handleSearch(f.tag)}
                  style={{ display: 'inline-block', background: '#e8f0fe', color: '#1a73e8', borderRadius: 4, padding: '2px 8px', fontSize: 11, marginRight: 4, cursor: 'pointer' }}>
                  {f.tag} ({f.count})
                </span>
              ))}
            </div>
          )}

          {/* Card list */}
          {cards && (cards as Array<{ id: string; title: string | null }>).map((card) => (
            <div key={card.id} onClick={() => startStudy(card.id)}
              style={{ padding: 10, border: '1px solid #eee', borderRadius: 6, marginBottom: 6, cursor: 'pointer', transition: 'border-color 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#4a9eff' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#eee' }}>
              <strong style={{ fontSize: 14 }}>{card.title ?? 'Untitled'}</strong>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function StudyCard({ noteId, showAnswer, onReveal, onNext, onBack }: {
  noteId: string; showAnswer: boolean; onReveal: () => void; onNext: (id: string) => void; onBack: () => void
}) {
  const { data: note } = useNote(noteId)
  const { links } = useRelatedNotes(noteId, 5)

  if (!note) return <p style={{ color: '#999' }}>Loading...</p>

  return (
    <div>
      <button onClick={onBack} style={{ fontSize: 12, cursor: 'pointer', background: 'none', border: 'none', color: '#4a9eff', padding: 0, marginBottom: 12 }}>
        &larr; Back to cards
      </button>

      {/* Question */}
      <div style={{ background: '#f0f4ff', border: '2px solid #4a9eff', borderRadius: 12, padding: 24, textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>QUESTION</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>{note.title}</div>
      </div>

      {/* Answer */}
      {showAnswer ? (
        <div style={{ background: '#e8f5e9', border: '2px solid #34a853', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>ANSWER</div>
          <div style={{ fontSize: 15, lineHeight: 1.6 }}>{note.current.content}</div>
        </div>
      ) : (
        <button onClick={onReveal}
          style={{ width: '100%', padding: 14, background: '#34a853', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
          Show Answer
        </button>
      )}

      {/* Related cards — "Study Next" suggestions powered by semantic linking */}
      {links.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 500 }}>Study next (related cards):</div>
          {links.map(l => (
            <div key={l.noteId} onClick={() => onNext(l.noteId)}
              style={{ padding: 8, border: '1px solid #eee', borderRadius: 6, marginBottom: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#4a9eff' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#eee' }}>
              {l.confidence != null && <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#999' }}>{l.confidence.toFixed(2)}</span>}
              <span style={{ fontSize: 13 }}>{l.title ?? 'Untitled'}</span>
              <span style={{ fontSize: 10, color: '#999', background: '#f0f0f0', borderRadius: 3, padding: '1px 4px', marginLeft: 'auto' }}>{l.linkType}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
