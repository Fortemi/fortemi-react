import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Exercise the installed dependency, not a copy of its scheduling algorithm.
const requireVitest = createRequire(import.meta.resolve('vitest/package.json'))
const runner = requireVitest.resolve('@vitest/runner/package.json')
assert.equal(JSON.parse(readFileSync(runner)).version, '4.1.1')
const path = join(dirname(runner), 'dist/chunk-artifact.js')
const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'throttle')
assert.equal(declarations.length, 1, 'Review the regression probe when upgrading Vitest')

function clock() {
  let now = 1000, next = 0
  const timers = new Map(), calls = []
  const throttle = runInNewContext('(' + declarations[0].getText(ast) + ')', {
    unixNow: () => now,
    setTimeout: (callback, delay) => { const id = ++next; timers.set(id, { callback, delay }); return id },
    clearTimeout: id => timers.delete(id),
  }, { timeout: 1000 })
  const receiver = { value: 'receiver' }
  const send = throttle(function (...args) { calls.push({ time: now, receiver: this, args }) }, 100)
  return { calls, timers, receiver, send: (...args) => send.call(receiver, ...args),
    fireAt(time) {
      assert.equal(timers.size, 1)
      const [id, timer] = timers.entries().next().value
      assert.equal(timer.delay, 100)
      timers.delete(id); now = time; timer.callback()
    } }
}

for (const elapsed of [100, 101]) {
  test(`installed runner flushes the last progress event at ${elapsed}ms`, () => {
    const f = clock()
    f.send('module-start'); f.send('beforeEach-start')
    assert.equal(f.calls.length, 1)
    f.fireAt(1000 + elapsed)
    assert.equal(f.calls.length, 2)
    assert.equal(f.calls[1].args[0], 'beforeEach-start')
    assert.equal(f.calls[1].receiver, f.receiver)
    assert.equal(f.timers.size, 0)
  })
}

test('installed runner re-arms an early timer and leaves no trailing duplicate', () => {
  const f = clock()
  f.send('module-start'); f.send('beforeEach-start')
  f.fireAt(1099)
  assert.equal(f.calls.length, 1)
  assert.equal(f.timers.size, 1)
  f.fireAt(1199)
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[1].args[0], 'beforeEach-start')
  assert.equal(f.timers.size, 0)
  f.send('beforeEach-end')
  f.fireAt(1299)
  assert.equal(f.calls.length, 3)
  assert.equal(f.calls[2].args[0], 'beforeEach-end')
  assert.equal(f.timers.size, 0)
})
