import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BaseSequencer } from 'vitest/node'

export const partitionCount = 3
const core = resolve(import.meta.dirname, '..')
const repo = resolve(core, '../..')
const vitest = fileURLToPath(import.meta.resolve('vitest/package.json'))
const cli = join(dirname(vitest), 'vitest.mjs')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const json = path => JSON.parse(readFileSync(path))
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const sorted = values => [...values].sort()

export function relativeFile(root, name) {
  assert.equal(typeof name, 'string')
  const path = relative(root, name)
  assert.ok(path && !path.startsWith('../') && !path.startsWith('..\\') && !path.startsWith('/'), 'File outside Core')
  return path.replaceAll('\\', '/')
}

export function reportCases(report, root) {
  assert.equal(report.success, true, 'Failed test report')
  assert.equal(report.numFailedTests, 0)
  assert.equal(report.numFailedTestSuites, 0)
  assert.equal(report.numRuntimeErrorTestSuites ?? 0, 0)
  assert.ok(Array.isArray(report.testResults) && report.testResults.length > 0)
  const cases = {}
  let count = 0
  for (const result of report.testResults) {
    const file = relativeFile(root, result.name)
    assert.ok(!Object.hasOwn(cases, file), 'Duplicate test file')
    assert.equal(result.status, 'passed', 'Test file did not pass')
    assert.ok(Array.isArray(result.assertionResults) && result.assertionResults.length > 0)
    cases[file] = sorted(result.assertionResults.map(test => {
      assert.ok(['passed', 'pending', 'todo'].includes(test.status), 'Unexpected test status')
      assert.equal(typeof test.fullName, 'string')
      assert.equal((test.failureMessages ?? []).length, 0)
      return JSON.stringify([test.fullName, test.status])
    }))
    count += cases[file].length
  }
  assert.equal(count, report.numTotalTests, 'Test-case count disagrees')
  return cases
}

export async function plan(inventory, root) {
  assert.ok(inventory.length >= partitionCount, 'Too few discovered files')
  assert.equal(new Set(inventory).size, inventory.length, 'Duplicate discovery')
  const specs = inventory.map(moduleId => ({ moduleId }))
  const partitions = []
  for (let index = 1; index <= partitionCount; index++) {
    const sequencer = new BaseSequencer({ config: { root, shard: { index, count: partitionCount } } })
    partitions.push(sorted((await sequencer.shard(specs)).map(s => relativeFile(root, s.moduleId))))
  }
  assert.deepEqual(sorted(partitions.flat()), sorted(inventory.map(path => relativeFile(root, path))))
  // The measured bottlenecks must not silently move into one partition as files grow.
  const heavy = ['src/__tests__/shard/native-full-v1-presence.test.ts', 'src/__tests__/shard/native-full-v1-public.test.ts']
  if (heavy.every(file => partitions.flat().includes(file))) {
    assert.notEqual(partitions.findIndex(p => p.includes(heavy[0])), partitions.findIndex(p => p.includes(heavy[1])), 'Heavy suites share a partition')
  }
  return partitions
}

export function verifyPartitions(entries, identity, partitions) {
  assert.equal(entries.length, partitionCount, 'Missing or extra partitions')
  const allCases = {}
  const ids = new Set()
  for (const { receipt, report, blobBytes, reportBytes } of entries) {
    const id = receipt.partition
    assert.ok(Number.isInteger(id) && id >= 1 && id <= partitionCount && !ids.has(id), 'Invalid or duplicate partition')
    ids.add(id)
    assert.deepEqual(receipt.identity, identity, 'Partition source/runtime/root mismatch')
    assert.deepEqual(receipt.files, partitions[id - 1], 'Partition inventory drift')
    assert.equal(receipt.blobSha256, sha256(blobBytes), 'Blob integrity mismatch')
    assert.equal(receipt.reportSha256, sha256(reportBytes), 'Report integrity mismatch')
    const cases = reportCases(report, identity.root)
    assert.deepEqual(sorted(Object.keys(cases)), partitions[id - 1], 'Missing or unexpected test files')
    assert.deepEqual(receipt.cases, cases, 'Receipt case mismatch')
    for (const [file, tests] of Object.entries(cases)) {
      assert.ok(!Object.hasOwn(allCases, file), 'Duplicate file across partitions')
      allCases[file] = tests
    }
  }
  assert.deepEqual(sorted(Object.keys(allCases)), sorted(partitions.flat()))
  return allCases
}

