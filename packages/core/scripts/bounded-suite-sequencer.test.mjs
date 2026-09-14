import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { BaseSequencer } from 'vitest/node'
import { BoundedSuiteSequencer } from './bounded-suite-sequencer.mjs'

const root = '/tmp/fortemi-core-unit/packages/core'
const presence = 'src/__tests__/shard/native-full-v1-presence.test.ts'
const native = 'src/__tests__/shard/native-full-v1-public.test.ts'
const project = { name: 'core', config: { sequence: { groupOrder: 0 }, isolate: true } }
const spec = (name, owner = project) => ({ moduleId: join(root, name), project: owner })
const context = (states = {}, sizes = {}) => ({ config: { root }, cache: {
  getFileTestResults: key => states[key], getFileStats: key => ({ size: sizes[key] ?? 1 }),
} })

test('cold-cache scheduling starts both measured long suites before larger short files', async () => {
  const files = [spec('large.test.ts'), spec(native), spec(presence)]
  const ctx = context({}, { 'core:large.test.ts': 10000, ['core:' + native]: 5000 })
  const before = [...files]
  assert.equal((await new BaseSequencer(ctx).sort(files))[0], files[0])
  assert.deepEqual(await new BoundedSuiteSequencer(ctx).sort(files), [files[2], files[1], files[0]])
  assert.deepEqual(files, before)
})

test('preserves the default order of every nonpriority file and the complete inventory', async () => {
  const files = [spec('fast.test.ts'), spec(presence), spec('slow.test.ts'), spec('failed.test.ts')]
  const ctx = context({ 'core:fast.test.ts': { duration: 1 }, 'core:slow.test.ts': { duration: 9 },
    'core:failed.test.ts': { failed: true, duration: 2 }, ['core:' + presence]: { duration: 3 } })
  const sorted = await new BoundedSuiteSequencer(ctx).sort(files)
  const ordinary = await new BaseSequencer(ctx).sort(files.filter(f => f !== files[1]))
  assert.deepEqual(sorted, [files[1], ...ordinary])
  assert.equal(new Set(sorted).size, files.length)
  assert.ok(files.every(f => sorted.includes(f)))
  assert.deepEqual(await new BoundedSuiteSequencer(ctx).sort([]), [])
})

test('preserves default project groups instead of moving a priority file across them', async () => {
  const first = { name: 'first', config: { sequence: { groupOrder: -1 }, isolate: true } }
  const files = [spec(presence), spec('first.test.ts', first), spec('ordinary.test.ts')]
  assert.deepEqual(await new BoundedSuiteSequencer(context()).sort(files), [files[1], files[0], files[2]])
})

test('inherits exactly the same complete three-way shard membership as Vitest', async () => {
  const files = [spec(presence), spec(native), ...Array.from({ length: 108 }, (_, i) => spec(`file-${i}.test.ts`))]
  const union = []
  for (let index = 1; index <= 3; index++) {
    const ctx = context()
    ctx.config.shard = { index, count: 3 }
    const actual = await new BoundedSuiteSequencer(ctx).shard(files)
    assert.deepEqual(actual, await new BaseSequencer(ctx).shard(files))
    union.push(...actual)
  }
  assert.equal(union.length, files.length)
  assert.equal(new Set(union).size, files.length)
  assert.ok(files.every(f => union.includes(f)))
})
