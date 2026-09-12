import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { execute, plan, relativeFile, reportCases, verifyPartitions } from './ci-unit-partitions.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
test('Core package manifest remains bound to the implementation receipt', () => {
  const core = resolve(import.meta.dirname, '..')
  const receipt = JSON.parse(readFileSync(join(core, 'schemas/knowledge-shard-v2.implementation.receipt.json')))
  assert.equal(receipt.implementation['package.json'], digest(readFileSync(join(core, 'package.json'))))
})
function sample() {
  const identity = { root: '/core', source: 'a'.repeat(40), vitest: '4.1.1', node: '22', lockSha256: 'lock', configSha256: 'config' }
  const partitions = [['src/a.test.ts'], ['src/b.test.ts'], ['src/c.test.ts']]
  const entries = partitions.map((files, index) => {
    const report = { success: true, numFailedTests: 0, numFailedTestSuites: 0, numTotalTests: 1,
      testResults: [{ name: '/core/' + files[0], status: 'passed', assertionResults: [{ fullName: 'example', status: 'passed' }] }] }
    const reportBytes = Buffer.from(JSON.stringify(report))
    const blobBytes = Buffer.from('blob-' + index)
    return { report, reportBytes, blobBytes, receipt: { identity, partition: index + 1, files, cases: reportCases(report, '/core'), reportSha256: digest(reportBytes), blobSha256: digest(blobBytes) } }
  })
  return { identity, partitions, entries }
}
test('complete three-part receipt preserves each file and case', () => {
  const s = sample()
  assert.equal(Object.keys(verifyPartitions(s.entries, s.identity, s.partitions)).length, 3)
})
for (const [name, mutate] of [
  ['missing partition', s => s.entries.pop()],
  ['extra partition', s => s.entries.push(s.entries[0])],
  ['duplicate partition', s => { s.entries[1].receipt.partition = 1 }],
  ['invalid partition', s => { s.entries[1].receipt.partition = 0 }],
  ['runtime drift', s => { s.entries[1].receipt.identity = { ...s.identity, node: '24' } }],
  ['source drift', s => { s.entries[1].receipt.identity = { ...s.identity, source: 'b'.repeat(40) } }],
  ['root drift', s => { s.entries[1].receipt.identity = { ...s.identity, root: '/other' } }],
  ['inventory drift', s => { s.entries[1].receipt.files = ['src/other.test.ts'] }],
  ['blob tampering', s => { s.entries[1].blobBytes = Buffer.from('changed') }],
  ['report tampering', s => { s.entries[1].reportBytes = Buffer.from('changed') }],
  ['failed report', s => { s.entries[1].report.success = false }],
  ['missing test file', s => { s.entries[1].report.testResults = [] }],
  ['case count drift', s => { s.entries[1].report.numTotalTests = 2 }],
  ['case status drift', s => { s.entries[1].report.testResults[0].assertionResults[0].status = 'pending' }],
  ['duplicate file', s => { s.entries[1].report.testResults.push(s.entries[1].report.testResults[0]) }],
  ['runtime error', s => { s.entries[1].report.numRuntimeErrorTestSuites = 1 }],
  ['failed assertion', s => { s.entries[1].report.testResults[0].assertionResults[0].failureMessages = ['error'] }],
]) test('rejects ' + name, () => {
  const s = sample()
  mutate(s)
  assert.throws(() => verifyPartitions(s.entries, s.identity, s.partitions))
})
test('outside paths reject; repeated case names remain distinct cases', () => {
  assert.throws(() => relativeFile('/core', '/elsewhere/a.test.ts'))
  const { entries } = sample()
  const report = entries[0].report
  report.testResults[0].assertionResults.push({ fullName: 'example', status: 'passed' })
  report.numTotalTests = 2
  assert.equal(reportCases(report, '/core')['src/a.test.ts'].length, 2)
})
test('Vitest sequencer gives exhaustive disjoint partitions without mutating input', async () => {
  const inventory = Array.from({ length: 11 }, (_, i) => '/core/src/test-' + i + '.test.ts')
  const before = [...inventory]
  const partitions = await plan(inventory, '/core')
  assert.deepEqual(inventory, before)
  assert.deepEqual(partitions.map(p => p.length), [4, 4, 3])
  assert.equal(new Set(partitions.flat()).size, inventory.length)
  await assert.rejects(plan([...inventory, inventory[0]], '/core'))
})

function fixture(threshold) {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-ci-partitions-'))
  const core = resolve(import.meta.dirname, '..')
  symlinkSync(join(core, 'node_modules'), join(root, 'node_modules'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  writeFileSync(join(root, 'vitest.config.ts'), 'export default { test: { include: ["*.test.mjs"], maxWorkers: 2, coverage: { provider: "v8", include: ["subject.mjs"], reporter: ["json-summary"], thresholds: { statements: ' + threshold + ' } } } }')
  writeFileSync(join(root, 'subject.mjs'), 'export function a() { return 1 }\nexport function b() { return 2 }\nexport function c() { return 3 }\n')
  for (const [i, name] of ['a', 'b', 'c'].entries()) {
    writeFileSync(join(root, name + '.test.mjs'), 'import { test, expect } from "vitest"; import {' + name + '} from "./subject.mjs"; test("' + name + '", () => expect(' + name + '()).toBe(' + (i + 1) + '));')
  }
  return root
}
test('actual three-shard runner merges complete coverage and fails closed on repeat/extra data', { timeout: 90000 }, async () => {
  const root = fixture(100)
  try {
    for (const i of [1, 2, 3]) await execute(['run', String(i)], { coreRoot: root })
    await assert.rejects(execute(['run', '1'], { coreRoot: root }), /EEXIST/)
    mkdirSync(join(root, 'test-results/core-shards/4'))
    await assert.rejects(execute(['merge'], { coreRoot: root }), /Unexpected partition/)
    rmSync(join(root, 'test-results/core-shards/4'), { recursive: true })
    await execute(['merge'], { coreRoot: root })
    const receipt = JSON.parse(readFileSync(join(root, 'test-results/core-unit-completeness.json')))
    assert.equal(receipt.status, 'PASS')
    assert.equal(receipt.files, 3)
    assert.equal(receipt.tests, 3)
    assert.equal(receipt.coverage.statements.pct, 100)
  } finally { rmSync(root, { recursive: true }) }
})
test('actual merged coverage enforces the unchanged config threshold', { timeout: 90000 }, async () => {
  const root = fixture(101)
  try {
    for (const i of [1, 2, 3]) await execute(['run', String(i)], { coreRoot: root })
    await assert.rejects(execute(['merge'], { coreRoot: root }), /Vitest failed/)
  } finally { rmSync(root, { recursive: true }) }
})
