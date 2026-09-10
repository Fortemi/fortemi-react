import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [tarballArgument, expectedVersion, baseArgument, container, receiptArgument] = process.argv.slice(2)
assert.ok(tarballArgument && expectedVersion && baseArgument && container && receiptArgument,
  'usage: verify-remote-package.mjs <core.tgz> <version> <loopback-url> <lane-container> <receipt.json>')
const base = new URL(baseArgument)
assert.equal(base.hostname, '127.0.0.1')
const pin = JSON.parse(readFileSync(new URL('../../packages/core/src/__tests__/fixtures/remote-operations.producer-pin.json', import.meta.url), 'utf8'))
const identity = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .}}', container], { encoding: 'utf8' }))
assert.equal(identity.Config.Labels['fortemi.lane'], 'b')
assert.equal(identity.Config.Labels['fortemi.task'], 'react-417-421')
assert.equal(identity.Config.Image, pin.runtimeImage)
assert.equal(identity.State.Running, true)
assert.equal(identity.Mounts.length, 0, 'only disposable tmpfs destinations are admitted')
assert.ok(identity.NetworkSettings.Ports['3000/tcp'].some((item) => item.HostIp === '127.0.0.1' && item.HostPort === base.port))
const countNativeNotes = () => Number(execFileSync('docker', ['exec', '--user', 'postgres', container, 'psql', '-d', 'matric', '-Atc', 'SELECT count(*) FROM note'], { encoding: 'utf8' }).trim())
assert.equal(countNativeNotes(), 0, 'clean destination must have zero physical note rows, including tombstones')

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const healthResponse = await fetch(new URL('/health', base), { signal: globalThis.AbortSignal.timeout(30000) })
assert.equal(healthResponse.status, 200)
const health = await healthResponse.json()
assert.equal(health.git_sha, pin.runtimeCommit)
const tarball = resolve(tarballArgument)
const installRoot = mkdtempSync(resolve(tmpdir(), 'fortemi-remote-package-'))
const calls = []
const owned = new Set()
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
const verifierSourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim()
const verifierSourceDirty = execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }).trim().length > 0
let remote
let passed = false
let cleanupPassed = false
try {
  writeFileSync(resolve(installRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: installRoot, stdio: 'inherit' })
  const packageRoot = resolve(installRoot, 'node_modules/@fortemi/core')
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.version, expectedVersion)
  const core = await import(pathToFileURL(resolve(packageRoot, 'dist/index.js')).href)
  assert.equal(core.VERSION, expectedVersion)
  const fetchImpl = async (url, init) => {
    const response = await fetch(url, { ...init, signal: globalThis.AbortSignal.timeout(30000) })
    const bytes = await response.clone().arrayBuffer()
    calls.push({ method: init?.method ?? 'GET', path: new URL(String(url)).pathname,
      status: response.status, responseSha256: digest(Buffer.from(bytes)) })
    return response
  }
  remote = core.createRemoteBackend({ baseUrl: base.href, fetchImpl })
  assert.equal((await remote.listNotes()).total, 0)
  assert.equal(remote.capabilities.merge, false)
  const tag = `package-${randomUUID()}`
  const ids = []
  for (const selection of ['selected', 'excluded']) {
    const created = await remote.manageNote({ action: 'create', content: 'PACKAGE REMOTE NEEDLE',
      title: `Synthetic ${selection}`, tags: [tag, selection], source: 'remote-package-test' })
    owned.add(created.note_id)
    ids.push(created.note_id)
  }
  const [first, second] = ids
  assert.equal((await remote.listNotes({ limit: 10 })).total, 2)
  const note = await remote.getNote(first)
  assert.equal(note.id, first)
  assert.ok(Number.isFinite(Date.parse(note.createdAt)))
  const link = await fetchImpl(new URL(`/api/v1/notes/${first}/links`, base), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to_note_id: second, kind: 'explicit', score: 0.75 }),
  })
  assert.equal(link.status, 201)
  assert.equal((await remote.linksOf(first))[0].direction, 'outgoing')
  assert.equal((await remote.linksOf(second))[0].direction, 'incoming')
  const full = await remote.getNoteFull(first)
  assert.equal(full.content, 'PACKAGE REMOTE NEEDLE')
  assert.equal(full.provenanceGraph.note_id, first)
  assert.ok(full.concepts.length > 0)
  assert.equal(await remote.getNote(randomUUID()), null)
  const search = await remote.search('NEEDLE', { tags: [tag, 'selected'], limit: 10 })
  assert.deepEqual(search.hits.map((hit) => hit.note.id), [first])
  assert.equal(search.totalKind, 'returned-hits')
  assert.equal(search.degraded, false)
  assert.equal((await remote.search('NEEDLE', { tags: ['selected', 'excluded'], limit: 10 })).hits.length, 0)
  assert.equal((await remote.search('NO_MATCH_PACKAGE_TERM', { limit: 10 })).total, 0)
  assert.equal((await remote.search('NEEDLE', { limit: 1 })).hits.length, 1)
  const degraded = await remote.semanticWithReport('NEEDLE', 10)
  assert.equal(degraded.degraded, true)
  assert.equal(degraded.effectiveMode, 'fts')
  await assert.rejects(remote.semantic('NEEDLE', 10), (error) => error.kind === 'degraded-search')
  const beforeRejected = calls.length
  await assert.rejects(remote.search('NEEDLE', { offset: 1 }), (error) => error.kind === 'unsupported-operation')
  await assert.rejects(remote.manageNote({ action: 'update', note_id: first, title: 'unsupported' }), (error) => error.kind === 'invalid-request')
  assert.equal(calls.length, beforeRejected)
  for (const [action, field, expected] of [
    ['star', 'starred', true], ['unstar', 'starred', false],
    ['archive', 'archived', true], ['unarchive', 'archived', false],
  ]) {
    assert.equal((await remote.manageNote({ action, note_id: first })).note[field], expected)
  }
  assert.equal((await remote.manageNote({ action: 'update', note_id: first, content: 'PACKAGE UPDATED' })).note.content, 'PACKAGE UPDATED')
  assert.deepEqual((await remote.manageNote({ action: 'update', note_id: first, tags: [tag, 'updated'] })).note.tags.sort(), [tag, 'updated'].sort())
  await remote.manageNote({ action: 'delete', note_id: first })
  owned.delete(first)
  assert.equal(await remote.getNote(first), null)
  await remote.manageNote({ action: 'restore', note_id: first })
  owned.add(first)
  assert.equal((await remote.getNoteFull(first)).content, 'PACKAGE UPDATED')
  passed = true
} finally {
  try {
    for (const id of owned) await remote.manageNote({ action: 'delete', note_id: id })
    cleanupPassed = remote !== undefined && (await remote.listNotes()).total === 0
  } finally {
    rmSync(installRoot, { recursive: true, force: true })
    const receipt = {
      kind: 'packed-candidate-live-remote-check-not-release-qualification',
      checkedAt: new Date().toISOString(), passed, cleanupPassed,
      packageVersion: expectedVersion, packageSha256: digest(readFileSync(tarball)),
      verifierSourceCommit, verifierSourceDirty,
      producerFixtureCommit: pin.fixtureCommit, producerFixtureSha256: pin.sha256,
      runtimeCommit: health.git_sha, runtimeVersion: health.version, runtimeImage: pin.runtimeImage,
      platform: 'linux-amd64', containerId: identity.Id, containerRemovalRequired: true,
      initialPhysicalNotes: 0, calls,
      boundary: 'Explicit no-auth disposable server with unavailable inference. No successful vector retrieval, auth qualification or published-consumer claim. Suite NO-GO remains.',
    }
    mkdirSync(dirname(resolve(receiptArgument)), { recursive: true })
    writeFileSync(resolve(receiptArgument), `${JSON.stringify(receipt, null, 2)}\n`)
  }
}
assert.equal(cleanupPassed, true)
console.log('Verified packed candidate remote reads, search/degradation and REST lifecycle with synthetic cleanup')
