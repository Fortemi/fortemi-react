import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const directory = new URL('../src/__tests__/fixtures/', import.meta.url)
const pin = JSON.parse(readFileSync(new URL('remote-adapter.producer-pin.json', directory), 'utf8'))
assert.equal(pin.repository, 'Fortemi/fortemi')
assert.equal(pin.fixturePath, 'contracts/openapi/fixtures/remote-adapter.json')
assert.match(pin.fixtureCommit, /^[a-f0-9]{40}$/)
assert.match(pin.sha256, /^[a-f0-9]{64}$/)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const local = readFileSync(new URL('remote-adapter.json', directory))
assert.equal(digest(local), pin.sha256, 'consumer fixture differs from its pin')
const [option, root, ...extra] = process.argv.slice(2)
assert.ok(!option || (option === '--authority-root' && root && extra.length === 0), 'usage: verify-remote-producer-fixture.mjs [--authority-root <repo>]')
let upstream
if (root) {
  upstream = execFileSync('git', ['-C', root, 'show', `${pin.fixtureCommit}:${pin.fixturePath}`])
} else {
  const response = await fetch(`https://git.integrolabs.net/${pin.repository}/raw/commit/${pin.fixtureCommit}/${pin.fixturePath}`, {
    signal: globalThis.AbortSignal.timeout(30000), redirect: 'error',
  })
  assert.equal(response.status, 200, 'immutable producer fixture fetch failed')
  upstream = Buffer.from(await response.arrayBuffer())
}
assert.equal(digest(upstream), pin.sha256, 'producer fixture differs from its pin')
assert.ok(local.equals(upstream), 'producer and consumer bytes differ')
const fixture = JSON.parse(local.toString('utf8'))
assert.equal(fixture.producer.commit, pin.runtimeCommit)
assert.equal(fixture.producer.image, pin.runtimeImage)
console.log(JSON.stringify({ fixtureCommit: pin.fixtureCommit, runtimeCommit: pin.runtimeCommit, sha256: pin.sha256, upstreamBytesVerified: true }))
