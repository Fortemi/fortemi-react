import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyBrowserReport, verifyResourceEvents, verifyRuntime } from './e2e-runtime.mjs';

const observation = { memory: '8589934592\n', swap: '0\n', tasks: '256\n', cpu: '200000 100000\n',
  status: 'Name:\tnode\nCpus_allowed_list:\t0-31\n' };
const goodReport = () => ({ config: { projects: ['chromium', 'firefox', 'webkit'].map(name => ({ name })) },
  stats: { unexpected: 0, expected: 3, flaky: 0 }, errors: [], suites: [{ specs: [], suites: [{ specs: [{ tests:
    ['chromium', 'firefox', 'webkit'].map(projectName => ({ projectName, status: 'expected', results: [{ status: 'passed' }] }))
  }] }] }] });

test('resource events reject OOM, hard memory and task-limit events or missing observations', () => {
  const events = { memory: 'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\noom_group_kill 0\n', tasks: 'max 0\n' };
  assert.equal(verifyResourceEvents(events).tasks.max, 0);
  for (const name of ['max', 'oom', 'oom_kill']) {
    assert.throws(() => verifyResourceEvents({ ...events, memory: events.memory.replace(`${name} 0`, `${name} 1`) }));
  }
  for (const tasks of ['max 1', '', 'max 0\nmax 0', 'max NaN', 'max 9007199254740992']) {
    assert.throws(() => verifyResourceEvents({ ...events, tasks }));
  }
});

test('runtime verifies hard limits and restricts affinity to two already allowed CPUs', () => {
  for (const [allowed, expected] of [['0-31', '0,1'], ['4,8-10', '4,8'], ['7', '7'], ['0-999999999', '0,1']]) {
    assert.equal(verifyRuntime({ ...observation, status: `Cpus_allowed_list:\t${allowed}\n` }), expected);
  }
});

test('runtime rejects missing, unlimited, inconsistent and malformed bounds or affinity', () => {
  for (const field of ['memory', 'swap', 'tasks', 'cpu', 'status']) {
    assert.throws(() => verifyRuntime({ ...observation, [field]: '' }));
    assert.throws(() => verifyRuntime({ ...observation, [field]: 'max' }));
  }
  for (const cpu of ['400000 100000', '0 0', '200000 100000 1', '1.5 0.75']) {
    assert.throws(() => verifyRuntime({ ...observation, cpu }));
  }
  for (const allowed of ['2-1', '1,1', '2-4,3', '1,,2', '-1', '1-2-3', '9007199254740992']) {
    assert.throws(() => verifyRuntime({ ...observation, status: `Cpus_allowed_list:\t${allowed}\n` }));
  }
  assert.throws(() => verifyRuntime({ ...observation, swap: '1024' }));
});

test('browser report requires executed passing cases in all three projects and consistent totals', () => {
  assert.deepEqual(verifyBrowserReport(goodReport()), { chromium: 1, firefox: 1, webkit: 1 });
  for (const mutate of [
    r => { r.config.projects.pop(); }, r => { r.errors.push({ message: 'runner failed' }); },
    r => { r.stats.unexpected = 1; }, r => { r.stats.expected = 0; }, r => { r.suites = []; },
    r => { r.suites[0].suites[0].specs[0].tests.pop(); },
    r => { r.suites[0].suites[0].specs[0].tests[0].status = 'unexpected'; },
    r => { r.suites[0].suites[0].specs[0].tests[0].results = []; },
    r => { r.suites[0].suites[0].specs[0].tests[0].projectName = 'unknown'; },
  ]) {
    const report = goodReport();
    mutate(report);
    assert.throws(() => verifyBrowserReport(report));
  }
  const report = goodReport();
  report.suites[0].suites[0].specs[0].tests[0].status = 'flaky';
  report.stats.expected--; report.stats.flaky++;
  assert.deepEqual(verifyBrowserReport(report), { chromium: 1, firefox: 1, webkit: 1 });
});

