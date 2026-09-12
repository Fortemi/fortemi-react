import { strict as assert } from 'node:assert'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { verifyInstalledCapabilities } from './verify-installed-capabilities.mjs'

const [tarballArgument, expectedVersion, receiptPath] = process.argv.slice(2)
if (!tarballArgument || !expectedVersion) {
  throw new Error('usage: verify-core-package.mjs <core.tgz> <expected-version> [receipt.json]')
}

const tarball = resolve(tarballArgument)
const installRoot = mkdtempSync(resolve(tmpdir(), 'fortemi-core-package-'))

function record(id, relationships = []) {
  return {
    schema_version: 'aiwg.fortemi.index.record.v2',
    id,
    type: 'aiwg.artifact',
    source: {
      path: `${id}.md`,
      repo_relative_path: `${id}.md`,
      locator: id,
      origin: 'package-smoke',
      generated: false,
      checksum: `sha256:${id}`,
      updated_at: '2026-07-18T12:00:00.000Z',
    },
    title: id,
    text: `Package smoke record ${id}`,
    facets: {},
    tags: ['package-smoke'],
    concepts: [],
    relationships,
    provenance: [{
      field: 'text',
      source: `${id}.md`,
      path: '$.text',
      confidence: 'source',
      privacy: 'public',
    }],
    search: {
      title: id,
      name: id,
      summary: '',
      body: `Package smoke record ${id}`,
      triggers: [],
      aliases: [],
      capability: 'package-smoke',
      tags: ['package-smoke'],
      phase: 'transition',
      type: 'aiwg.artifact',
      frontmatter: {},
    },
    chunks: [],
    embeddings: [],
    compatibility: { v1_strategy: 'preserve-flat-fields' },
    privacy: { classification: 'public', pii: false, locality: 'project' },
    updated_at: '2026-07-18T12:00:00.000Z',
  }
}

