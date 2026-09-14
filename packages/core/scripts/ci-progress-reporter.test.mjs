import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ProgressReporter from './ci-progress-reporter.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-ci-progress-'))
  const output = join(root, 'progress.json')
  const reporter = new ProgressReporter({ output })
  reporter.onInit({ config: { root } })
  const module = { moduleId: join(root, 'example.test.mjs') }
  const task = { module, fullName: 'suite > case', result: () => ({ state: 'passed' }) }
  return { root, output, reporter, module, task, read: () => JSON.parse(readFileSync(output)), cleanup: () => rmSync(root, { recursive: true }) }
}
test('records case and hook lifecycle before the final report exists', () => {
  const f = fixture()
  try {
    f.reporter.onTestModuleStart(f.module)
    f.reporter.onTestCaseReady(f.task)
    f.reporter.onHookStart({ entity: f.task, name: 'beforeEach' })
    assert.equal(f.read().active['example.test.mjs'].phase, 'beforeEach-start')
    assert.equal(f.read().active['example.test.mjs'].name, 'suite > case')
    f.reporter.onHookEnd({ entity: f.task, name: 'beforeEach' })
    f.reporter.onTestCaseResult(f.task)
    assert.equal(f.read().active['example.test.mjs'].phase, 'case-passed')
    f.reporter.onTestModuleEnd(f.module)
    f.reporter.onTestRunEnd([], [], 'passed')
    assert.deepEqual(f.read().active, {})
    assert.equal(f.read().completedTests, 1)
    assert.equal(f.read().completedModules, 1)
    assert.equal(f.read().phase, 'passed')
    assert.equal(existsSync(f.output + '.tmp'), false)
  } finally { f.cleanup() }
})
test('refuses overwriting another run and outside modules', () => {
  const f = fixture()
  try {
    assert.throws(() => new ProgressReporter({ output: f.output }).onInit({ config: { root: f.root } }), /EEXIST/)
    assert.throws(() => f.reporter.onTestModuleStart({ moduleId: '/outside.test.mjs' }), /Invalid CI progress module/)
  } finally { f.cleanup() }
})
test('bounds names, active modules and serialized snapshots', () => {
  const f = fixture()
  try {
    f.task.fullName = 'x'.repeat(10000)
    f.reporter.onTestCaseReady(f.task)
    assert.equal(f.read().active['example.test.mjs'].name.length, 512)
    assert.match(f.read().active['example.test.mjs'].nameSha256, /^[a-f0-9]{64}$/)
    for (let i = 1; i < 16; i++) f.reporter.onTestModuleStart({ moduleId: join(f.root, i + '.test.mjs') })
    assert.throws(() => f.reporter.onTestModuleStart({ moduleId: join(f.root, 'extra.test.mjs') }), /Too many active/)
    const previous = readFileSync(f.output, 'utf8')
    f.reporter.state.unexpected = 'x'.repeat(65536)
    assert.throws(() => f.reporter.save(), /exceeds its bound/)
    assert.equal(readFileSync(f.output, 'utf8'), previous)
  } finally { f.cleanup() }
})
test('retains distinct modules while recording failed and interrupted results', () => {
  const f = fixture()
  try {
    const other = { moduleId: join(f.root, 'other.test.mjs') }
    f.reporter.onTestModuleStart(other)
    f.task.result = () => ({ state: 'failed' })
    f.reporter.onTestCaseResult(f.task)
    assert.equal(Object.keys(f.read().active).length, 2)
    assert.equal(f.read().active['example.test.mjs'].phase, 'case-failed')
    f.reporter.onTestRunEnd([], [], 'interrupted')
    assert.equal(f.read().phase, 'interrupted')
  } finally { f.cleanup() }
})

test('actual Vitest timeout retains the last hook without a final JSON report', { timeout: 20000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-ci-progress-live-'))
  try {
    const output = join(root, 'progress.json')
    const core = resolve(import.meta.dirname, '..')
    symlinkSync(join(core, 'node_modules'), join(root, 'node_modules'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
    writeFileSync(join(root, 'vitest.config.mjs'), 'export default { test: { include: ["*.test.mjs"], hookTimeout: 30000, maxWorkers: 1 } }')
    writeFileSync(join(root, 'blocked.test.mjs'), 'import { beforeEach, it } from "vitest"; beforeEach(async () => { await new Promise(() => {}) }); it("blocked synthetic hook", () => {});')
    const cli = join(dirname(fileURLToPath(import.meta.resolve('vitest/package.json'))), 'vitest.mjs')
    const result = spawnSync(process.execPath, [cli, 'run', '--reporter=' + join(import.meta.dirname, 'ci-progress-reporter.mjs'), '--reporter=json', '--outputFile.json=' + join(root, 'results.json')],
      { cwd: root, env: { ...process.env, FORTEMI_CI_PROGRESS: output }, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 65536 })
    assert.equal(result.error?.code, 'ETIMEDOUT')
    const progress = JSON.parse(readFileSync(output))
    assert.equal(progress.active['blocked.test.mjs'].phase, 'beforeEach-start')
    assert.equal(progress.completedTests, 0)
    assert.equal(existsSync(join(root, 'results.json')), false)
  } finally { rmSync(root, { recursive: true }) }
})
