import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as tar from 'tar';
import { normalizeManifest, normalizePackedManifest } from './normalize-packed-manifest.mjs';

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest = deps => ({ name: '@fortemi/react', version: '1.2.3', dependencies: deps,
  exports: { '.': { types: './dist/index.d.ts', node: './dist/index.js', default: './dist/browser.js' } },
  files: ['dist', 'README.md'], devDependencies: { z: '1', a: '2' },
  optionalDependencies: { z: '1', a: '2' }, peerDependencies: { z: '*', a: '*' } });

async function fixture(root, label, deps, order = ['package/package.json', 'package/dist/index.js']) {
  const cwd = join(root, label);
  mkdirSync(join(cwd, 'package/dist'), { recursive: true });
  writeFileSync(join(cwd, 'package/package.json'), JSON.stringify(manifest(deps), null, 2));
  chmodSync(join(cwd, 'package/package.json'), 0o644);
  writeFileSync(join(cwd, 'package/dist/index.js'), 'export const value = 42;\n');
  chmodSync(join(cwd, 'package/dist/index.js'), 0o755);
  const file = join(root, label + '.tgz');
  await tar.c({ cwd, file, gzip: true, portable: true, mtime: new Date(label === 'a' ? 0 : 10000) }, order);
  return file;
}

test('normalizes only dependency maps without changing values or conditional exports order', () => {
  const original = manifest({ z: '^1', a: 'npm:aliased@2' });
  const normalized = normalizeManifest(original);
  assert.deepEqual(normalized, original);
  assert.deepEqual(Object.keys(normalized.dependencies), ['a', 'z']);
  for (const field of ['devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.deepEqual(Object.keys(normalized[field]), ['a', 'z']);
  }
  assert.deepEqual(Object.keys(normalized.exports['.']), ['types', 'node', 'default']);
  assert.deepEqual(normalized.files, ['dist', 'README.md']);
  assert.deepEqual(Object.keys(original.dependencies), ['z', 'a']);
  for (const dependencies of [null, [], 'bad', { a: 5 }]) assert.throws(() => normalizeManifest({ dependencies }));
});

test('different dependency completion order and archive metadata produce identical repeatable tarballs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-pack-test-'));
  try {
    const a = await fixture(root, 'a', { '@fortemi/graph': '1.2.3', '@fortemi/core': '1.2.3' });
    const b = await fixture(root, 'b', { '@fortemi/core': '1.2.3', '@fortemi/graph': '1.2.3' },
      ['package/dist/index.js', 'package/package.json']);
    assert.notEqual(digest(a), digest(b));
    await normalizePackedManifest(a, '1.2.3');
    await normalizePackedManifest(b, '1.2.3');
    assert.equal(digest(a), digest(b));
    const once = digest(a);
    await normalizePackedManifest(a, '1.2.3');
    assert.equal(digest(a), once);
    const extracted = join(root, 'extracted');
    mkdirSync(extracted);
    await tar.x({ file: a, cwd: extracted });
    assert.equal(readFileSync(join(extracted, 'package/dist/index.js'), 'utf8'), 'export const value = 42;\n');
    const modes = [];
    await tar.t({ file: a, onReadEntry: e => modes.push([e.path, e.mode & 0o777]) });
    assert.deepEqual(modes, [['package/dist/index.js', 0o755], ['package/package.json', 0o644]]);
    assert.ok(!readdirSync(root).some(n => n.startsWith('.fortemi-normalize-')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid version, malformed manifests and non-regular entries leave input untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-pack-reject-'));
  try {
    const file = await fixture(root, 'a', { a: '1' });
    const before = digest(file);
    await assert.rejects(normalizePackedManifest(file, 'wrong'), /version mismatch/);
    assert.equal(digest(file), before);
    symlinkSync('index.js', join(root, 'a/package/dist/link.js'));
    const linkArchive = join(root, 'link.tgz');
    await tar.c({ cwd: join(root, 'a'), file: linkArchive, gzip: true }, ['package/dist/link.js']);
    const linkHash = digest(linkArchive);
    await assert.rejects(normalizePackedManifest(linkArchive, '1.2.3'), /regular packed files/);
    assert.equal(digest(linkArchive), linkHash);
    writeFileSync(join(root, 'a/package/package.json'), '{invalid');
    const invalid = join(root, 'invalid.tgz');
    await tar.c({ cwd: join(root, 'a'), file: invalid, gzip: true }, ['package/package.json']);
    const invalidHash = digest(invalid);
    await assert.rejects(normalizePackedManifest(invalid, '1.2.3'));
    assert.equal(digest(invalid), invalidHash);
    assert.ok(!readdirSync(root).some(n => n.startsWith('.fortemi-normalize-')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unsafe paths, duplicate files, oversized manifests and input symlinks are rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-pack-paths-'));
  try {
    const good = await fixture(root, 'a', { a: '1' });
    const cwd = join(root, 'a');
    for (const [label, options, files, message] of [
      ['traversal', { prefix: '../escape' }, ['package/package.json'], /Unsafe/],
      ['duplicate', {}, ['package/package.json', 'package/package.json'], /Duplicate/],
    ]) {
      const file = join(root, label + '.tgz');
      await tar.c({ cwd, file, gzip: true, ...options }, files);
      const before = digest(file);
      await assert.rejects(normalizePackedManifest(file, '1.2.3'), message);
      assert.equal(digest(file), before);
    }
    writeFileSync(join(cwd, 'package/package.json'), JSON.stringify({ ...manifest({ a: '1' }), description: 'x'.repeat(1024 ** 2) }));
    const large = join(root, 'large.tgz');
    await tar.c({ cwd, file: large, gzip: true }, ['package/package.json']);
    const before = digest(large);
    await assert.rejects(normalizePackedManifest(large, '1.2.3'), /manifest too large/);
    assert.equal(digest(large), before);
    const link = join(root, 'symlink.tgz');
    symlinkSync(good, link);
    await assert.rejects(normalizePackedManifest(link, '1.2.3'), /regular tarball/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pinned pnpm workspace pack converges repeatedly with local dependencies and no scripts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-pnpm-pack-'));
  const pnpm = process.env.PNPM_BINARY || 'pnpm';
  const options = { cwd: root, timeout: 10000, maxBuffer: 1024 ** 2,
    env: { ...process.env, npm_config_userconfig: '/dev/null', npm_config_globalconfig: '/dev/null' } };
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@fortemi/react', version: '1.2.3',
      packageManager: 'pnpm@10.6.5', files: ['index.js'], dependencies: {
        '@fortemi/core': 'workspace:*', '@fortemi/graph': 'workspace:*' } }));
    writeFileSync(join(root, 'index.js'), 'export const value = 42;\n');
    mkdirSync(join(root, 'node_modules/@fortemi'), { recursive: true });
    for (const name of ['core', 'graph']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'package.json'), JSON.stringify({ name: `@fortemi/${name}`, version: '1.2.3' }));
      symlinkSync(join(root, name), join(root, 'node_modules/@fortemi', name));
    }
    assert.equal(execFileSync(pnpm, ['--version'], options).toString().trim(), '10.6.5');
    const hashes = new Set();
    for (let pass = 0; pass < 8; pass++) {
      const output = join(root, `pack-${pass}`);
      mkdirSync(output);
      execFileSync(pnpm, ['pack', '--config.ignore-scripts=true', '--pack-destination', output], options);
      const file = join(output, 'fortemi-react-1.2.3.tgz');
      await normalizePackedManifest(file, '1.2.3');
      hashes.add(digest(file));
    }
    assert.equal(hashes.size, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