async function verifyFullV1Scope(core) {
  const db = await core.createPGliteInstance('memory', 'package-full-scope')
  try {
    await new core.MigrationRunner(db).apply(core.allMigrations)
    const blobs = new core.MemoryBlobStore()
    const notes = new core.NotesRepository(db)
    const included = await notes.create({ content: 'PACKAGE-INCLUDED', tags: ['selected'] })
    const excluded = await notes.create({ content: 'PACKAGE-EXCLUDED', tags: ['outside'] })
    const excludedBytes = new TextEncoder().encode('PACKAGE-EXCLUDED-BYTES')
    const excludedHash = core.computeBlobHash(excludedBytes)
    await new core.AttachmentsRepository(db, blobs).attach({
      noteId: excluded.id, data: excludedBytes, filename: 'excluded.txt', mimeType: 'text/plain',
    })
    const collectionId = randomUUID()
    await db.query('INSERT INTO collection (id, name) VALUES ($1, $2)', [collectionId, 'Selected collection'])
    await db.query('INSERT INTO collection_note (collection_id, note_id) VALUES ($1, $2)', [collectionId, included.id])
    await db.query(
      "INSERT INTO link (id, source_note_id, target_note_id, link_type) VALUES ($1, $2, $3, 'related')",
      [randomUUID(), included.id, excluded.id],
    )
    const parseNotes = (archive) => new TextDecoder().decode(core.unpackTarGz(archive).get('notes.jsonl'))
      .split('\n').filter(Boolean).map((line) => JSON.parse(line))
    for (const [scope, expectedIds] of [
      [{ tag: 'selected' }, [included.id]],
      [{ collectionId }, [included.id]],
      [{ tag: 'no-match' }, []],
      [{ collectionId: randomUUID() }, []],
    ]) {
      const result = await core.exportShardWithReport(db, {
        profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs, ...scope,
      })
      assert.equal(result.success, true, result.errors.join('; '))
      assert.equal((await core.validateFullV1ShardArchive(result.archive)).valid, true)
      assert.deepEqual(parseNotes(result.archive).map((note) => note.id), expectedIds)
      const files = core.unpackTarGz(result.archive)
      assert.equal(new TextDecoder().decode(files.get('links.jsonl')).trim(), '')
      assert.equal([...files.keys()].some((path) => path.startsWith('blobs/')), false)
      const target = await core.createPGliteInstance('memory', 'package-scoped-target')
      try {
        await new core.MigrationRunner(target).apply(core.allMigrations)
        const targetBlobs = new core.MemoryBlobStore()
        const imported = await core.importShard(target, result.archive, { conflictStrategy: 'replace', blobStore: targetBlobs })
        assert.equal(imported.success, true, imported.errors.join('; '))
        assert.equal(await targetBlobs.read(excludedHash), null)
        const returned = await core.exportShardWithReport(target, {
          profile: 'full-v1', schemaVersion: '2.0.0', blobStore: targetBlobs,
        })
        assert.equal(returned.success, true, returned.errors.join('; '))
        assert.deepEqual(parseNotes(returned.archive).map((note) => note.id), expectedIds)
        for (const nativeScope of [{ tag: 'selected' }, { collectionId }]) {
          const scoped = await core.exportShardWithReport(target, {
            profile: 'full-v1', schemaVersion: '2.0.0', blobStore: targetBlobs, ...nativeScope,
          })
          assert.equal(scoped.success, true, scoped.errors.join('; '))
          assert.equal((await core.validateFullV1ShardArchive(scoped.archive)).valid, true)
          assert.deepEqual(parseNotes(scoped.archive).map((note) => note.id), expectedIds)
          assert.equal([...core.unpackTarGz(scoped.archive).keys()].some((path) => path.startsWith('blobs/')), false)
        }
        const missingSet = await core.exportShardWithReport(target, {
          profile: 'full-v1', schemaVersion: '2.0.0', blobStore: targetBlobs,
          embeddingSetIds: [randomUUID()],
        })
        assert.equal(missingSet.success, true, missingSet.errors.join('; '))
        assert.equal((await core.validateFullV1ShardArchive(missingSet.archive)).valid, true)
        assert.deepEqual(parseNotes(missingSet.archive).map((note) => note.id), expectedIds)
        const missingSetManifest = JSON.parse(new TextDecoder().decode(core.unpackTarGz(missingSet.archive).get('manifest.json')))
        assert.equal(missingSetManifest.counts.embedding_sets, 0)
        assert.equal(missingSetManifest.counts.embeddings, 0)
      } finally { await target.close() }
    }
    for (const scope of [{ tag: 'selected', collectionId }, { tag: '' }, { embeddingSetIds: [] }]) {
      const rejected = await core.exportShardWithReport(db, {
        profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs, ...scope,
      })
      assert.equal(rejected.success, false)
      assert.equal(rejected.archive, null)
    }
    console.log('Verified packed 2.0.0/full-v1 note-scope exclusions and scoped native export after clean import')
  } finally { await db.close() }
}

