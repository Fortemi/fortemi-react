#!/usr/bin/env node
// Create (or resume) a repository Release on GitHub or Gitea and attach the
// packaged npm tarballs as release assets, so each repo carries the release
// packages alongside the npm publishes.
//
// Idempotent: existing assets must match exactly and are never replaced.
// Only missing assets are uploaded. Runs inside the publish job's
// container using only Node built-ins (global fetch/FormData/Blob) — no gh CLI,
// no jq, no curl required.
//
// Env:
//   RELEASE_PLATFORM   "github" | "gitea"
//   RELEASE_TAG        e.g. v2026.6.3
//   RELEASE_TOKEN      token with repo "contents: write" (GITHUB_TOKEN / GT_PUBLISH_TOKEN)
//   RELEASE_API        API base — GitHub: https://api.github.com ; Gitea: <server>/api/v1
//   RELEASE_REPO       owner/repo
//   RELEASE_PACK_DIR   dir holding fortemi-<pkg>-<version>.tgz (default /tmp/fortemi-publish-check)
//   RELEASE_NOTES_DIR  dir holding <tag>.md release notes (default docs/releases,
//                      fallback docs/content/releases)

import { readFileSync, existsSync, lstatSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createChecksumManifest } from './checksum-manifest.mjs';

const PACKAGES = ['core', 'graph', 'react'];
const CHECKSUM_MANIFEST = 'SHA256SUMS';
const MAX_ASSET_BYTES = 32 * 1024 ** 2;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function env(name, required = true, fallback = '') {
  const v = process.env[name] ?? fallback;
  if (required && !v) {
    console.error(`create-repo-release: ${name} is required`);
    process.exit(1);
  }
  return v;
}

const platform = env('RELEASE_PLATFORM');
const tag = env('RELEASE_TAG');
const token = env('RELEASE_TOKEN');
const api = env('RELEASE_API').replace(/\/$/, '');
const repo = env('RELEASE_REPO');
const packDir = env('RELEASE_PACK_DIR', false, '/tmp/fortemi-publish-check');
const notesDir = env('RELEASE_NOTES_DIR', false, 'docs/releases');

if (platform !== 'github' && platform !== 'gitea') {
  console.error(`create-repo-release: RELEASE_PLATFORM must be github or gitea, got "${platform}"`);
  process.exit(1);
}

const version = tag.replace(/^v/, '');
const prerelease = version.includes('-');
const title = `fortemi-react ${tag}`;
const notesPath = [join(notesDir, `${tag}.md`), join('docs/content/releases', `${tag}.md`)]
  .find((candidate) => existsSync(candidate));
const body = notesPath ? readFileSync(notesPath, 'utf8') : title;

const authHeader = platform === 'github' ? `Bearer ${token}` : `token ${token}`;
const jsonHeaders = {
  Authorization: authHeader,
  Accept: 'application/json',
  ...(platform === 'github' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}),
};

async function readJson(res) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${text}`);
  return text ? JSON.parse(text) : {};
}

async function getReleaseByTag() {
  const res = await fetch(`${api}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: jsonHeaders,
  });
  if (res.status === 404) return null;
  return readJson(res);
}

async function createRelease() {
  const res = await fetch(`${api}/repos/${repo}/releases`, {
    method: 'POST',
    headers: { ...jsonHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name: title, body, draft: false, prerelease }),
  });
  return readJson(res);
}

async function verifyExistingAsset(asset, expected) {
  if (!Number.isSafeInteger(asset.id) || asset.id < 1) throw new Error('Invalid existing asset identity');
  const location = platform === 'github'
    ? new URL(`${api}/repos/${repo}/releases/assets/${asset.id}`)
    : new URL(asset.browser_download_url);
  if (location.protocol !== 'https:' || location.origin !== new URL(api).origin || location.username || location.password) {
    throw new Error('Existing asset must be downloaded through its HTTPS release authority');
  }
  const response = await fetch(location.href, {
    headers: { ...jsonHeaders, Accept: 'application/octet-stream' },
    signal: globalThis.AbortSignal.timeout(20000),
  });
  if (!response.ok || !response.body) throw new Error(`Existing asset ${asset.name}: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > expected.length) throw new Error(`Immutable asset ${asset.name} exceeds expected ${expected.length} bytes; refusing publication`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const actual = Buffer.concat(chunks, size);
  if (!actual.equals(expected)) {
    throw new Error(`Immutable asset ${asset.name} differs: expected ${expected.length} bytes sha256=${sha256(expected)}, received ${size} bytes sha256=${sha256(actual)}; use a new release version`);
  }
}

async function uploadGithubAsset(release, name, bytes, contentType) {
  const base = release.upload_url.split('{')[0];
  return readJson(await fetch(`${base}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': contentType },
    body: bytes,
  }));
}

async function uploadGiteaAsset(releaseId, name, bytes, contentType) {
  const form = new FormData();
  form.append('attachment', new Blob([bytes], { type: contentType }), name);
  return readJson(await fetch(`${api}/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { Authorization: authHeader },
    body: form,
  }));
}

async function main() {
  const assets = PACKAGES.map((pkg) => {
    const name = `fortemi-${pkg}-${version}.tgz`;
    const file = join(packDir, name);
    if (!existsSync(file)) throw new Error(`missing packed tarball: ${file}`);
    const info = lstatSync(file);
    if (!info.isFile() || info.size > MAX_ASSET_BYTES) throw new Error(`Expected regular packed tarball no larger than32MiB: ${name}`);
    const bytes = readFileSync(file);
    return { name, bytes, contentType: 'application/gzip' };
  });

  const manifest = createChecksumManifest(assets);
  writeFileSync(join(packDir, CHECKSUM_MANIFEST), manifest);
  assets.push({
    name: CHECKSUM_MANIFEST,
    bytes: Buffer.from(manifest, 'utf8'),
    contentType: 'text/plain; charset=utf-8',
  });

  let release = await getReleaseByTag();
  const existing = new Map();
  if (release) {
    if (release.tag_name !== tag) throw new Error('Existing release tag does not match');
    for (const asset of release.assets ?? []) {
      if (existing.has(asset.name)) throw new Error(`Duplicate existing release asset: ${asset.name}`);
      existing.set(asset.name, asset);
    }
    // Validate the complete existing set before any remote mutation, including partial releases.
    for (const { name, bytes } of assets) {
      if (existing.has(name)) await verifyExistingAsset(existing.get(name), bytes);
    }
    console.log(`Release ${tag} already exists on ${platform}; matching assets will be preserved.`);
  } else {
    release = await createRelease();
    console.log(`Created ${platform} release ${tag}: ${release.html_url ?? '(no url)'}`);
  }

  for (const { name, bytes, contentType } of assets) {
    if (existing.has(name)) {
      console.log(`  preserved ${name} (${bytes.length} verified bytes)`);
      continue;
    }

    if (platform === 'github') await uploadGithubAsset(release, name, bytes, contentType);
    else await uploadGiteaAsset(release.id, name, bytes, contentType);
    console.log(`  attached ${name} (${bytes.length} bytes)`);
  }

  console.log(`${platform} release ${tag} has ${assets.length} preserved or uploaded assets; publication readback remains required.`);
}

main().catch((err) => {
  console.error(`create-repo-release failed: ${err.message}`);
  process.exit(1);
});
