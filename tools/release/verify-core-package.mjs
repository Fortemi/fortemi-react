import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const [tarballArgument, expectedVersion] = process.argv.slice(2)
if (!tarballArgument || !expectedVersion) {
  throw new Error('usage: verify-core-package.mjs <core.tgz> <expected-version>')
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

  const core = await import(pathToFileURL(resolve(packageRoot, 'dist/index.js')).href)
  const aiwg = await import(pathToFileURL(resolve(packageRoot, 'dist/aiwg-index.js')).href)
  const aiwgShard = await import(pathToFileURL(resolve(packageRoot, 'dist/aiwg-index-shard.js')).href)
  assert.equal(core.VERSION, expectedVersion)
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
    const unscoredLink = await sourceLinks.create(firstNote.id, secondNote.id, 'related')
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
} finally {
  rmSync(installRoot, { recursive: true, force: true })
}
