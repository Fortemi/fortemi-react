#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildArtifactVerificationPlan,
  integrityForBytes,
  verifyLocalArtifacts,
} from './verify-published-artifacts.mjs';

function writeFetchMock(path) {
  writeFileSync(path, `
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const uploadDir = process.env.TEST_RELEASE_UPLOAD_DIR;

globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(String(url));
  if (options.method !== 'POST' && parsed.pathname === '/repos/Fortemi/fortemi-react/releases/tags/v1.2.3') {
    return new Response(JSON.stringify({ message: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }

  if (options.method === 'POST' && parsed.pathname === '/repos/Fortemi/fortemi-react/releases') {
    return Response.json({
      id: 42,
      html_url: 'https://github.example.test/Fortemi/fortemi-react/releases/tag/v1.2.3',
      upload_url: 'https://uploads.example.test/assets{?name,label}',
      assets: [],
    }, { status: 201 });
  }

  if (options.method === 'POST' && parsed.hostname === 'uploads.example.test' && parsed.pathname === '/assets') {
    const name = parsed.searchParams.get('name');
    const bytes = Buffer.from(await new Response(options.body).arrayBuffer());
    writeFileSync(join(uploadDir, name), bytes);
    return Response.json({ id: name, name }, { status: 201 });
  }

  return new Response('unexpected ' + options.method + ' ' + url, { status: 500 });
};
`);
}

test('repository release creation persists SHA256SUMS for the verifier handoff', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-release-handoff-'));
  const packDir = join(root, 'pack');
  const uploadDir = join(root, 'uploads');
  mkdirSync(packDir);
  mkdirSync(uploadDir);

  try {
    const tarballs = new Map([
      ['fortemi-core-1.2.3.tgz', Buffer.from('core package bytes')],
      ['fortemi-graph-1.2.3.tgz', Buffer.from('graph package bytes')],
      ['fortemi-react-1.2.3.tgz', Buffer.from('react package bytes')],
    ]);
    for (const [name, bytes] of tarballs) {
      writeFileSync(join(packDir, name), bytes);
    }
    const fetchMock = join(root, 'release-fetch-mock.mjs');
    writeFetchMock(fetchMock);

    const result = spawnSync(process.execPath, ['--import', fetchMock, 'tools/release/create-repo-release.mjs'], {
      cwd: new URL('../..', import.meta.url),
      env: {
        ...process.env,
        TEST_RELEASE_UPLOAD_DIR: uploadDir,
        RELEASE_PLATFORM: 'github',
        RELEASE_TAG: 'v1.2.3',
        RELEASE_TOKEN: 'test-token',
        RELEASE_API: 'https://api.github.example.test',
        RELEASE_REPO: 'Fortemi/fortemi-react',
        RELEASE_PACK_DIR: packDir,
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(join(packDir, 'SHA256SUMS')), true, 'release creator must leave SHA256SUMS for the next verifier step');

    const plan = buildArtifactVerificationPlan({
      version: '1.2.3',
      packDir,
      registry: 'https://registry.example.test',
      releasePlatform: 'github',
      releaseApi: 'https://api.github.example.test',
      releaseRepo: 'Fortemi/fortemi-react',
      releaseTag: 'v1.2.3',
    });

    const npmTarballs = new Map([
      ['@fortemi/core', tarballs.get('fortemi-core-1.2.3.tgz')],
      ['@fortemi/graph', tarballs.get('fortemi-graph-1.2.3.tgz')],
      ['@fortemi/react', tarballs.get('fortemi-react-1.2.3.tgz')],
    ]);
    const verification = await verifyLocalArtifacts(plan, {
      fetchNpmMetadata: async (packageName) => ({
        dist: { integrity: integrityForBytes(npmTarballs.get(packageName)) },
      }),
      fetchReleaseAsset: async (name) => readFileSync(join(uploadDir, name)),
    });

    assert.deepEqual(verification.verified.map(({ name }) => name), [
      'fortemi-core-1.2.3.tgz',
      'fortemi-graph-1.2.3.tgz',
      'fortemi-react-1.2.3.tgz',
      'SHA256SUMS',
    ]);
    assert.equal(readFileSync(join(packDir, 'SHA256SUMS'), 'utf8'), readFileSync(join(uploadDir, 'SHA256SUMS'), 'utf8'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
