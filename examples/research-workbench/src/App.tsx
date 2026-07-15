// EX-18 · research-workbench
//
// A composed application over one in-browser PGlite database. Seven papers are
// seeded once — each a note with an *attachment* (the full text as extracted
// text), *SKOS concept* tags, and *citation* links — and the surface wires four
// focused hooks/tools into one shared selection:
//
//   • citation GraphView   ← the 'cites' edges, communities = research areas
//   • useNote              ← title + abstract for the selected paper
//   • manageAttachments    ← the attached full text
//   • useNoteConcepts      ← SKOS tags (area + method)
//   • manageLinks          ← who this paper cites / is cited by
//   • useNoteProvenance    ← creation + edit history (the "Revise" button adds one)
//
// No server, no model download: the "extracted text" is the corpus body, and
// concepts are assigned directly rather than by an embedding pipeline.

import { useEffect, useMemo, useState } from 'react'
import {
  GraphModeToggle,
  Graph3DLazy,
  ThemeToggle,
  useThemeMode,
  graphThemeFor,
  type GraphMode,
} from '@fortemi/examples-shared/ui'
import { GraphView } from '@fortemi/react/graph'
import {
  useFortemiContext,
  useNote,
  useNoteConcepts,
  useNoteProvenance,
  useUpdateNote,
} from '@fortemi/react'
import { manageAttachments, manageLinks } from '@fortemi/core'
import { AREA_LABEL, PAPERS } from './corpus.js'
import { seedWorkbench, type SeededWorkbench } from './seed.js'

// Cache the seed across StrictMode's double-mount and any remount: the provider's
// db is a singleton per archive, so we want exactly one seed pass.
let seedPromise: Promise<SeededWorkbench> | null = null

