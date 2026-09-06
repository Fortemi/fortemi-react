#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildArtifactVerificationPlan,
  integrityForBytes,
  parseChecksumManifest,
  verifyLocalArtifacts,
} from './verify-published-artifacts.mjs';

test('computes npm-compatible sha512 integrity for packed bytes', () => {
  const bytes = Buffer.from('packed tarball bytes');
  assert.equal(
    integrityForBytes(bytes),
    `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  );
});

test('verifies local tarballs against npm integrity and release attachment checksums', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-release-verify-'));
  try {
    const coreBytes = Buffer.from('core tarball');
    const graphBytes = Buffer.from('graph tarball');
    const reactBytes = Buffer.from('react tarball');
    const tarballs = {
      'fortemi-core-1.2.3.tgz': coreBytes,
      'fortemi-graph-1.2.3.tgz': graphBytes,
      'fortemi-react-1.2.3.tgz': reactBytes,
    };

    let manifest = '';
    for (const [name, bytes] of Object.entries(tarballs)) {
      writeFileSync(join(root, name), bytes);
      manifest += `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`;
    }
    writeFileSync(join(root, 'SHA256SUMS'), manifest);

    const plan = buildArtifactVerificationPlan({
      version: '1.2.3',
      packDir: root,
      registry: 'https://registry.example.test',
      releasePlatform: 'github',
      releaseApi: 'https://forge.example.test/api',
      releaseRepo: 'Fortemi/fortemi-react',
      releaseTag: 'v1.2.3',
    });

    const releaseAssets = new Map(
      Object.entries(tarballs).map(([name, bytes]) => [name, bytes]),
    );
    releaseAssets.set('SHA256SUMS', Buffer.from(manifest));
    const packageTarballs = new Map([
      ['@fortemi/core', coreBytes],
      ['@fortemi/graph', graphBytes],
      ['@fortemi/react', reactBytes],
    ]);

    const result = await verifyLocalArtifacts(plan, {
      fetchNpmMetadata: async (packageName) => ({
        dist: { integrity: integrityForBytes(packageTarballs.get(packageName)) },
      }),
      fetchReleaseAsset: async (name) => releaseAssets.get(name),
    });

    assert.deepEqual(result.verified.map((entry) => entry.name), [
      'fortemi-core-1.2.3.tgz',
      'fortemi-graph-1.2.3.tgz',
      'fortemi-react-1.2.3.tgz',
      'SHA256SUMS',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parses sha256sum manifests and rejects mismatches', () => {
  assert.deepEqual(parseChecksumManifest('abc  file.tgz\n'), new Map([['file.tgz', 'abc']]));
  assert.throws(() => parseChecksumManifest('abc file.tgz\nbad-line\n'), /invalid checksum/);
});

test('rejects registry dist.integrity mismatches', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-release-verify-'));
  try {
    for (const name of ['core', 'graph', 'react']) {
      writeFileSync(join(root, `fortemi-${name}-1.2.3.tgz`), `${name} tarball`);
    }
    const manifest = ['core', 'graph', 'react']
      .map((name) => {
        const filename = `fortemi-${name}-1.2.3.tgz`;
        const bytes = readFileSync(join(root, filename));
        return `${createHash('sha256').update(bytes).digest('hex')}  ${filename}`;
      })
      .join('\n') + '\n';
    writeFileSync(join(root, 'SHA256SUMS'), manifest);

    const plan = buildArtifactVerificationPlan({
      version: '1.2.3',
      packDir: root,
      registry: 'https://registry.example.test',
      releasePlatform: 'github',
      releaseApi: 'https://forge.example.test/api',
      releaseRepo: 'Fortemi/fortemi-react',
      releaseTag: 'v1.2.3',
    });

    await assert.rejects(
      verifyLocalArtifacts(plan, {
        fetchNpmMetadata: async () => ({ dist: { integrity: 'sha512-not-the-local-tarball' } }),
        fetchReleaseAsset: async (name) => readFileSync(join(root, name)),
      }),
      /dist\.integrity .* does not match local/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects release attachment digest mismatches', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-release-verify-'));
  try {
    for (const name of ['core', 'graph', 'react']) {
      writeFileSync(join(root, `fortemi-${name}-1.2.3.tgz`), `${name} tarball`);
    }
    const manifest = ['core', 'graph', 'react']
      .map((name) => {
        const filename = `fortemi-${name}-1.2.3.tgz`;
        const bytes = readFileSync(join(root, filename));
        return `${createHash('sha256').update(bytes).digest('hex')}  ${filename}`;
      })
      .join('\n') + '\n';
    writeFileSync(join(root, 'SHA256SUMS'), manifest);

    const plan = buildArtifactVerificationPlan({
      version: '1.2.3',
      packDir: root,
      registry: 'https://registry.example.test',
      releasePlatform: 'github',
      releaseApi: 'https://forge.example.test/api',
      releaseRepo: 'Fortemi/fortemi-react',
      releaseTag: 'v1.2.3',
    });

    await assert.rejects(
      verifyLocalArtifacts(plan, {
        fetchNpmMetadata: async (packageName) => {
          const suffix = packageName.split('/').pop();
          return { dist: { integrity: integrityForBytes(readFileSync(join(root, `fortemi-${suffix}-1.2.3.tgz`))) } };
        },
        fetchReleaseAsset: async (name) => name.endsWith('.tgz') ? Buffer.from('different release bytes') : readFileSync(join(root, name)),
      }),
      /release asset .* sha256 .* does not match local/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
