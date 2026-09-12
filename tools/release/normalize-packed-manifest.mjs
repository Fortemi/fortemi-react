#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';

const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const timestamp = new Date('1985-10-26T08:15:00.000Z');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function normalizeManifest(manifest) {
  const result = { ...manifest };
  for (const field of dependencyFields) {
    if (manifest[field] === undefined) continue;
    assert.ok(manifest[field] && typeof manifest[field] === 'object' && !Array.isArray(manifest[field]), `Invalid ${field}`);
    const entries = Object.entries(manifest[field]);
    for (const [, value] of entries) assert.equal(typeof value, 'string', `Invalid ${field} value`);
    result[field] = Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  }
  // Conditional exports and arrays are order-sensitive; never sort them recursively.
  return result;
}

export async function normalizePackedManifest(tarball, expectedVersion) {
  const file = resolve(tarball);
  const info = lstatSync(file);
  assert.ok(info.isFile() && info.size <= 32 * 1024 ** 2, 'Expected a regular tarball no larger than 32 MiB');
  const entries = new Map();
  let expanded = 0;
  tar.t({ file, sync: true, strict: true, onReadEntry(entry) {
    const parts = entry.path.split('/');
    const hasControl = [...entry.path].some(char => char.codePointAt(0) < 32 || char.codePointAt(0) === 127);
    assert.ok(parts[0] === 'package' && parts.length > 1 &&
      parts.every(p => p && p !== '.' && p !== '..') && !entry.path.includes('\\') && !hasControl, 'Unsafe package archive path');
    assert.equal(entry.type, 'File', 'Only regular packed files are accepted');
    assert.ok(!entries.has(entry.path), 'Duplicate archive entry');
    assert.ok([0o644, 0o755].includes(entry.mode & 0o7777), 'Unexpected packed file permissions');
    expanded += entry.size;
    assert.ok(entries.size < 10000 && expanded <= 128 * 1024 ** 2, 'Package expansion budget exceeded');
    if (entry.path === 'package/package.json') assert.ok(entry.size <= 1024 ** 2, 'Package manifest too large');
    entries.set(entry.path, entry.mode & 0o777);
  } });
  assert.ok(entries.has('package/package.json'), 'Missing package manifest');
  const temporary = mkdtempSync(resolve(dirname(file), '.fortemi-normalize-'));
  try {
    await tar.x({ file, cwd: temporary, strict: true, preserveOwner: false });
    const manifestPath = resolve(temporary, 'package/package.json');
    const original = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(original.version, expectedVersion, 'Packed version mismatch');
    assert.ok(['@fortemi/core', '@fortemi/graph', '@fortemi/react'].includes(original.name), 'Unexpected package name');
    const normalized = normalizeManifest(original);
    writeFileSync(manifestPath, JSON.stringify(normalized, null, 2));
    const files = [...entries.keys()].sort();
    for (const name of files) chmodSync(resolve(temporary, name), entries.get(name));
    const output = resolve(temporary, 'normalized.tgz');
    await tar.c({ file: output, cwd: temporary, strict: true, portable: true,
      noDirRecurse: true, mtime: timestamp, gzip: { level: 9 } }, files);
    const before = sha256(readFileSync(file));
    const after = sha256(readFileSync(output));
    renameSync(output, file);
    return { name: original.name, version: original.version, files: files.length, before, after };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tarball, version, ...extra] = process.argv.slice(2);
  assert.ok(tarball && version && !extra.length, 'Usage: normalize-packed-manifest.mjs <unpublished.tgz> <version>');
  console.log(JSON.stringify(await normalizePackedManifest(tarball, version)));
}
