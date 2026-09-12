import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createChecksumManifest } from './checksum-manifest.mjs';

for (const platform of ['github', 'gitea']) {
  for (const scenario of ['new', 'identical', 'missing', 'package-mismatch', 'checksum-mismatch', 'duplicate', 'oversized', 'truncated', 'http-failure', 'read-error', 'wrong-tag', 'invalid-id', 'missing-local', ...(platform === 'gitea' ? ['foreign-origin'] : [])]) {
    test(`${platform}: immutable release assets ${scenario}`, () => {
      const root = mkdtempSync(join(tmpdir(), 'fortemi-immutable-release-'));
      try {
        const pack = join(root, 'pack');
        mkdirSync(pack);
        const assets = ['core', 'graph', 'react'].map(name => ({ name: `fortemi-${name}-1.2.3.tgz`, bytes: Buffer.from(`${name} package bytes`) }));
        for (const { name, bytes } of assets) if (scenario !== 'missing-local' || !name.includes('graph')) writeFileSync(join(pack, name), bytes);
        assets.push({ name: 'SHA256SUMS', bytes: Buffer.from(createChecksumManifest(assets)) });
        const existing = assets.map(({ name, bytes }, index) => ({ id: index + 1, name, size: bytes.length,
          browser_download_url: `https://api.example.test/download/${index + 1}`, payload: bytes.toString('base64') }));
        if (scenario === 'missing' || scenario === 'checksum-mismatch') existing.shift();
        if (scenario === 'package-mismatch') existing[1].payload = Buffer.from('x'.repeat(existing[1].size)).toString('base64');
        if (scenario === 'checksum-mismatch') existing.at(-1).payload = Buffer.from('x'.repeat(existing.at(-1).size)).toString('base64');
        if (scenario === 'duplicate') existing.push({ ...existing[0], id: 999 });
        if (scenario === 'oversized') existing[0].payload = Buffer.alloc(existing[0].size + 1).toString('base64');
        if (scenario === 'truncated') existing[0].payload = assets[0].bytes.subarray(0, -1).toString('base64');
        if (scenario === 'invalid-id') existing[0].id = 'not-an-id';
        if (scenario === 'foreign-origin') existing[0].browser_download_url = 'https://foreign.example.test/download/1';
        const state = join(root, 'state.json');
        const requestsFile = join(root, 'requests.json');
        writeFileSync(requestsFile, '[]');
        writeFileSync(state, JSON.stringify({ scenario, assets: scenario === 'new' ? [] : existing }));
        const result = spawnSync(process.execPath, ['--import', fileURLToPath(new URL('./fixtures/release-asset-fetch-mock.mjs', import.meta.url)), 'tools/release/create-repo-release.mjs'], {
          cwd: new URL('../..', import.meta.url), encoding: 'utf8', timeout: 5000, maxBuffer: 512 * 1024,
          env: { ...process.env, RELEASE_PLATFORM: platform, RELEASE_TAG: 'v1.2.3', RELEASE_TOKEN: 'test-token',
            RELEASE_API: 'https://api.example.test', RELEASE_REPO: 'Fortemi/fortemi-react', RELEASE_PACK_DIR: pack,
            TEST_RELEASE_STATE: state, TEST_RELEASE_REQUESTS: requestsFile },
        });
        assert.equal(result.error, undefined);
        const requests = JSON.parse(readFileSync(requestsFile));
        const mutations = requests.filter(r => r.method !== 'GET');
        assert.ok(!requests.some(r => r.method === 'DELETE' || r.method === 'PUT' || r.method === 'PATCH'), 'Published assets must never be deleted or replaced');
        if (['new', 'identical', 'missing'].includes(scenario)) {
          assert.equal(result.status, 0, result.stderr);
          const uploaded = mutations.filter(r => r.name).map(r => r.name);
          assert.deepEqual(uploaded, scenario === 'new' ? assets.map(a => a.name) : scenario === 'missing' ? [assets[0].name] : []);
          assert.equal(mutations.filter(r => !r.name).length, scenario === 'new' ? 1 : 0);
          assert.equal(readFileSync(join(pack, 'SHA256SUMS'), 'utf8'), assets.at(-1).bytes.toString());
        } else {
          assert.notEqual(result.status, 0, 'Unsafe publication must fail');
          assert.deepEqual(mutations, [], 'All conflicts and local inputs must be checked before any remote mutation');
          if (scenario === 'missing-local') assert.deepEqual(requests, []);
          if (scenario === 'foreign-origin') assert.equal(requests.length, 1, 'Do not send an authenticated request to a foreign download origin');
        }
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }
}
