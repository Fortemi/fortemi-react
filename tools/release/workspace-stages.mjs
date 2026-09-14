import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportCases } from '../../packages/core/scripts/ci-unit-partitions.mjs';

export const stages = Object.freeze(['core-1', 'core-2', 'core-3', 'core-merge', 'consumers']);
export const stageDeadlineMs = 825000;
const repo = resolve(import.meta.dirname, '../..');
const evidence = 'test-results/local-workspace';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = values => [...values].sort();
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
function bytes(path) {
  assert.ok(statSync(path).isFile() && statSync(path).size <= 16 * 1024 * 1024, 'Invalid or oversized evidence file');
  return readFileSync(path);
}
const json = path => JSON.parse(bytes(path));

export function projectPath(root, path) {
  const local = relative(root, path).replaceAll('\\', '/');
  assert.ok(local && !local.startsWith('.') && !local.startsWith('/') && !local.includes('/../'), 'Project outside workspace');
  return local;
}

export function verifyConsumer(report, project) {
  const cases = reportCases(report, project.root);
  assert.deepEqual(sorted(Object.keys(cases)), project.files, 'Consumer discovery/report mismatch');
  return cases;
}

export function coreArtifacts(stage) {
  assert.ok(stages.slice(0, 4).includes(stage));
  return stage === 'core-merge'
    ? ['packages/core/test-results/core-unit.json', 'packages/core/test-results/core-unit-completeness.json', 'packages/core/coverage/coverage-summary.json']
    : ['blob.json', 'progress.json', 'receipt.json', 'report.json'].map(name => 'packages/core/test-results/core-shards/' + stage.slice(-1) + '/' + name);
}

function coreCommand(stage) {
  return ['packages/core/scripts/ci-unit-partitions.mjs', ...(stage === 'core-merge' ? ['merge'] : ['run', stage.slice(-1)])];
}

export function verifyStageReceipts(receipts, identity) {
  assert.deepEqual(receipts.map(r => r.stage), stages, 'Missing, duplicate or reordered stages');
  for (const receipt of receipts) {
    assert.deepEqual(receipt.identity, identity, 'Stage source/runtime mismatch');
    assert.equal(receipt.status, 'PASS', 'Stage did not pass');
    assert.ok(receipt.commands.length > 0 && receipt.commands.every(c => c.exit === 0 && !c.signal && !c.error), 'Missing, interrupted or failed commands');
    assert.ok(Object.keys(receipt.artifacts).length > 0, 'Missing stage artifacts');
    if (receipt.stage.startsWith('core-')) {
      assert.deepEqual(receipt.commands.map(c => [c.command, ...c.args]), [[process.execPath, ...coreCommand(receipt.stage)]], 'Changed Core command');
      assert.deepEqual(sorted(Object.keys(receipt.artifacts)), sorted(coreArtifacts(receipt.stage)), 'Missing native Core artifacts');
    } else assert.ok(receipt.commands.every(c => c.command === 'pnpm'), 'Changed consumer command');
  }
}

export function consumerCommands(projects) {
  assert.deepEqual(projects.slice(0, 2).map(p => p.path), ['packages/graph', 'packages/react']);
  assert.equal(new Set(projects.map(p => p.path)).size, projects.length);
  assert.ok(projects.slice(2).every(p => p.path.startsWith('examples/')));
  const build = path => ['--dir', path, 'build'];
  const commands = [build('packages/core')];
  for (const [i, project] of projects.entries()) {
    commands.push(['--dir', project.path, 'test', '--maxWorkers=2', '--reporter=json',
      '--outputFile=' + join(evidence, 'consumers', i + '.json')]);
    if (i === 0) commands.push(build('packages/graph'));
  }
  return commands;
}