async function verifyFullV1NativeCurrentState(core) {
  const databases = []
  const createDb = async () => {
    const db = await core.createPGliteInstance('memory', randomUUID())
    databases.push(db)
    await new core.MigrationRunner(db).apply(core.allMigrations)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM note')).rows[0].n, 0)
    return db
  }
  const parse = (archive, path) => new TextDecoder().decode(core.unpackTarGz(archive).get(path))
    .split('\n').filter(Boolean).map(JSON.parse)
  const exportState = async (db, blobs) => {
    const result = await core.exportShardWithReport(db, {
      profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs,
    })
    assert.equal(result.success, true, result.errors.join('; '))
    assert.equal((await core.validateFullV1ShardArchive(result.archive)).valid, true)
    return result.archive
  }
  try {
    const source = await createDb()
    const original = await new core.NotesRepository(source).create({ content: 'Package imported original' })
    const initial = await exportState(source, new core.MemoryBlobStore())
    const target = await createDb()
    const blobs = new core.MemoryBlobStore()
    const imported = await core.importShard(target, initial, { conflictStrategy: 'replace', blobStore: blobs })
    assert.equal(imported.success, true, imported.errors.join('; '))
    const notes = new core.NotesRepository(target)
    assert.equal((await notes.get(original.id)).original.content, 'Package imported original')
    await notes.update(original.id, { content: 'Package native edited', title: 'Updated after import' })
    const created = await notes.create({ content: 'Package native searchable', tags: ['package-native'] })
    const deleted = await notes.create({ content: 'Package native deleted' })
    await notes.delete(deleted.id)
    const link = await new core.LinksRepository(target).create(created.id, original.id)
    const assertRepositories = async (db) => {
      const repository = new core.NotesRepository(db)
      assert.equal((await repository.get(original.id)).current.content, 'Package native edited')
      assert.equal((await repository.get(created.id)).original.content, 'Package native searchable')
      assert.ok((await repository.get(deleted.id)).deleted_at)
      assert.deepEqual(await new core.LinksRepository(db).getBacklinks(original.id), [created.id])
      assert.equal((await new core.LinksRepository(db).get(link.id)).target_note_id, original.id)
      const search = new core.SearchRepository(db)
      assert.deepEqual((await search.search('searchable', { mode: 'text' })).results.map((row) => row.id), [created.id])
      assert.deepEqual((await search.search('deleted', { mode: 'text' })).results, [])
    }
    await assertRepositories(target)
    const current = await exportState(target, blobs)
    const currentNotes = parse(current, 'notes.jsonl')
    assert.deepEqual(currentNotes.map((note) => note.id).sort(), [original.id, created.id, deleted.id].sort())
    assert.equal(currentNotes.find((note) => note.id === original.id).revised_content, 'Package native edited')
    assert.ok(currentNotes.find((note) => note.id === deleted.id).deleted_at)
    assert.deepEqual(parse(current, 'links.jsonl').map((row) => row.id), [link.id])
    const destination = await createDb()
    const destinationBlobs = new core.MemoryBlobStore()
    for (let pass = 0; pass < 2; pass++) {
      const restored = await core.importShard(destination, current, {
        conflictStrategy: 'replace', blobStore: destinationBlobs,
      })
      assert.equal(restored.success, true, restored.errors.join('; '))
      await assertRepositories(destination)
      const returned = await exportState(destination, destinationBlobs)
      for (const path of ['notes.jsonl', 'links.jsonl']) {
        const rows = (archive) => parse(archive, path).sort((a, b) => a.id.localeCompare(b.id))
        assert.deepEqual(rows(returned), rows(current), path)
      }
    }
    console.log('Verified packed 2.0.0/full-v1 persisted native CRUD, search, backlinks and repeated clean-destination export')
  } finally {
    for (const db of databases.reverse()) await db.close()
  }
}

