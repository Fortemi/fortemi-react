#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGES = [
  { packageName: '@fortemi/core', assetName: 'fortemi-core' },
  { packageName: '@fortemi/graph', assetName: 'fortemi-graph' },
  { packageName: '@fortemi/react', assetName: 'fortemi-react' },
];

const MANIFEST_NAME = 'SHA256SUMS';

export function integrityForBytes(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function sha256ForBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function parseChecksumManifest(text) {
  const checksums = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const match = line.match(/^([a-fA-F0-9]{3,}) {2}([^\r\n]+)$/);
    if (!match) throw new Error(`invalid checksum manifest line: ${line}`);
    checksums.set(match[2], match[1].toLowerCase());
  }
  return checksums;
}

export function buildArtifactVerificationPlan({
  version,
  packDir,
  registry,
  releasePlatform,
  releaseApi,
  releaseRepo,
  releaseTag,
  releaseToken = '',
}) {
  if (!version) throw new Error('version is required');
  if (!packDir) throw new Error('packDir is required');
  if (!registry) throw new Error('registry is required');
  if (!releasePlatform) throw new Error('releasePlatform is required');
  if (!releaseApi) throw new Error('releaseApi is required');
  if (!releaseRepo) throw new Error('releaseRepo is required');
  if (!releaseTag) throw new Error('releaseTag is required');

  return {
    version,
    packDir,
    registry,
    releasePlatform,
    releaseApi: releaseApi.replace(/\/$/, ''),
    releaseRepo,
    releaseTag,
    releaseToken,
    packages: PACKAGES.map(({ packageName, assetName }) => ({
      packageName,
      name: `${assetName}-${version}.tgz`,
      path: join(packDir, `${assetName}-${version}.tgz`),
    })),
    checksumManifest: {
      name: MANIFEST_NAME,
      path: join(packDir, MANIFEST_NAME),
    },
  };
}

async function defaultFetchNpmMetadata(packageName, version, registry) {
  const output = execFileSync(
    'npm',
    ['view', `${packageName}@${version}`, '--json', '--registry', registry, '--prefer-online', '--no-update-notifier'],
    { encoding: 'utf8' },
  );
  return JSON.parse(output);
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function defaultFetchReleaseAsset(plan, name) {
  const authHeader = plan.releasePlatform === 'github'
    ? `Bearer ${plan.releaseToken}`
    : `token ${plan.releaseToken}`;
  const headers = {
    Accept: 'application/json',
    ...(plan.releaseToken ? { Authorization: authHeader } : {}),
    ...(plan.releasePlatform === 'github' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}),
  };
  const release = await fetchJson(
    `${plan.releaseApi}/repos/${plan.releaseRepo}/releases/tags/${encodeURIComponent(plan.releaseTag)}`,
    headers,
  );
  const asset = (release.assets ?? []).find((candidate) => candidate.name === name);
  if (!asset) throw new Error(`release asset ${name} is missing from ${plan.releaseTag}`);

  const assetUrl = plan.releasePlatform === 'github'
    ? asset.url
    : asset.browser_download_url;
  const assetHeaders = plan.releasePlatform === 'github'
    ? { ...headers, Accept: 'application/octet-stream' }
    : headers;
  const res = await fetch(assetUrl, { headers: assetHeaders });
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} while downloading release asset ${name}`);
  return bytes;
}

export async function verifyLocalArtifacts(plan, {
  fetchNpmMetadata = (packageName) => defaultFetchNpmMetadata(packageName, plan.version, plan.registry),
  fetchReleaseAsset = (name) => defaultFetchReleaseAsset(plan, name),
} = {}) {
  const manifestText = readFileSync(plan.checksumManifest.path, 'utf8');
  const manifest = parseChecksumManifest(manifestText);
  const verified = [];

  for (const artifact of plan.packages) {
    if (!existsSync(artifact.path)) throw new Error(`missing local packed tarball: ${artifact.path}`);
    const localBytes = readFileSync(artifact.path);
    const localSha256 = sha256ForBytes(localBytes);
    const manifestSha256 = manifest.get(artifact.name);
    if (manifestSha256 !== localSha256) {
      throw new Error(`${artifact.name} SHA256SUMS entry ${manifestSha256 ?? '(missing)'} does not match local ${localSha256}`);
    }

    const npmMetadata = await fetchNpmMetadata(artifact.packageName);
    const registryIntegrity = npmMetadata?.dist?.integrity;
    const localIntegrity = integrityForBytes(localBytes);
    if (registryIntegrity !== localIntegrity) {
      throw new Error(`${artifact.packageName}@${plan.version} dist.integrity ${registryIntegrity ?? '(missing)'} does not match local ${localIntegrity}`);
    }

    const releaseBytes = await fetchReleaseAsset(artifact.name);
    const releaseSha256 = sha256ForBytes(releaseBytes);
    if (releaseSha256 !== localSha256) {
      throw new Error(`release asset ${artifact.name} sha256 ${releaseSha256} does not match local ${localSha256}`);
    }
    verified.push({ name: artifact.name, sha256: localSha256, integrity: localIntegrity });
  }

  const manifestAssetBytes = await fetchReleaseAsset(plan.checksumManifest.name);
  const manifestAssetSha256 = sha256ForBytes(manifestAssetBytes);
  const localManifestSha256 = sha256ForBytes(Buffer.from(manifestText));
  if (manifestAssetSha256 !== localManifestSha256) {
    throw new Error(`release asset ${plan.checksumManifest.name} sha256 ${manifestAssetSha256} does not match local ${localManifestSha256}`);
  }
  verified.push({ name: plan.checksumManifest.name, sha256: localManifestSha256 });

  return { verified };
}

function env(name, required = true, fallback = '') {
  const value = process.env[name] ?? fallback;
  if (required && !value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const releaseTag = env('RELEASE_TAG');
  const version = env('RELEASE_VERSION', false, releaseTag.replace(/^v/, ''));
  const plan = buildArtifactVerificationPlan({
    version,
    packDir: env('RELEASE_PACK_DIR', false, '/tmp/fortemi-publish-check'),
    registry: env('NPM_REGISTRY', false, 'https://registry.npmjs.org'),
    releasePlatform: env('RELEASE_PLATFORM'),
    releaseApi: env('RELEASE_API'),
    releaseRepo: env('RELEASE_REPO'),
    releaseTag,
    releaseToken: env('RELEASE_TOKEN', false, ''),
  });

  const result = await verifyLocalArtifacts(plan);
  for (const artifact of result.verified) {
    const suffix = artifact.integrity ? ` ${artifact.integrity}` : '';
    console.log(`verified ${artifact.name} sha256:${artifact.sha256}${suffix}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`verify-published-artifacts failed: ${err.message}`);
    process.exit(1);
  });
}