export function App() {
  const { db, blobStore } = useFortemiContext()
  const [wb, setWb] = useState<SeededWorkbench | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<GraphMode>('2d')
  const themeMode = useThemeMode()
  const graphTheme = graphThemeFor(themeMode)
  const [tick, setTick] = useState(0) // bump to remount the detail after a revision

  useEffect(() => {
    let alive = true
    seedPromise ??= seedWorkbench(db, blobStore)
    seedPromise.then((s) => {
      if (!alive) return
      setWb(s)
      setSelected((cur) => cur ?? s.idByKey.get(PAPERS[0].key) ?? null)
    })
    return () => { alive = false }
  }, [db, blobStore])

  // Spotlight the selected paper's citation neighbourhood in the graph.
  const spotlight = useMemo(() => {
    if (!wb || !selected) return undefined
    const ids = new Set<string>([selected])
    for (const e of wb.graph.edges) {
      if (e.source === selected) ids.add(e.target)
      if (e.target === selected) ids.add(e.source)
    }
    return [...ids]
  }, [wb, selected])

  const onRevised = () => setTick((t) => t + 1)

  return (
    <main className="page wide">
      <ThemeToggle floating />
      <header>
        <h1>EX-18 · research-workbench</h1>
        <p className="lede">
          A seven-paper library over one <code>PGlite</code> database. Each paper carries an
          <strong> attachment</strong> (full text), <strong>SKOS concept</strong> tags, and
          <strong> citation</strong> links; the citation graph, detail, attachments, concepts, and
          provenance all share one selection. No server, no downloads.
        </p>
      </header>

      {!wb && <p className="selected">Seeding the library…</p>}

      {wb && (
        <section className="workbench">
          <aside className="rail">
            <h2>Papers</h2>
            <ul className="paper-list">
              {PAPERS.map((p) => {
                const id = wb.idByKey.get(p.key)!
                return (
                  <li key={p.key}>
                    <button
                      className={`paper-pick${selected === id ? ' active' : ''}`}
                      onClick={() => setSelected(id)}
                    >
                      <strong>{p.title}</strong>
                      <span className="meta">
                        {p.authors} · {p.year} · <span className={`chip small area-${p.area}`}>{AREA_LABEL[p.area]}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="legend">
              {(['retrieval', 'reasoning', 'agents'] as const).map((a) => (
                <span key={a} className="legend-item">
                  <span className={`dot area-${a}`} /> {AREA_LABEL[a]}
                </span>
              ))}
            </div>
          </aside>

          <div className="canvas" style={{ position: 'relative' }}>
            <GraphModeToggle
              mode={mode}
              onModeChange={setMode}
              style={{ margin: 8 }}
            />
            {mode === '2d' ? (
              <GraphView
                graph={wb.graph}
                layout={{ algorithm: 'force' }}
                filters={{ nodeIds: spotlight }}
                selectedNodeId={selected}
                onSelectNode={setSelected}
                labelFor={(id) => wb.titleByNode.get(id) ?? id}
                width={560}
                height={460}
              />
            ) : (
              <Graph3DLazy
                graph={wb.graph}
                filters={{ nodeIds: spotlight }}
                labelFor={(id) => wb.titleByNode.get(id) ?? id}
                onSelectNode={setSelected}
                theme={graphTheme.force3d}
                height={460}
              />
            )}
            <p className="caption">
              {wb.graph.edges.length} citations across {wb.graph.communities.length} areas — click a
              node to focus its citation neighbourhood.
            </p>
          </div>

          {selected ? (
            <PaperDetail
              key={`${selected}:${tick}`}
              noteId={selected}
              titleByNode={wb.titleByNode}
              onRevised={onRevised}
            />
          ) : (
            <article className="detail-pane">
              <p className="selected">Select a paper.</p>
            </article>
          )}
        </section>
      )}
    </main>
  )
}

interface AttachmentView { id: string; filename: string; text: string }
interface CitationView { id: string; title: string }

function PaperDetail({
  noteId,
  titleByNode,
  onRevised,
}: {
  noteId: string
  titleByNode: Map<string, string>
  onRevised: () => void
}) {
  const { db, blobStore } = useFortemiContext()
  const { data: note } = useNote(noteId)
  const { concepts } = useNoteConcepts(noteId)
  const { events: provenanceEvents } = useNoteProvenance(noteId)
  const { updateNote, loading: revising } = useUpdateNote()

  const [attachments, setAttachments] = useState<AttachmentView[]>([])
  const [cites, setCites] = useState<CitationView[]>([])
  const [citedBy, setCitedBy] = useState<CitationView[]>([])
  const [openText, setOpenText] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const att = await manageAttachments(db, blobStore, { action: 'list', note_id: noteId })
      const links = await manageLinks(db, { action: 'list', note_id: noteId })
      if (!alive) return
      setAttachments(
        (att.attachments ?? []).map((a) => ({
          id: a.id,
          filename: a.filename,
          text: a.extracted_text ?? '',
        })),
      )
      setCites(
        (links.outbound ?? []).map((l) => ({
          id: l.target_note_id,
          title: titleByNode.get(l.target_note_id) ?? l.target_note_id,
        })),
      )
      setCitedBy(
        (links.inbound ?? []).map((l) => ({
          id: l.source_note_id,
          title: titleByNode.get(l.source_note_id) ?? l.source_note_id,
        })),
      )
    })()
    return () => { alive = false }
  }, [db, noteId, titleByNode])

  const revise = async () => {
    if (!note) return
    const stamp = new Date().toLocaleTimeString()
    await updateNote(noteId, { content: `${note.current.content}\n\n[Reviewed ${stamp}]` })
    onRevised() // remounts this pane → provenance re-reads the new revision
  }

  return (
    <article className="detail-pane">
      {note ? (
        <>
          <h2>{note.title ?? 'Untitled'}</h2>
          <div className="chips">
            {note.tags.map((t) => (
              <span key={t} className="chip small">{t}</span>
            ))}
          </div>
          <p className="abstract">{note.current.content}</p>

          <section className="block">
            <h3>Concepts <span className="count">{concepts.length}</span></h3>
            <div className="chips">
              {concepts.length === 0 && <span className="muted">none</span>}
              {concepts.map((c) => (
                <span key={c.conceptId} className="chip" title={c.schemeName}>{c.prefLabel}</span>
              ))}
            </div>
          </section>

          <section className="block">
            <h3>Attachments <span className="count">{attachments.length}</span></h3>
            {attachments.map((a) => (
              <div key={a.id} className="attach">
                <button className="attach-name" onClick={() => setOpenText(openText === a.id ? null : a.id)}>
                  📄 {a.filename} <span className="muted">· {a.text.length} chars extracted</span>
                </button>
                {openText === a.id && <pre className="extracted">{a.text}</pre>}
                {openText !== a.id && <p className="preview">{a.text.slice(0, 180)}…</p>}
              </div>
            ))}
          </section>

          <section className="block cites">
            <div className="cite-col">
              <h3>Cites <span className="count">{cites.length}</span></h3>
              <ul>{cites.map((c) => <li key={c.id}>{c.title}</li>)}{cites.length === 0 && <li className="muted">none</li>}</ul>
            </div>
            <div className="cite-col">
              <h3>Cited by <span className="count">{citedBy.length}</span></h3>
              <ul>{citedBy.map((c) => <li key={c.id}>{c.title}</li>)}{citedBy.length === 0 && <li className="muted">none</li>}</ul>
            </div>
          </section>

          <section className="block">
            <div className="prov-head">
              <h3>Provenance <span className="count">{provenanceEvents.length}</span></h3>
              <button className="ghost" onClick={revise} disabled={revising}>
                {revising ? 'Revising…' : 'Add revision'}
              </button>
            </div>
            <ol className="timeline">
              {provenanceEvents.map((e, i) => (
                <li key={i} className={`ev ${e.type}`}>
                  <span className="ev-label">{e.label}</span>
                  <span className="ev-time">{e.timestamp.toLocaleString()}</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : (
        <p className="selected">Loading paper…</p>
      )}
    </article>
  )
}
