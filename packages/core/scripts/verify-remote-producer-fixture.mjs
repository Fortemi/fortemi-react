import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const directory = new URL('../src/__tests__/fixtures/', import.meta.url)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const [option, root, ...extra] = process.argv.slice(2)
assert.ok(!option || (option === '--authority-root' && root && extra.length === 0), 'usage: verify-remote-producer-fixture.mjs [--authority-root <repo>]')

async function upstreamBytes(pin, path, sha256) {
  assert.equal(pin.repository, 'Fortemi/fortemi')
  assert.match(pin.fixtureCommit, /^[a-f0-9]{40}$/)
  assert.match(sha256, /^[a-f0-9]{64}$/)
  let bytes
  if (root) {
    bytes = execFileSync('git', ['-C', root, 'show', `${pin.fixtureCommit}:${path}`], { timeout: 30000, maxBuffer: 1024 * 1024 })
  } else {
    const response = await fetch(`https://git.integrolabs.net/${pin.repository}/raw/commit/${pin.fixtureCommit}/${path}`, {
      signal: globalThis.AbortSignal.timeout(30000), redirect: 'error',
    })
    assert.equal(response.status, 200, 'immutable producer fetch failed')
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      assert.ok(size <= 1024 * 1024, 'producer file exceeds byte ceiling')
      chunks.push(chunk)
    }
    bytes = Buffer.concat(chunks)
  }
  assert.equal(digest(bytes), sha256, 'producer file differs from its pin')
  return bytes
}

async function verifyCopy(pin, path, sha256, name) {
  const local = readFileSync(new URL(name, directory))
  assert.equal(digest(local), sha256, 'consumer file differs from its pin')
  assert.ok(local.equals(await upstreamBytes(pin, path, sha256)), 'producer and consumer bytes differ')
  return JSON.parse(local.toString('utf8'))
}

for (const name of ['remote-adapter', 'remote-operations']) {
  const pin = JSON.parse(readFileSync(new URL(`${name}.producer-pin.json`, directory), 'utf8'))
  assert.equal(pin.repository, 'Fortemi/fortemi')
  assert.equal(pin.fixturePath, `contracts/openapi/fixtures/${name}.json`)
  assert.match(pin.fixtureCommit, /^[a-f0-9]{40}$/)
  assert.match(pin.sha256, /^[a-f0-9]{64}$/)
  const fixture = await verifyCopy(pin, pin.fixturePath, pin.sha256, `${name}.json`)
  assert.equal(fixture.producer.commit, pin.runtimeCommit)
  assert.equal(fixture.producer.image, pin.runtimeImage)
  console.log(JSON.stringify({ fixtureCommit: pin.fixtureCommit, runtimeCommit: pin.runtimeCommit, sha256: pin.sha256, upstreamBytesVerified: true }))
}

const pin = JSON.parse(readFileSync(new URL('native-remote-auth.producer-pin.json', directory), 'utf8'))
assert.equal(pin.fixturePath, 'contracts/openapi/fixtures/native-remote-auth.json')
assert.equal(pin.receipt.path, 'contracts/openapi/fixtures/native-remote-auth.receipt.json')
assert.equal(pin.captureScript.path, 'scripts/ci/capture-native-remote-fixture.mjs')
const fixture = await verifyCopy(pin, pin.fixturePath, pin.sha256, 'native-remote-auth.json')
const receipt = await verifyCopy(pin, pin.receipt.path, pin.receipt.sha256, 'native-remote-auth.receipt.json')
await upstreamBytes(pin, pin.captureScript.path, pin.captureScript.sha256)
assert.equal(fixture.schemaVersion, 'fortemi.native-remote-fixture.v1')
assert.equal(receipt.schemaVersion, 'fortemi.native-remote-receipt.v1')
assert.equal(fixture.status, 'PASS')
assert.equal(fixture.artifact.commit, pin.runtimeCommit)
assert.equal(fixture.artifact.kind, pin.runtimeArtifact.kind)
assert.equal(fixture.artifact.sha256, pin.runtimeArtifact.sha256)
assert.equal(fixture.executableSha256, pin.runtimeArtifact.sha256)
assert.equal(fixture.packageVersion, pin.publishedConsumer.version)
assert.equal(fixture.packageCommit, pin.publishedConsumer.commit)
assert.equal(fixture.packageSha256, pin.publishedConsumer.sha256)
assert.equal(fixture.probeSha256, pin.captureScript.sha256)
assert.equal(receipt.captureScriptSha256, pin.captureScript.sha256)
assert.equal(receipt.fixturePath, pin.fixturePath)
assert.equal(receipt.fixtureSha256, pin.sha256)
assert.equal(receipt.unit, fixture.boundedUnit)
assert.equal(receipt.terminal.unit, receipt.unit)
assert.equal(receipt.terminal.Result, 'success')
assert.equal(receipt.terminal.ActiveState, 'inactive')
assert.equal(receipt.terminal.exitCode, 'exited')
assert.equal(receipt.terminal.exitStatus, '0')
for (const field of ['cgroupAbsent', 'apiPidAbsent', 'postmasterPidAbsent', 'postgresStopped', 'postgresRemoved']) {
  assert.equal(receipt.cleanup[field], true, `historical cleanup missing: ${field}`)
}
assert.deepEqual(receipt.claims, {
  realHttp: true, publishedConsumer: true, personalRequiredAuthentication: true,
  operator403: true, hostedDeniedNote: false, inference: false, suiteParity: false,
})
assert.equal(fixture.checks.length, 13)
assert.equal(fixture.calls.length, 86)
for (const call of fixture.calls) {
  assert.equal(digest(call.rawBody), call.responseSha256)
  assert.deepEqual(JSON.parse(call.rawBody), call.body)
}
console.log(JSON.stringify({ fixtureCommit: pin.fixtureCommit, runtimeCommit: pin.runtimeCommit, sha256: pin.sha256,
  upstreamBytesVerified: true, receiptVerified: true, captureScriptVerified: true, boundary: pin.boundary }))

