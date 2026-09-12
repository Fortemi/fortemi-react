import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const authorityRoot = fileURLToPath(new URL(
  '../../packages/core/schemas/dataset-execution-capabilities/', import.meta.url,
))
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

// Called by a separate ESM process rooted in the clean install, not this checkout.
export function verifyCapabilityCorpus(core, packageRoot, schemaPath) {
  const validation = 'validation/1.0.1'
  const readJson = (root, path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  const manifest = readJson(authorityRoot, validation + '/manifest.json')
  assert.equal(manifest.revision, '1.0.1')
  assert.deepEqual(manifest.files.map((file) => file.path).sort(),
    ['negotiation-vectors.json', 'schema.json', 'wire-vectors.json'])
  const files = []
  for (const path of [
    validation + '/manifest.json', ...manifest.files.map((file) => validation + '/' + file.path),
    'fixtures/remote-alpha.json',
  ]) {
    const authority = readFileSync(resolve(authorityRoot, path))
    const installed = readFileSync(resolve(packageRoot, 'schemas/dataset-execution-capabilities', path))
    // Bounded digest diagnostics, never a large Buffer diff.
    assert.equal(digest(installed), digest(authority), 'installed authority differs: ' + path)
    const declared = manifest.files.find((file) => validation + '/' + file.path === path)
    if (declared) assert.equal(digest(authority), declared.sha256, 'authority manifest digest: ' + path)
    files.push({ path, sha256: digest(installed), bytes: installed.length })
  }
  assert.equal(realpathSync(schemaPath), realpathSync(resolve(packageRoot,
    'schemas/dataset-execution-capabilities/validation/1.0.1/schema.json')))
  assert.equal(core.DATASET_EXECUTION_CONTRACT, manifest.wireContract)
  assert.equal(typeof core.negotiateDatasetExecutionCapabilitiesFromWire, 'function')
  assert.equal(typeof core.negotiateDatasetExecutionCapabilities, 'function')

  const wire = readJson(authorityRoot, validation + '/wire-vectors.json').cases
  const versions = readJson(authorityRoot, validation + '/negotiation-vectors.json').versions
  assert.equal(wire.length, 11)
  assert.equal(versions.length, 20)
  for (const vector of wire) {
    const descriptor = structuredClone(vector.descriptor)
    const request = structuredClone(vector.request)
    const result = core.negotiateDatasetExecutionCapabilitiesFromWire(descriptor, request)
    assert.equal(result.valid, vector.valid, vector.id)
    if (result.valid) {
      assert.equal(result.result.accepted, vector.accepted, vector.id)
    } else {
      assert.equal('result' in result, false, vector.id + ': invalid input invented a result')
      assert.ok(Array.isArray(result.diagnostics) && result.diagnostics.length > 0, vector.id)
    }
    assert.deepEqual(descriptor, vector.descriptor, vector.id + ': descriptor mutation')
    assert.deepEqual(request, vector.request, vector.id + ': request mutation')
  }
  const baseline = readJson(authorityRoot, 'fixtures/remote-alpha.json')
  for (const vector of versions) {
    const descriptor = structuredClone(baseline)
    descriptor.capabilities.find((entry) => entry.id === 'ingest.full').version = vector.offered
    const request = { contract: core.DATASET_EXECUTION_CONTRACT,
      required: [{ id: 'ingest.full', minimumVersion: vector.minimum }] }
    const before = structuredClone({ descriptor, request })
    const result = core.negotiateDatasetExecutionCapabilities(descriptor, request)
    assert.equal(result.accepted, vector.accepted, vector.id)
    assert.deepEqual({ descriptor, request }, before, vector.id + ': input mutation')
  }
  return { status: 'PASS', validationRevision: '1.0.1', wireCases: wire.length,
    versionCases: versions.length, files,
    authorityManifestSha256: digest(readFileSync(resolve(authorityRoot, validation + '/manifest.json'))) }
}

export function verifyInstalledCapabilities(installRoot, expectedVersion) {
  const packageRoot = realpathSync(resolve(installRoot, 'node_modules/@fortemi/core'))
  const probe = `
    import assert from 'node:assert/strict';
    import * as core from '@fortemi/core';
    import schema from '@fortemi/core/schemas/dataset-execution-capabilities/validation/1.0.1' with { type: 'json' };
    import { readFileSync } from 'node:fs';
    import { createHash } from 'node:crypto';
    import { fileURLToPath } from 'node:url';
    import { verifyCapabilityCorpus } from ${JSON.stringify(import.meta.url)};
    const root = ${JSON.stringify(packageRoot)};
    const manifestPath = fileURLToPath(import.meta.resolve('@fortemi/core/package.json'));
    assert.equal(manifestPath, root + '/package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.version, ${JSON.stringify(expectedVersion)});
    assert.equal(core.VERSION, manifest.version);
    const schemaPath = fileURLToPath(import.meta.resolve('@fortemi/core/schemas/dataset-execution-capabilities/validation/1.0.1'));
    assert.deepEqual(schema, JSON.parse(readFileSync(schemaPath, 'utf8')));
    const result = verifyCapabilityCorpus(core, root, schemaPath);
    const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
    result.publicEntrySha256 = hash(fileURLToPath(import.meta.resolve('@fortemi/core')));
    result.packageManifestSha256 = hash(manifestPath);
    result.packageVersion = manifest.version;
    console.log(JSON.stringify(result));
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: installRoot, encoding: 'utf8', timeout: 30_000, maxBuffer: 256 * 1024,
  })
  assert.equal(result.status, 0,
    'installed capability probe failed: ' + (result.error?.code ?? result.stderr).slice(0, 4000))
  return JSON.parse(result.stdout)
}