function run(root, args, capture = false) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root, env: { ...process.env, VITEST_MAX_WORKERS: '2' },
    ...(capture ? { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 } : { stdio: 'inherit' }),
    timeout: 26 * 60 * 1000,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, 'Vitest failed')
  return result.stdout
}

export async function execute(args, { coreRoot = core, repositoryRoot = repo } = {}) {
  const evidence = join(coreRoot, 'test-results/core-shards')
  const [action, number] = args
  assert.ok((action === 'run' && args.length === 2 && /^[1-3]$/.test(number)) || (action === 'merge' && args.length === 1), 'Usage: ci-unit-partitions.mjs run 1|2|3 | merge')
  const version = json(vitest).version
  assert.equal(version, json(join(coreRoot, 'node_modules/@vitest/coverage-v8/package.json')).version, 'Vitest/coverage versions must match')
  const identity = {
    schema: 1, source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
    lockSha256: sha256(readFileSync(join(repositoryRoot, 'pnpm-lock.yaml'))),
    configSha256: sha256(readFileSync(join(coreRoot, 'vitest.config.ts'))),
    root: coreRoot, vitest: version, node: process.versions.node,
  }
  const inventory = JSON.parse(run(coreRoot, ['list', '--filesOnly', '--json'], true)).map(row => row.file)
  const partitions = await plan(inventory, coreRoot)
  if (action === 'run') {
    const partition = Number(number)
    const output = join(evidence, number)
    mkdirSync(evidence, { recursive: true })
    mkdirSync(output)
    const blobPath = join(output, 'blob.json')
    const reportPath = join(output, 'report.json')
    run(coreRoot, ['run', '--maxWorkers=2', '--coverage', '--coverage.thresholds.statements=0', '--coverage.reporter=json-summary',
      '--reporter=default', '--reporter=blob', '--reporter=json', '--outputFile.blob=' + blobPath, '--outputFile.json=' + reportPath,
      '--shard=' + partition + '/' + partitionCount])
    const reportBytes = readFileSync(reportPath)
    const cases = reportCases(JSON.parse(reportBytes), coreRoot)
    assert.deepEqual(sorted(Object.keys(cases)), partitions[partition - 1])
    save(join(output, 'receipt.json'), {
      partition, identity, files: partitions[partition - 1], cases,
      reportSha256: sha256(reportBytes), blobSha256: sha256(readFileSync(blobPath)),
    })
    return
  }
  assert.deepEqual(sorted(readdirSync(evidence)), ['1', '2', '3'], 'Unexpected partition directories')
  const entries = partitions.map((_, index) => {
    const dir = join(evidence, String(index + 1))
    assert.deepEqual(sorted(readdirSync(dir)), ['blob.json', 'receipt.json', 'report.json'])
    const reportBytes = readFileSync(join(dir, 'report.json'))
    return { receipt: json(join(dir, 'receipt.json')), report: JSON.parse(reportBytes), reportBytes, blobBytes: readFileSync(join(dir, 'blob.json')) }
  })
  const cases = verifyPartitions(entries, identity, partitions)
  const blobs = join(coreRoot, 'test-results/core-merge-blobs')
  mkdirSync(blobs)
  entries.forEach((_, index) => copyFileSync(join(evidence, String(index + 1), 'blob.json'), join(blobs, String(index + 1) + '.json')))
  const reportPath = join(coreRoot, 'test-results/core-unit.json')
  // No threshold override here: the ordinary Core config enforces global coverage.
  run(coreRoot, ['--merge-reports=' + blobs, '--coverage', '--reporter=json', '--outputFile=' + reportPath])
  assert.deepEqual(reportCases(json(reportPath), coreRoot), cases, 'Merged case inventory differs')
  const coverage = json(join(coreRoot, 'coverage/coverage-summary.json')).total
  assert.ok(coverage.statements.total > 0 && Number.isFinite(coverage.statements.pct), 'Missing coverage')
  save(join(coreRoot, 'test-results/core-unit-completeness.json'), { identity, partitions: partitions.map(p => p.length), files: Object.keys(cases).length, tests: Object.values(cases).reduce((sum, tests) => sum + tests.length, 0), coverage, status: 'PASS' })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await execute(process.argv.slice(2))