try {
  writeFileSync(
    resolve(installRoot, 'package.json'),
    JSON.stringify({ name: 'fortemi-core-package-smoke', private: true, type: 'module' }),
  )
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
    { cwd: installRoot, stdio: 'inherit' },
  )

  const packageRoot = resolve(installRoot, 'node_modules/@fortemi/core')
  const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
  assert.equal(packageJson.version, expectedVersion)
  const capabilities = verifyInstalledCapabilities(installRoot, expectedVersion)
  console.log(`Verified installed capability negotiation: ${capabilities.wireCases} wire and ${capabilities.versionCases} version vectors`)

  const core = await import(pathToFileURL(resolve(packageRoot, 'dist/index.js')).href)
  const aiwg = await import(pathToFileURL(resolve(packageRoot, 'dist/aiwg-index.js')).href)
  const aiwgShard = await import(pathToFileURL(resolve(packageRoot, 'dist/aiwg-index-shard.js')).href)
  assert.equal(core.VERSION, expectedVersion)
  await verifyFullV1Scope(core)
  await verifyFullV1NativeCurrentState(core)
  assert.equal(core.CURRENT_SHARD_VERSION, '1.2.0')
  assert.equal(typeof aiwg.createAiwgIndexController, 'function')
  assert.equal(aiwg.aiwgFortemiIndexToKnowledgeShard, undefined)
  assert.equal(typeof aiwgShard.aiwgFortemiIndexToKnowledgeShard, 'function')

  const staticIndexSource = readFileSync(resolve(packageRoot, 'dist/aiwg-index.js'), 'utf8')
  assert.ok(
    Buffer.byteLength(staticIndexSource) <= 50_000,
    `dist/aiwg-index.js exceeds 50 KB: ${Buffer.byteLength(staticIndexSource)} bytes`,
  )
  assert.doesNotMatch(staticIndexSource, /\bimport\b/)

  const authority = core.getKnowledgeShardContractReceipt()
  assert.deepEqual(authority.source, {
    repository: 'https://git.integrolabs.net/Fortemi/fortemi',
    commit: '81fbeaf065df3818edd046ed8a744f10eeb00e6f',
    contractPath: 'contracts/knowledge-shard/contract.json',
    contractSha256: '5debc14e0bc7eef403a75e8e063a10f53019e1d74857485d6eda3abaec9397e2',
  })
  assert.equal(authority.knowledgeShard.schemaVersion, '1.2.0')
  assert.equal(
    authority.schemaBundle.sha256,
    'deec0cb66dc09865667256e29340d096c02dd9b0e55bdc1ae60b7effb68ac595',
  )

  const embedding = {
    id: '018f2d2d-bc00-7cc8-8ad2-f147d6a2e77e',
    note_id: null,
    embedding_set_id: null,
    chunk_index: 0,
    text: 'package fingerprint check',
    vector: null,
    model: 'package-smoke',
    created_at: null,
  }
  for (const contractFingerprint of ['a'.repeat(64), null]) {
    assert.deepEqual(
      core.validateShardComponentRecord(
        'embeddings',
        { ...embedding, contract_fingerprint: contractFingerprint },
        'full-v1',
        '1.2.0',
      ),
      { valid: true, errors: [] },
    )
  }
  assert.equal(
    core.validateShardComponentRecord(
      'embeddings',
      { ...embedding, contract_fingerprint: 'A'.repeat(64) },
      'full-v1',
      '1.2.0',
    ).valid,
    false,
  )
  assert.deepEqual(
    core.validateShardComponentRecord('embeddings', embedding, 'full-v1', '1.1.0'),
    { valid: true, errors: [] },
  )

  let sourceDb
  let targetDb
  try {
    sourceDb = await core.createPGliteInstance('memory', 'package-source')
    await new core.MigrationRunner(sourceDb).apply(core.allMigrations)
    const sourceNotes = new core.NotesRepository(sourceDb)
    const sourceCollections = new core.CollectionsRepository(sourceDb)
    const sourceLinks = new core.LinksRepository(sourceDb)
    const firstNote = await sourceNotes.create({ content: 'Packed PGlite source' })
    const secondNote = await sourceNotes.create({ content: 'Packed PGlite target' })
    const authoredLink = await sourceLinks.create(firstNote.id, secondNote.id, 'related')
    assert.equal(authoredLink.confidence, 1)
    await sourceDb.query('UPDATE link SET confidence = NULL WHERE id = $1', [authoredLink.id])
    const unscoredLink = await sourceLinks.get(authoredLink.id)
    const parentCollection = await sourceCollections.create({ name: 'Z parent' })
    const childCollection = await sourceCollections.create({
      name: 'A child',
      parent_id: parentCollection.id,
    })
    assert.equal(unscoredLink.confidence, null)

    const pgliteExport = await core.exportShardWithReport(sourceDb, { profile: 'core-v1' })
    assert.equal(pgliteExport.success, true)
    const pgliteFiles = core.unpackTarGz(pgliteExport.archive)
    assert.deepEqual(await core.validateCoreV1ShardArchive(pgliteFiles), {
      valid: true,
      errors: [],
    })
    const pgliteLinks = new TextDecoder().decode(pgliteFiles.get('links.jsonl')).trim()
      .split('\n').map((line) => JSON.parse(line))
    const pgliteCollections = JSON.parse(
      new TextDecoder().decode(pgliteFiles.get('collections.json')),
    )
    assert.equal(pgliteLinks[0].score, 1)
    assert.equal(pgliteLinks[0].metadata.fortemi_legacy_state.confidence, null)
    assert.deepEqual(
      pgliteCollections.map((collection) => collection.id),
      [childCollection.id, parentCollection.id],
    )

    targetDb = await core.createPGliteInstance('memory', 'package-target')
    await new core.MigrationRunner(targetDb).apply(core.allMigrations)
    const pgliteImport = await core.importShard(targetDb, pgliteExport.archive)
    assert.equal(pgliteImport.success, true)
    const restoredLink = await targetDb.query(
      'SELECT confidence FROM link WHERE id = $1',
      [unscoredLink.id],
    )
    const restoredCollection = await targetDb.query(
      'SELECT parent_id FROM collection WHERE id = $1',
      [childCollection.id],
    )
    assert.equal(restoredLink.rows[0].confidence, null)
    assert.equal(restoredCollection.rows[0].parent_id, parentCollection.id)

    const pgliteReexport = await core.exportShardWithReport(targetDb, { profile: 'core-v1' })
    assert.equal(pgliteReexport.success, true)
    assert.deepEqual(await core.validateCoreV1ShardArchive(pgliteReexport.archive), {
      valid: true,
      errors: [],
    })
  } finally {
    await targetDb?.close()
    await sourceDb?.close()
  }

  const index = {
    schema_version: 'aiwg.fortemi.index.export.v2',
    generated_at: '2026-07-18T12:00:00.000Z',
    source: { repo: 'Fortemi/fortemi-react', privacy: 'public', graph: 'project' },
    compatibility: {
      previous_schema_version: 'aiwg.fortemi.index.export.v1',
      strategy: 'supported',
    },
    items: [
      record('package:source', [{
        type: 'depends-on',
        target_id: 'package:target',
        privacy: 'public',
      }]),
      record('package:target'),
    ],
  }

  const options = {
    createdAt: '2026-07-18T12:00:00.000Z',
    matricVersion: expectedVersion,
  }
  const archive = await aiwgShard.aiwgFortemiIndexToKnowledgeShard(index, options)
  const repeated = await aiwgShard.aiwgFortemiIndexToKnowledgeShard(index, options)
  assert.deepEqual(repeated, archive)
  assert.deepEqual(await core.validateCoreV1ShardArchive(archive), {
    valid: true,
    errors: [],
  })

  const files = core.unpackTarGz(archive)
  const decoder = new TextDecoder()
  const manifest = JSON.parse(decoder.decode(files.get('manifest.json')))
  const notes = decoder.decode(files.get('notes.jsonl')).trim().split('\n')
    .map((line) => JSON.parse(line))
  const links = decoder.decode(files.get('links.jsonl')).trim().split('\n')
    .map((line) => JSON.parse(line))

  assert.equal(manifest.version, '1.2.0')
  assert.equal(manifest.profile, 'core-v1')
  assert.deepEqual(manifest.producer, {
    name: 'fortemi-core-aiwg-index',
    version: expectedVersion,
  })
  assert.equal('matric_version' in manifest, false)
  assert.equal(manifest.counts.notes, 2)
  assert.equal(manifest.counts.links, 1)
  assert.equal(links[0].score, 1)
  assert.equal(notes[0].attachments.length, 0)
  assert.equal(
    notes[0].metadata.aiwg_fortemi_index.record.relationships[0].confidence,
    undefined,
  )

  console.log(`Verified clean-installed @fortemi/core@${expectedVersion} canonical shard behavior`)
  if (receiptPath) {
    const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
    writeFileSync(receiptPath, JSON.stringify({
      status: 'PASS', packageVersion: expectedVersion, packageSha256: digest(tarball),
      capabilities,
      verifierSha256: digest(fileURLToPath(import.meta.url)),
      capabilityVerifierSha256: digest(fileURLToPath(new URL('./verify-installed-capabilities.mjs', import.meta.url))),
      scope: 'Clean-installed candidate capability and registered shard package checks; not published/live server, AIWG or suite parity acceptance',
    }, null, 2) + '\n', { flag: 'wx' })
  }
} finally {
  rmSync(installRoot, { recursive: true, force: true })
}
