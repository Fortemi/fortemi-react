#!/usr/bin/env node
// Create (or update) a repository Release on GitHub or Gitea and attach the
// packaged npm tarballs as release assets, so each repo carries the release
// packages alongside the npm publishes.
//
// Idempotent: re-running for an existing tag reuses the release and re-uploads
// assets (deleting any same-named asset first). Runs inside the publish job's
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
//   RELEASE_NOTES_DIR  dir holding <tag>.md release notes (default docs/releases)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES = ['core', 'graph', 'react'];

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
const notesPath = join(notesDir, `${tag}.md`);
const body = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : title;

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

async function deleteGithubAsset(assetId) {
  await fetch(`${api}/repos/${repo}/releases/assets/${assetId}`, { method: 'DELETE', headers: jsonHeaders });
}

async function deleteGiteaAsset(releaseId, assetId) {
  await fetch(`${api}/repos/${repo}/releases/${releaseId}/assets/${assetId}`, { method: 'DELETE', headers: jsonHeaders });
}

async function uploadGithubAsset(release, name, bytes) {
  const base = release.upload_url.split('{')[0];
  return readJson(await fetch(`${base}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/gzip' },
    body: bytes,
  }));
}

async function uploadGiteaAsset(releaseId, name, bytes) {
  const form = new FormData();
  form.append('attachment', new Blob([bytes], { type: 'application/gzip' }), name);
  return readJson(await fetch(`${api}/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { Authorization: authHeader },
    body: form,
  }));
}

async function main() {
  let release = await getReleaseByTag();
  if (release) {
    console.log(`Release ${tag} already exists on ${platform}; reusing and refreshing assets.`);
  } else {
    release = await createRelease();
    console.log(`Created ${platform} release ${tag}: ${release.html_url ?? '(no url)'}`);
  }

  const existing = new Map((release.assets ?? []).map((a) => [a.name, a.id]));

  for (const pkg of PACKAGES) {
    const name = `fortemi-${pkg}-${version}.tgz`;
    const file = join(packDir, name);
    if (!existsSync(file)) throw new Error(`missing packed tarball: ${file}`);
    const bytes = readFileSync(file);

    if (existing.has(name)) {
      if (platform === 'github') await deleteGithubAsset(existing.get(name));
      else await deleteGiteaAsset(release.id, existing.get(name));
    }

    if (platform === 'github') await uploadGithubAsset(release, name, bytes);
    else await uploadGiteaAsset(release.id, name, bytes);
    console.log(`  attached ${name} (${bytes.length} bytes)`);
  }

  console.log(`${platform} release ${tag} ready with ${PACKAGES.length} package assets.`);
}

main().catch((err) => {
  console.error(`create-repo-release failed: ${err.message}`);
  process.exit(1);
});
