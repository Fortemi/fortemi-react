import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRemoteBackend } from '../data-backend.js'
import { parseRemoteConcepts, parseRemoteLinks, parseRemoteNoteDetail, parseRemoteProvenance } from '../remote-contract.js'

const bytes = readFileSync(new URL('./fixtures/remote-adapter.json', import.meta.url))
const fixture = JSON.parse(bytes.toString('utf8'))
const body = (name: string) => fixture.cases[name].response.body
const backend = (name: string) => createRemoteBackend({
  baseUrl: 'https://producer-fixture.invalid',
  fetchImpl: async () => Response.json(body(name), {
    status: fixture.cases[name].response.status,
    headers: { 'Content-Type': fixture.cases[name].response.contentType },
  }),
})

describe('producer-captured relationship projections (#418)', () => {
  const id = body('detail_first').note.id as string

  it.each(['links_empty', 'links_outgoing', 'links_incoming'])('preserves %s endpoints and UTC fields', async (name) => {
    const noteId = fixture.cases[name].request.path.split('/')[4]
    const result = await backend(name).linksOf!(noteId)
    expect(result).toEqual(['outgoing', 'incoming'].flatMap((direction) => body(name)[direction].map((link: Record<string, unknown>) => ({
      id: link.id, fromNoteId: link.from_note_id, toNoteId: link.to_note_id, toUrl: link.to_url,
      kind: link.kind, score: link.score, createdAt: link.created_at_utc, snippet: link.snippet, direction, remoteMetadata: link.metadata,
    }))))
  })

  it('retains self-links in each declared direction rather than reversing endpoints', () => {
    const outgoing = { ...body('links_outgoing').outgoing[0], to_note_id: id }
    const result = parseRemoteLinks({ outgoing: [outgoing], incoming: [outgoing] }, id)
    expect(result.map((item) => item.direction)).toEqual(['outgoing', 'incoming'])
    expect(result.every((item) => item.fromNoteId === id && item.toNoteId === id)).toBe(true)
  })

  it('preserves JSON metadata that is not a local object-shaped metadata record', () => {
    const outgoing = { ...body('links_outgoing').outgoing[0], metadata: ['synthetic', 1] }
    const result = parseRemoteLinks({ outgoing: [outgoing], incoming: [] }, id)
    expect(result[0].remoteMetadata).toEqual(['synthetic', 1])
    expect(result[0].metadata).toBeUndefined()
  })

  it('projects actual SKOS assignments and identifies unavailable fields', async () => {
    const concepts = await backend('concepts_nonempty').conceptsOf!(id)
    expect(concepts).toHaveLength(2)
    expect(concepts[0]).toMatchObject({
      id: body('concepts_nonempty')[0][1].id, prefLabel: 'lane-b-remote',
      unavailableFields: ['altLabels', 'definition'], assignment: { noteId: id, source: 'user' },
    })
  })

  it.each(['provenance_empty', 'provenance_nonempty'])('keeps the producer %s model intact', async (name) => {
    const graph = await backend(name).provenanceGraphOf!(id)
    expect(graph).toEqual(body(name))
    expect(graph).not.toHaveProperty('entityType')
  })

  it('accepts the declared nullable current chain without inventing one', () => {
    expect(parseRemoteProvenance({ ...body('provenance_empty'), current_chain: null }, id).current_chain).toBeNull()
  })

  it('does not disguise server activities as local provenance edges', async () => {
    await expect(backend('provenance_nonempty').provenanceOf!(id)).rejects.toMatchObject({ kind: 'unsupported-operation' })
  })

  it('composes nonempty relationships with an existing revised note', async () => {
    const remote = createRemoteBackend({ baseUrl: 'https://producer-fixture.invalid', fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname
      const name = path.endsWith('/links') ? 'links_outgoing'
        : path.endsWith('/concepts') ? 'concepts_nonempty'
          : path.endsWith('/provenance') ? 'provenance_nonempty' : 'detail_revised'
      return Response.json(body(name))
    } })
    const note = await remote.getNoteFull!(id)
    expect(note).toMatchObject({ id, content: 'Synthetic current revised content' })
    expect(note?.links).toHaveLength(1)
    expect(note?.concepts).toHaveLength(2)
    expect(note?.provenanceGraph).toEqual(body('provenance_nonempty'))
    expect(note?.provenance).toBeUndefined()
  })

  it('rejects cross-note relationships and malformed provenance components', () => {
    expect(() => parseRemoteLinks(body('links_incoming'), id)).toThrow('invalid-response')
    const concepts = structuredClone(body('concepts_nonempty'))
    concepts[0][0].concept_id = id
    expect(() => parseRemoteConcepts(concepts, id)).toThrow('invalid-response')
    const graph = structuredClone(body('provenance_nonempty'))
    delete graph.all_edges[0].revision_id
    expect(() => parseRemoteProvenance(graph, id)).toThrow('invalid-response')
    expect(() => parseRemoteProvenance({ ...body('provenance_empty'), current_chain: [] }, id)).toThrow('invalid-response')
    expect(() => parseRemoteProvenance({ ...body('provenance_empty'), derived_count: 1 }, id)).toThrow('invalid-response')
  })
})

describe('producer-captured remote note contract (#417, #1146)', () => {
  it('pins the actual producer capture without claiming released consumer coverage', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('cf2949e25dd5bba13466b6bf15957f233464279d974a3e0917ce2a8d33ffbd4f')
    expect(fixture.producer.commit).toBe('e91c595a896275f835cb7ed1aef173cb26056206')
    expect(fixture.cleanup.remainingVisibleNotes).toBe(0)
  })

  it.each(['list_empty', 'list_nonempty'])('parses %s with UTC fields and exact tags', async (name) => {
    const result = await backend(name).listNotes({ limit: 10, offset: 0 })
    expect(result.total).toBe(body(name).total)
    expect(result.items).toEqual(body(name).notes.map((note: Record<string, unknown>) => ({
      id: note.id, title: note.title, tags: note.tags, starred: note.starred, archived: note.archived,
      createdAt: note.created_at_utc, updatedAt: note.updated_at_utc,
    })))
  })

  it.each(['detail_first', 'detail_second', 'detail_revised', 'detail_starred'])('parses %s without flattening the wire envelope', async (name) => {
    const source = body(name)
    const result = await backend(name).getNote(source.note.id)
    expect(result).toEqual({ id: source.note.id, title: source.note.title, tags: source.tags,
      createdAt: source.note.created_at_utc, updatedAt: source.note.updated_at_utc,
      source: source.note.source, starred: source.note.starred, archived: source.note.archived })
    expect(parseRemoteNoteDetail(source).content).toBe(source.revised.content)
  })

  it('preserves an explicitly empty revised value and nullable title', () => {
    const source = structuredClone(body('detail_revised'))
    source.revised.content = ''
    source.note.title = null
    expect(parseRemoteNoteDetail(source)).toMatchObject({ title: null, content: '' })
  })

  it.each(['id', 'title', 'created_at_utc', 'updated_at_utc'])('rejects missing required note field %s', async (field) => {
    const source = structuredClone(body('detail_revised'))
    delete source.note[field]
    expect(() => parseRemoteNoteDetail(source)).toThrow('invalid-response')
  })

  it('maps a producer not-found response to null', async () => {
    await expect(backend('not_found').getNote('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).resolves.toBeNull()
  })
})
