// One-shot deterministic seed. Given the live PGlite database and its blob store
// (both from FortemiProvider), this writes the whole research library:
//
//   - a note per paper (title + abstract, tagged with its area)
//   - an attachment per paper carrying the "full text" as extracted text
//   - a SKOS scheme with area + method concepts, each note tagged
//   - citation links (link_type 'cites') for every edge in the DAG
//
// It returns the note-id map plus a citation CommunityGraph (communities = areas)
// so the UI can render the graph and drive one shared selection. Nothing here
// touches the network or a model — the "extracted text" is the corpus body.

import {
  NotesRepository,
  SkosRepository,
  manageAttachments,
  manageLinks,
  type DatabaseClient,
  type BlobStore,
} from '@fortemi/core'
import type { CommunityGraph, GraphEdge } from '@fortemi/graph'
import { AREA_LABEL, PAPERS, type Area } from './corpus.js'

export interface SeededWorkbench {
  idByKey: Map<string, string>
  keyById: Map<string, string>
  areaByNode: Map<string, Area>
  titleByNode: Map<string, string>
  graph: CommunityGraph
}

function toBase64(text: string): string {
  // btoa only handles Latin-1; round-trip through UTF-8 so em dashes / accents survive.
  return btoa(unescape(encodeURIComponent(text)))
}

export async function seedWorkbench(
  db: DatabaseClient,
  blobStore: BlobStore,
): Promise<SeededWorkbench> {
  const notes = new NotesRepository(db)
  const skos = new SkosRepository(db)

  // 1 · Concept scheme: one concept per area + every cross-cutting method concept.
  const scheme = await skos.createScheme('Topics', 'Research areas and methods')
  const conceptId = new Map<string, string>()
  const areas: Area[] = ['retrieval', 'reasoning', 'agents']
  for (const a of areas) {
    const c = await skos.createConcept(scheme.id, AREA_LABEL[a], { definition: `Area: ${AREA_LABEL[a]}` })
    conceptId.set(`area:${a}`, c.id)
  }
  for (const label of new Set(PAPERS.flatMap((p) => p.concepts))) {
    const c = await skos.createConcept(scheme.id, label)
    conceptId.set(`method:${label}`, c.id)
  }

  // 2 · Notes + attachments + concept tags.
  const idByKey = new Map<string, string>()
  const keyById = new Map<string, string>()
  const areaByNode = new Map<string, Area>()
  const titleByNode = new Map<string, string>()

  for (const p of PAPERS) {
    const note = await notes.create({
      title: p.title,
      content: `${p.abstract}\n\n— ${p.authors}, ${p.year}`,
      tags: [p.area],
    })
    idByKey.set(p.key, note.id)
    keyById.set(note.id, p.key)
    areaByNode.set(note.id, p.area)
    titleByNode.set(note.id, p.title)

    // Attach the "full text" as an extracted-text attachment (no OCR, no download).
    await manageAttachments(db, blobStore, {
      action: 'attach',
      note_id: note.id,
      data_base64: toBase64(p.body),
      filename: `${p.key}.txt`,
      mime_type: 'text/plain',
      extracted_text: p.body,
      display_name: `${p.title} (full text)`,
    })

    // Concept tags: the area, plus each method concept.
    await skos.tagNote(note.id, conceptId.get(`area:${p.area}`)!)
    for (const m of p.concepts) await skos.tagNote(note.id, conceptId.get(`method:${m}`)!)
  }

  // 3 · Citation links (directed: citing → cited).
  for (const p of PAPERS) {
    for (const target of p.cites) {
      await manageLinks(db, {
        action: 'create',
        source_note_id: idByKey.get(p.key)!,
        target_note_id: idByKey.get(target)!,
        link_type: 'cites',
      })
    }
  }

  // 4 · Citation CommunityGraph — communities are the three areas.
  const nodes = PAPERS.map((p) => ({ id: idByKey.get(p.key)! }))
  const edges: GraphEdge[] = PAPERS.flatMap((p) =>
    p.cites.map((t) => ({
      source: idByKey.get(p.key)!,
      target: idByKey.get(t)!,
      weight: 1,
      kind: 'cites',
    })),
  )
  const communities = areas.map((a) => ({
    id: `area-${a}`,
    nodes: PAPERS.filter((p) => p.area === a).map((p) => idByKey.get(p.key)!),
  }))

  return { idByKey, keyById, areaByNode, titleByNode, graph: { nodes, edges, communities } }
}
