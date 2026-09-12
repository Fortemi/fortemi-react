#!/usr/bin/env node

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const workflowPaths = [
  '.gitea/workflows/publish.yml',
  '.github/workflows/npm-publish.yml',
];

function extractRunBlock(workflow, stepName) {
  const marker = `- name: ${stepName}`;
  const stepStart = workflow.indexOf(marker);
  assert.notEqual(stepStart, -1, `missing workflow step: ${stepName}`);
  const runStart = workflow.indexOf('        run: |', stepStart);
  assert.notEqual(runStart, -1, `missing run block for workflow step: ${stepName}`);
  const blockStart = workflow.indexOf('\n', runStart) + 1;
  const nextStep = workflow.indexOf('\n      - name:', blockStart);
  const raw = workflow.slice(blockStart, nextStep === -1 ? workflow.length : nextStep);
  return raw
    .split('\n')
    .filter((line) => line.match(/^ {10}/) || line.trim() === '')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
}

function writePackage(root, dir, name) {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name, version: '1.2.3' }));
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function runPublishStepInFreshEnvironment(workflowPath) {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-publish-step-'));
  try {
    const bin = join(root, 'bin');
    const packDir = join(root, 'pack');
    mkdirSync(bin);
    mkdirSync(packDir);
    writePackage(root, 'packages/core', '@fortemi/core');
    writePackage(root, 'packages/graph', '@fortemi/graph');
    writePackage(root, 'packages/react', '@fortemi/react');
    for (const name of ['core', 'graph', 'react']) {
      writeFileSync(join(packDir, `fortemi-${name}-1.2.3.tgz`), `${name} tarball`);
    }

    writeExecutable(join(bin, 'npm'), [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [ "${1:-}" = "--version" ]; then echo "11.12.1"; exit 0; fi',
      'if [ "${1:-}" = "view" ]; then',
      '  state="$FORTEMI_STUB_STATE/${2//\\//_}"',
      '  if [ ! -f "$state" ]; then touch "$state"; exit 1; fi',
      '  echo "1.2.3"; exit 0',
      'fi',
      'if [ "${1:-}" = "publish" ]; then printf "%s\n" "$2" >> "$FORTEMI_PUBLISHED_PATHS"; exit 0; fi',
      'if [ "${1:-}" = "dist-tag" ]; then exit 0; fi',
      'echo "unexpected npm invocation: $*" >&2',
      'exit 64',
      '',
    ].join('\n'));
    writeExecutable(join(bin, 'pnpm'), [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [ "${1:-}" = "--version" ]; then echo "10.6.5"; exit 0; fi',
      'echo "unexpected pnpm invocation: $*" >&2',
      'exit 64',
      '',
    ].join('\n'));
    writeExecutable(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');

    const env = {
      PATH: `${bin}:${process.env.PATH}`,
      RELEASE_TAG: 'v1.2.3',
      RELEASE_PACK_DIR: packDir,
      FORTEMI_PUBLISHED_PATHS: join(root, 'published.txt'),
      FORTEMI_STUB_STATE: join(root, 'registry-state'),
      GITHUB_REPOSITORY: 'Fortemi/fortemi-react',
      GITHUB_REPOSITORY_OWNER: 'Fortemi',
      GITHUB_WORKFLOW_REF: `${workflowPath}@refs/tags/v1.2.3`,
      GITHUB_REF: 'refs/tags/v1.2.3',
      GITHUB_SERVER_URL: 'https://git.integrolabs.net',
      GT_PUBLISH_TOKEN: 'stub-token',
      HOME: join(root, 'home'),
    };
    mkdirSync(env.HOME);
    mkdirSync(env.FORTEMI_STUB_STATE);

    const stepName = workflowPath.includes('.github/')
      ? 'Publish packages to npmjs.org (OIDC trusted publishing + provenance)'
      : 'Publish packages to Gitea registry';
    const script = extractRunBlock(readFileSync(workflowPath, 'utf8'), stepName);
    const result = spawnSync('bash', ['-c', script], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    return {
      ...result,
      publishedPaths: result.status === 0
        ? readFileSync(env.FORTEMI_PUBLISHED_PATHS, 'utf8').trim().split('\n')
        : [],
      packDir,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('publish workflows publish the exact packed tarballs', () => {
  for (const workflowPath of workflowPaths) {
    const workflow = readFileSync(workflowPath, 'utf8');
    const pack = extractRunBlock(workflow, 'Pack and inspect artifacts');
    const normalize = pack.indexOf('node tools/release/normalize-packed-manifest.mjs "$artifact" "$TAG_VERSION"');
    assert.ok(normalize > pack.indexOf('(cd packages/react && pnpm pack'), `${workflowPath}: normalize only after pack`);
    assert.ok(normalize < pack.indexOf('tar -tzf "$CORE_TGZ"'), `${workflowPath}: normalize before inspection/checksums/publication`);
    assert.match(pack, /for artifact in "\$CORE_TGZ" "\$GRAPH_TGZ" "\$REACT_TGZ"; do/);
    assert.doesNotMatch(
      workflow,
      /\(cd "\$package_dir" && pnpm publish\b/,
      `${workflowPath} must not re-pack from package directories during publish`,
    );
    assert.match(
      workflow,
      /PACKAGE_TGZ="\$PACK_DIR\/fortemi-\$\{package_name##\*\/\}-\$\{package_version\}\.tgz"/,
      `${workflowPath} must resolve the already inspected tarball for each package`,
    );
    assert.match(
      workflow,
      /npm publish "\$PACKAGE_TGZ"/,
      `${workflowPath} must publish the existing packed tarball`,
    );
    assert.match(
      workflow,
      /node tools\/release\/verify-published-artifacts\.mjs/,
      `${workflowPath} must verify registry and release attachment digests`,
    );
  }
});

test('publish workflow publish steps run against existing tarballs in a fresh step environment', () => {
  for (const workflowPath of workflowPaths) {
    const result = runPublishStepInFreshEnvironment(workflowPath);
    assert.equal(
      result.status,
      0,
      `${workflowPath} publish step failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.deepEqual(result.publishedPaths, ['core', 'graph', 'react'].map(
      (name) => join(result.packDir, `fortemi-${name}-1.2.3.tgz`),
    ));
  }
});
