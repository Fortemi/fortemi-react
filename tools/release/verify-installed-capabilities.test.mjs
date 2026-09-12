import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { verifyInstalledCapabilities } from './verify-installed-capabilities.mjs'

const authority = fileURLToPath(new URL(
  '../../packages/core/schemas/dataset-execution-capabilities/', import.meta.url,
))
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const wire = readJson(resolve(authority, 'validation/1.0.1/wire-vectors.json')).cases
const versions = readJson(resolve(authority, 'validation/1.0.1/negotiation-vectors.json')).versions

function fixture(fn) {
  const root = mkdtempSync(resolve(tmpdir(), 'fortemi-capability-gate-test-'))
  const pkg = resolve(root, 'node_modules/@fortemi/core')
  try {
    mkdirSync(pkg, { recursive: true })
    writeFileSync(resolve(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
    const manifest = { name: '@fortemi/core', version: '1.2.3', type: 'module', exports: {
      '.': { import: './index.js' }, './package.json': './package.json',
      './schemas/dataset-execution-capabilities/validation/1.0.1':
        './schemas/dataset-execution-capabilities/validation/1.0.1/schema.json',
    } }
    writeFileSync(resolve(pkg, 'package.json'), JSON.stringify(manifest))
    cpSync(authority, resolve(pkg, 'schemas/dataset-execution-capabilities'), { recursive: true })
    // This oracle double tests the gate, not Core semantics; real packed Core is
    // independently exercised by verify-core-package and its install step.
    const module = `
      export const VERSION = '1.2.3';
      export const DATASET_EXECUTION_CONTRACT = 'fortemi.dataset-execution-capabilities/v1';
      const wire = ${JSON.stringify(wire)};
      const versions = ${JSON.stringify(versions)};
      export function negotiateDatasetExecutionCapabilitiesFromWire(descriptor, request) {
        const item = wire.find(v => JSON.stringify([v.descriptor, v.request]) === JSON.stringify([descriptor, request]));
        if (!item) throw new Error('unknown fixture');
        return item.valid ? { valid:true, result:{accepted:item.accepted} } : {valid:false, diagnostics:[{code:'fixture'}]};
      }
      export function negotiateDatasetExecutionCapabilities(descriptor, request) {
        const item = versions.find(v => v.offered === descriptor.capabilities.find(c => c.id === 'ingest.full').version && v.minimum === request.required[0].minimumVersion);
        if (!item) throw new Error('unknown fixture');
        return {accepted:item.accepted};
      }
    `
    writeFileSync(resolve(pkg, 'index.js'), module)
    fn({ root, pkg, manifest, module })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test('ESM-only installed exports run all authority vectors and return digest-bound evidence', () => {
  fixture(({ root }) => {
    const result = verifyInstalledCapabilities(root, '1.2.3')
    assert.equal(result.status, 'PASS')
    assert.equal(result.wireCases, 11)
    assert.equal(result.versionCases, 20)
    assert.equal(result.files.length, 5)
    assert.match(result.publicEntrySha256, /^[a-f0-9]{64}$/)
    assert.match(result.packageManifestSha256, /^[a-f0-9]{64}$/)
    assert.equal(result.authorityManifestSha256, '20b59bb871c3afc9bb972896b2a2da718970c6fe7ef54b49000418f62a5701c0')
  })
})

test('an install-root directory alias resolves to the same installed package', () => {
  fixture(({ root }) => {
    const alias = resolve(root, 'alias')
    symlinkSync(root, alias, 'junction')
    assert.equal(verifyInstalledCapabilities(alias, '1.2.3').status, 'PASS')
  })
})

for (const key of ['.', './schemas/dataset-execution-capabilities/validation/1.0.1', './package.json']) {
  test('missing installed public export fails: ' + key, () => {
    fixture(({ root, pkg, manifest }) => {
      delete manifest.exports[key]
      writeFileSync(resolve(pkg, 'package.json'), JSON.stringify(manifest))
      assert.throws(() => verifyInstalledCapabilities(root, '1.2.3'), /installed capability probe failed/)
    })
  })
}

for (const path of [
  'validation/1.0.1/manifest.json', 'validation/1.0.1/schema.json',
  'validation/1.0.1/negotiation-vectors.json', 'validation/1.0.1/wire-vectors.json',
  'fixtures/remote-alpha.json',
]) {
  test('installed oracle drift fails: ' + path, () => {
    fixture(({ root, pkg }) => {
      const file = resolve(pkg, 'schemas/dataset-execution-capabilities', path)
      writeFileSync(file, readFileSync(file, 'utf8') + '\n')
      assert.throws(() => verifyInstalledCapabilities(root, '1.2.3'), /installed authority differs/)
    })
  })
}

for (const [name, change] of [
  ['missing negotiator', module => module.replace('export function negotiateDatasetExecutionCapabilitiesFromWire(', 'function negotiateDatasetExecutionCapabilitiesFromWire(')],
  ['wrong wire decision', module => module.replace('valid:true, result:{accepted:item.accepted}', 'valid:true, result:{accepted:!item.accepted}')],
  ['wrong version decision', module => module.replace('return {accepted:item.accepted}', 'return {accepted:!item.accepted}')],
  ['invalid wire invents runtime', module => module.replace('valid:false, diagnostics:', 'valid:false, result:{runtime:{}}, diagnostics:')],
  ['missing diagnostics', module => module.replace("diagnostics:[{code:'fixture'}]", 'diagnostics:[]')],
  ['mutates request', module => module.replace('return item.valid ?', 'request.privateMutation = true; return item.valid ?')],
]) {
  test('installed behavior fails: ' + name, () => {
    fixture(({ root, pkg, module }) => {
      writeFileSync(resolve(pkg, 'index.js'), change(module))
      assert.throws(() => verifyInstalledCapabilities(root, '1.2.3'), /installed capability probe failed/)
    })
  })
}

test('wrong package version fails before capability acceptance', () => {
  fixture(({ root }) => assert.throws(() => verifyInstalledCapabilities(root, '9.9.9'),
    /installed capability probe failed/))
})

test('CI retains the capability receipt and the package verifier invokes the gate before shard work', () => {
  const verifier = readFileSync(new URL('./verify-core-package.mjs', import.meta.url), 'utf8')
  const ci = readFileSync(new URL('../../.gitea/workflows/ci.yml', import.meta.url), 'utf8')
  const capabilityGate = verifier.indexOf('const capabilities = verifyInstalledCapabilities(')
  assert.ok(capabilityGate >= 0 && capabilityGate < verifier.indexOf('await verifyFullV1Scope(core)'))
  assert.ok(ci.includes('core-package-receipt.json'), 'CI must request the package receipt')
  assert.ok(ci.includes('Retain installed package acceptance evidence'), 'CI must retain the receipt and tarball')
})