// The fake daemon is the only docker executable on the test PATH. No Docker socket is used.
const docker = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const argv = process.argv.slice(2);
const root = process.env.FAKE_ROOT;
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(argv) + '\\n');
if (argv[0] !== '--host' || argv[1] !== 'unix:///var/run/docker.sock') process.exit(99);
const a = argv.slice(2);
const mode = process.env.FAKE_MODE;
const stateFile = path.join(root, 'state.json');
if (a[0] === 'info') process.exit(mode === 'daemon-unavailable' ? 1 : 0);
if (a[0] === 'image') {
  if (mode === 'missing-image') process.exit(1);
  console.log(mode === 'invalid-image' ? 'latest' : 'sha256:' + 'a'.repeat(64));
} else if (a[0] === 'run') {
  const owner = a[a.indexOf('--label') + 1].split('=')[1];
  fs.writeFileSync(stateFile, JSON.stringify({ owner, name: a[a.indexOf('--name') + 1] }));
  const mount = a.find(v => v.startsWith('type=bind,source=') && v.endsWith(',target=/results'));
  const output = mount.slice('type=bind,source='.length, -',target=/results'.length);
  if (mode !== 'missing-report') fs.writeFileSync(path.join(output, 'results.json'),
    mode === 'invalid-report' ? '{}' : fs.readFileSync(path.join(root, 'report.json')));
  process.exit(mode === 'browser-failure' ? 7 : 0);
} else if (a[0] === 'inspect') {
  if (mode === 'inspect-failure') process.exit(1);
  const state = JSON.parse(fs.readFileSync(stateFile));
  if (a.includes('--format')) console.log(mode === 'wrong-owner' ? 'someone-else' : state.owner);
  else console.log(JSON.stringify([state]));
} else if (a[0] === 'rm') {
  if (mode === 'remove-failure') process.exit(1);
  fs.unlinkSync(stateFile);
} else if (a[0] === 'ps') {
  if (mode === 'absence-query-failure') process.exit(1);
  if (fs.existsSync(stateFile) || mode === 'still-present') console.log('container-id');
} else process.exit(98);
`;

function fixture(t, { mode = '', corepack = false, missingTool = false, args = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-e2e-wrapper-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['tools/release', 'node_modules/@playwright/test', 'bin', 'cache']) mkdirSync(join(root, dir), { recursive: true });
  for (const name of ['test-e2e.sh', 'e2e-runtime.mjs']) copyFileSync(new URL(name, import.meta.url), join(root, 'tools/release', name));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.6.5' }));
  writeFileSync(join(root, 'node_modules/@playwright/test/package.json'), JSON.stringify({ version: '1.58.2' }));
  writeFileSync(join(root, 'report.json'), JSON.stringify(goodReport()));
  writeFileSync(join(root, 'bin/docker'), docker, { mode: 0o755 });
  const tool = join(root, 'native-pnpm');
  if (!missingTool) writeFileSync(tool, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  if (corepack && !missingTool) {
    mkdirSync(join(root, 'cache/v1/pnpm/10.6.5/bin'), { recursive: true });
    writeFileSync(join(root, 'cache/v1/pnpm/10.6.5/bin/pnpm.cjs'), '');
  }
  const result = spawnSync('bash', [join(root, 'tools/release/test-e2e.sh'), ...args], {
    timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8',
    env: { PATH: `${root}/bin:${process.env.PATH}`, HOME: root, COREPACK_HOME: join(root, 'cache'),
      FORTEMI_RELEASE_PNPM_BIN: corepack ? '' : tool, FAKE_ROOT: root, FAKE_MODE: mode },
  });
  assert.ifError(result.error);
  const calls = existsSync(join(root, 'calls.jsonl')) ? readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  const artifactsRoot = join(root, 'test-results');
  const artifacts = existsSync(artifactsRoot) ? join(artifactsRoot, readdirSync(artifactsRoot)[0]) : null;
  return { ...result, calls, artifacts, root };
}

test('wrapper enforces daemon-side bounds, offline immutable runtime, all browsers and owned cleanup', t => {
  const r = fixture(t);
  assert.equal(r.status, 0, r.stderr);
  const run = r.calls.find(a => a[2] === 'run');
  for (const flag of ['--pull=never', '--init', '--cpus=2', '--memory=8g', '--memory-swap=8g', '--pids-limit=256',
    '--network=none', '--ipc=private', '--shm-size=256m', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--log-driver=local', '--log-opt=max-size=1m', '--log-opt=max-file=1', '--log-opt=compress=false', 'COREPACK_ENABLE_NETWORK=0',
    'npm_config_offline=true', 'CUDA_VISIBLE_DEVICES=', 'NVIDIA_VISIBLE_DEVICES=void']) assert.ok(run.includes(flag), flag);
  assert.deepEqual(run.slice(run.indexOf('--entrypoint'), -1),
    ['--entrypoint', '/usr/bin/timeout', 'sha256:' + 'a'.repeat(64), '--signal=TERM', '--kill-after=10', '720', 'bash', '-lc']);
  assert.match(run.at(-1), /taskset --cpu-list "\$cpus" pnpm --filter @fortemi\/standalone exec playwright test/);
  assert.doesNotMatch(run.at(-1), /--project|--grep|--shard/);
  assert.ok(!run.some(a => /--privileged|--gpus|--ipc=host|--network=host|docker\.sock,/.test(a)));
  assert.ok(r.calls.some(a => a[2] === 'rm' && a.at(-1) === run[run.indexOf('--name') + 1]));
  assert.ok(existsSync(join(r.artifacts, 'container.json')));
  assert.ok(existsSync(join(r.artifacts, 'cleanup.txt')));
  assert.equal(JSON.parse(readFileSync(join(r.artifacts, 'acceptance.json'))).status, 'BROWSER_TESTS_PASS');
});

test('wrapper supports only the selected offline Corepack pnpm cache', t => {
  const r = fixture(t, { corepack: true });
  assert.equal(r.status, 0, r.stderr);
  const run = r.calls.find(a => a[2] === 'run');
  assert.ok(run.includes(`type=bind,source=${r.root}/cache/v1/pnpm/10.6.5,target=/opt/fortemi/pnpm-cache,readonly`));
});

for (const mode of ['browser-failure', 'missing-report', 'invalid-report', 'remove-failure', 'absence-query-failure', 'still-present']) {
  test(`wrapper fails closed and attempts owned cleanup on ${mode}`, t => {
    const r = fixture(t, { mode });
    assert.notEqual(r.status, 0);
    if (mode === 'browser-failure') assert.equal(r.status, 7);
    assert.ok(r.calls.some(a => a[2] === 'rm'));
    if (['remove-failure', 'absence-query-failure', 'still-present'].includes(mode)) assert.ok(!existsSync(join(r.artifacts, 'cleanup.txt')));
  });
}

for (const mode of ['wrong-owner', 'inspect-failure']) {
  test(`wrapper preserves resources when ownership is not established: ${mode}`, t => {
    const r = fixture(t, { mode });
    assert.notEqual(r.status, 0);
    assert.ok(!r.calls.some(a => a[2] === 'rm'));
  });
}

for (const options of [{ mode: 'missing-image' }, { mode: 'invalid-image' }, { mode: 'daemon-unavailable' },
  { missingTool: true }, { missingTool: true, corepack: true }, { args: ['--project=chromium'] }]) {
  test(`wrapper preflight refuses unavailable prerequisites or arguments: ${JSON.stringify(options)}`, t => {
    const r = fixture(t, options);
    assert.notEqual(r.status, 0);
    assert.ok(!r.calls.some(a => a[2] === 'run'));
  });
}