const negativePin = JSON.parse(readFileSync(new URL('remote-negative-controls.producer-pin.json', directory), 'utf8'))
assert.equal(negativePin.fixturePath, 'contracts/openapi/fixtures/remote-negative-controls.json')
assert.equal(negativePin.receipt.path, 'contracts/openapi/fixtures/remote-negative-package.receipt.json')
assert.equal(negativePin.captureScript.path, 'scripts/ci/verify-remote-negative-package.mjs')
assert.equal(negativePin.helper.path, 'scripts/ci/remote-negative-controls.mjs')
assert.equal(negativePin.classification, 'producer-owned-controlled-fault-injection')
const controls = await verifyCopy(negativePin, negativePin.fixturePath, negativePin.sha256, 'remote-negative-controls.json')
const negativeReceipt = await verifyCopy(negativePin, negativePin.receipt.path, negativePin.receipt.sha256, 'remote-negative-package.receipt.json')
await upstreamBytes(negativePin, negativePin.captureScript.path, negativePin.captureScript.sha256)
await upstreamBytes(negativePin, negativePin.helper.path, negativePin.helper.sha256)
assert.equal(controls.schemaVersion, 'fortemi.remote-negative-controls.v1')
assert.equal(negativeReceipt.schemaVersion, 'fortemi.remote-negative-package.v1')
assert.equal(controls.classification, negativePin.classification)
assert.equal(negativeReceipt.classification, controls.classification)
assert.equal(negativeReceipt.status, 'PASS')
assert.equal(negativeReceipt.fixtureSha256, negativePin.sha256)
assert.equal(negativeReceipt.scriptSha256, negativePin.captureScript.sha256)
assert.equal(negativeReceipt.helperSha256, negativePin.helper.sha256)
assert.equal(negativePin.basisSha256, pin.sha256)
assert.equal(controls.basis.sha256, negativePin.basisSha256)
assert.equal(negativeReceipt.basisSha256, negativePin.basisSha256)
assert.equal(negativeReceipt.packageVersion, negativePin.publishedConsumer.version)
assert.equal(negativeReceipt.packageCommit, negativePin.publishedConsumer.commit)
assert.equal(negativeReceipt.packageSha256, negativePin.publishedConsumer.sha256)
assert.deepEqual(controls.claims, { liveFortemiServer: false, hostedNoteDenial: false, inference: false, suiteParity: false })
assert.deepEqual(negativeReceipt.claims, controls.claims)
assert.equal(negativeReceipt.scratchRemoved, true)
assert.equal(controls.controls.length, 21)
const expectedChecks = controls.controls.flatMap(control => (control.stage === 'note' ? ['getNote', 'getNoteFull'] : ['getNoteFull'])
  .map(method => `${control.id}/${method}`))
assert.equal(expectedChecks.length, 31)
assert.deepEqual(negativeReceipt.checks.map(check => `${check.id}/${check.readMethod}`), expectedChecks)
for (const check of negativeReceipt.checks) {
  const control = controls.controls.find(item => item.id === check.id)
  assert.equal(check.expectedKind, control.expectedKind)
  assert.equal(check.actualKind, control.expectedKind)
  assert.equal(check.injected, 1)
  assert.equal(check.listenerClosed, true)
  assert.equal(check.noteReadableBeforeEnrichmentFault, control.stage !== 'note')
  assert.equal(check.classification, 'controlled-fault-injection')
  assert.equal(check.transport, 'real-private-loopback-http')
}
console.log(JSON.stringify({ fixtureCommit: negativePin.fixtureCommit, sha256: negativePin.sha256,
  upstreamBytesVerified: true, receiptVerified: true, scriptAndHelperVerified: true, boundary: negativePin.boundary }))