export async function execute(stage, { root = repo } = {}) {
  assert.ok([...stages, 'verify'].includes(stage), 'Expected core-1, core-2, core-3, core-merge, consumers or verify');
  root = resolve(root);
  const output = join(root, evidence), started = Date.now(), commands = [];
  const env = { ...process.env, VITEST_MAX_WORKERS: '2', npm_config_workspace_concurrency: '1', COREPACK_ENABLE_NETWORK: '0' };
  function capture(command, args, cwd = root) {
    const remaining = stageDeadlineMs - (Date.now() - started);
    assert.ok(remaining > 0, 'Stage deadline exceeded');
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: Math.min(30000, remaining), maxBuffer: 4 * 1024 * 1024 });
    assert.ifError(result.error); assert.equal(result.status, 0, 'Workspace discovery/identity command failed');
    return result.stdout.trim();
  }
  function identity() {
    assert.equal(capture('git', ['status', '--porcelain', '--untracked-files=all']), '', 'Use a clean committed owned worktree');
    const requireCore = createRequire(join(root, 'packages/core/package.json'));
    const vitest = requireCore.resolve('vitest/package.json');
    const requireVitest = createRequire(vitest);
    const runner = requireVitest.resolve('@vitest/runner/package.json');
    const pnpm = capture('pnpm', ['--version']);
    assert.equal(json(join(root, 'package.json')).packageManager, 'pnpm@' + pnpm, 'Use the pinned package manager');
    return { schema: 1, source: capture('git', ['rev-parse', 'HEAD']), root, node: process.versions.node,
      pnpm, vitest: json(vitest).version,
      lockSha256: digest(bytes(join(root, 'pnpm-lock.yaml'))),
      configSha256: digest(bytes(join(root, 'packages/core/vitest.config.ts'))),
      runnerSha256: digest(bytes(join(dirname(runner), 'dist/chunk-artifact.js'))) };
  }
  function discover(path) {
    const cwd = join(root, path);
    assert.equal(json(join(cwd, 'package.json')).scripts.test, 'vitest run', 'Review non-Vitest consumer test scripts explicitly');
    const requireProject = createRequire(join(cwd, 'package.json'));
    const vitestPackage = requireProject.resolve('vitest/package.json');
    const cli = join(dirname(vitestPackage), 'vitest.mjs');
    const files = JSON.parse(capture(process.execPath, [cli, 'list', '--filesOnly', '--json'], cwd))
      .map(row => projectPath(cwd, row.file)).sort();
    assert.ok(files.length > 0 && new Set(files).size === files.length, 'Empty or duplicate discovery');
    return { path, root: cwd, files, vitest: json(vitestPackage).version };
  }
  function consumers() {
    const rows = JSON.parse(capture('pnpm', ['-r', '--filter', './examples/**', 'list', '--depth', '-1', '--json']));
    assert.ok(Array.isArray(rows));
    const examples = rows.map(row => projectPath(root, row.path)).sort();
    assert.ok(examples.every(path => path.startsWith('examples/')));
    assert.equal(new Set(examples).size, examples.length);
    const tested = examples.filter(path => Object.hasOwn(json(join(root, path, 'package.json')).scripts ?? {}, 'test'));
    return { projects: ['packages/graph', 'packages/react', ...tested].map(discover), examples };
  }
  const current = identity();
  if (stage === 'core-1') {
    assert.ok(!existsSync(join(root, 'packages/core/test-results')), 'Existing Core evidence belongs to another run');
    mkdirSync(output, { recursive: true });
    assert.deepEqual(readdirSync(output), [], 'Existing workspace evidence belongs to another run');
    save(join(output, 'run.json'), { identity: current, consumers: consumers() });
  }
  const plan = json(join(output, 'run.json'));
  assert.deepEqual(current, plan.identity, 'Workspace source/runtime changed');
  const index = stage === 'verify' ? stages.length : stages.indexOf(stage);
  const previous = stages.slice(0, index);
  assert.deepEqual(sorted(readdirSync(output)), sorted(['run.json', ...previous]), 'Missing, duplicate or unexpected stage');
  for (const name of previous) {
    const receipt = json(join(output, name, 'receipt.json'));
    assert.equal(receipt.stage, name); assert.equal(receipt.status, 'PASS');
    assert.deepEqual(receipt.identity, current);
    for (const [path, expected] of Object.entries(receipt.artifacts)) {
      assert.equal(projectPath(root, resolve(root, path)), path);
      assert.equal(digest(bytes(join(root, path))), expected, 'Prior stage artifact changed');
    }
  }
  if (stage === 'verify') {
    const receipts = stages.map(name => json(join(output, name, 'receipt.json')));
    verifyStageReceipts(receipts, current);
    assert.deepEqual(consumers(), plan.consumers, 'Consumer inventory changed');
    const core = json(join(root, 'packages/core/test-results/core-unit-completeness.json'));
    assert.equal(core.status, 'PASS'); assert.equal(core.identity.source, current.source);
    assert.equal(core.identity.lockSha256, current.lockSha256); assert.equal(core.identity.configSha256, current.configSha256);
    assert.equal(core.identity.root, join(root, 'packages/core')); assert.equal(core.identity.node, current.node);
    assert.equal(core.identity.vitest, current.vitest);
    assert.ok(core.coverage.statements.total > 0 && core.coverage.statements.pct >= 79, 'Global coverage gate did not pass');
    const consumer = receipts.at(-1);
    assert.deepEqual(sorted(Object.keys(consumer.artifacts)), sorted(plan.consumers.projects.map((_, i) => join(evidence, 'consumers', i + '.json'))), 'Missing consumer report binding');
    assert.deepEqual(consumer.commands.map(c => c.args), consumerCommands(plan.consumers.projects).map(args => args.map(a => a.startsWith('--outputFile=') ? '--outputFile=' + join(root, a.slice(13)) : a)));
    const results = plan.consumers.projects.map((project, i) => ({ project: project.path,
      cases: verifyConsumer(json(join(output, 'consumers', i + '.json')), project) }));
    assert.deepEqual(identity(), current);
    assert.ok(Date.now() - started < stageDeadlineMs, 'Stage deadline exceeded');
    const receipt = { status: 'PASS', identity: current, core, consumers: results,
      stages: receipts.map(r => ({ stage: r.stage, receiptSha256: digest(bytes(join(output, r.stage, 'receipt.json'))) })) };
    save(join(output, 'complete.json'), receipt);
    console.log(JSON.stringify({ status: 'PASS', coreFiles: core.files, coreTests: core.tests, consumerProjects: results.length }));
    return receipt;
  }
  mkdirSync(join(output, stage));
  const fd = openSync(join(output, stage, 'execution.log'), 'wx');
  function run(command, args) {
    const remaining = stageDeadlineMs - (Date.now() - started);
    assert.ok(remaining > 0, 'Stage deadline exceeded');
    const result = spawnSync(command, args, { cwd: root, env, timeout: remaining, stdio: ['ignore', fd, fd] });
    commands.push({ command, args, exit: result.status, signal: result.signal, error: result.error?.code });
    assert.ifError(result.error); assert.equal(result.status, 0, 'Workspace stage failed; inspect retained execution.log');
  }
  const paths = [];
  try {
    if (stage.startsWith('core-')) {
      run(process.execPath, coreCommand(stage));
      paths.push(...coreArtifacts(stage));
    } else {
      assert.deepEqual(consumers(), plan.consumers);
      for (const args of consumerCommands(plan.consumers.projects)) {
        run('pnpm', args.map(a => a.startsWith('--outputFile=') ? '--outputFile=' + join(root, a.slice(13)) : a));
      }
      for (const [i, project] of plan.consumers.projects.entries()) {
        const path = join(evidence, stage, i + '.json');
        verifyConsumer(json(join(root, path)), project); paths.push(path);
      }
    }
    assert.deepEqual(identity(), current);
    assert.ok(Date.now() - started < stageDeadlineMs, 'Stage deadline exceeded');
    save(join(output, stage, 'receipt.json'), { stage, identity: current, status: 'PASS', commands,
      elapsedMs: Date.now() - started, artifacts: Object.fromEntries(paths.map(p => [p, digest(bytes(join(root, p)))])) });
  } catch (error) {
    save(join(output, stage, 'failure.json'), { stage, status: 'NOT_PASS', identity: current, commands, elapsedMs: Date.now() - started, error: error.message });
    throw error;
  } finally { closeSync(fd); }
  console.log(JSON.stringify({ stage, status: 'PASS' }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Exactly one workspace stage is required');
  await execute(process.argv[2]);
}
