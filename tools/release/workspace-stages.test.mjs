import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';
import { consumerCommands, coreArtifacts, execute, projectPath, stageDeadlineMs, stages, verifyConsumer, verifyStageReceipts } from './workspace-stages.mjs';

const repo = resolve(import.meta.dirname, '../..');
const identity = { source: 'committed-source', lockSha256: 'lock', node: '24', root: '/owned' };
const receipts = () => stages.map(stage => ({ stage, identity: structuredClone(identity), status: 'PASS',
  commands: [{ exit: 0, command: stage === 'consumers' ? 'pnpm' : process.execPath,
    args: stage === 'consumers' ? [] : ['packages/core/scripts/ci-unit-partitions.mjs', ...(stage === 'core-merge' ? ['merge'] : ['run', stage.slice(-1)])] }],
  artifacts: Object.fromEntries((stage === 'consumers' ? ['report'] : coreArtifacts(stage)).map(path => [path, 'hash'])) }));

test('release configuration requires the complete staged route before build and E2E', () => {
  const config = yaml.load(readFileSync(join(repo, '.aiwg/release.config'), 'utf8'));
  const steps = config.gates.find(gate => gate.name === 'local-build-test').steps;
  const commands = [...stages, 'verify'].map(stage => 'node tools/release/workspace-stages.mjs ' + stage);
  assert.deepEqual(steps.map(step => step.run), ['pnpm typecheck', 'pnpm lint', ...commands, 'pnpm build', 'tools/release/test-e2e.sh']);
  assert.equal(new Set(steps.map(step => step.id)).size, steps.length);
  assert.ok(steps.every(step => step.expect_exit === 0));
  assert.equal(stageDeadlineMs, 825000);
  assert.equal(config.gates.find(gate => gate.name === 'ci-green').hard_stop, true);
  assert.equal(config.version_policy.channels.stable.require_uat, true);
  assert.equal(JSON.parse(readFileSync(join(repo, 'package.json'))).scripts['test:workspace'],
    "pnpm test:core && pnpm --filter @fortemi/core build && pnpm --filter @fortemi/graph test && pnpm --filter @fortemi/graph build && pnpm --filter @fortemi/react test && pnpm -r --filter './examples/**' --if-present test");
});

test('complete stage receipts require matching identities and passing commands', () => {
  assert.doesNotThrow(() => verifyStageReceipts(receipts(), identity));
});
for (const [name, mutate] of [
  ['missing stage', rows => rows.pop()],
  ['duplicate stage', rows => rows.push(rows[0])],
  ['reordered stage', rows => rows.reverse()],
  ['changed source', rows => { rows[1].identity.source = 'other'; }],
  ['changed runtime', rows => { rows[1].identity.node = '22'; }],
  ['changed lock', rows => { rows[1].identity.lockSha256 = 'other'; }],
  ['failed stage', rows => { rows[1].status = 'NOT_PASS'; }],
  ['failed command', rows => { rows[1].commands[0].exit = 1; }],
  ['unexecuted stage', rows => { rows[1].commands = []; }],
  ['missing artifacts', rows => { rows[1].artifacts = {}; }],
  ['missing native report', rows => { delete rows[0].artifacts[coreArtifacts('core-1')[0]]; }],
  ['changed Core command', rows => { rows[0].commands[0].args = ['unrelated.mjs']; }],
  ['interrupted command', rows => { rows[0].commands[0].signal = 'SIGTERM'; }],
  ['changed consumer executable', rows => { rows.at(-1).commands[0].command = 'true'; }],
]) test('rejects ' + name, () => {
  const rows = receipts(); mutate(rows);
  assert.throws(() => verifyStageReceipts(rows, identity));
});

test('consumer commands keep dependency builds and every declared example', () => {
  const projects = ['packages/graph', 'packages/react', 'examples/first', 'examples/second'].map(path => ({ path }));
  const commands = consumerCommands(projects);
  assert.deepEqual(commands.map(args => [args[1], args[2]]), [
    ['packages/core', 'build'], ['packages/graph', 'test'], ['packages/graph', 'build'],
    ['packages/react', 'test'], ['examples/first', 'test'], ['examples/second', 'test'],
  ]);
  assert.ok(commands.filter(args => args[2] === 'test').every(args => args.includes('--maxWorkers=2') && args.includes('--reporter=json')));
  assert.throws(() => consumerCommands(projects.slice(1)));
  assert.throws(() => consumerCommands([...projects, projects[2]]));
  assert.throws(() => consumerCommands([...projects, { path: 'apps/unexpected' }]));
});

const project = { root: '/owned/graph', files: ['a.test.mjs', 'b.test.mjs'] };
function report() {
  return { success: true, numFailedTests: 0, numFailedTestSuites: 0, numTotalTests: 2,
    testResults: project.files.map(file => ({ name: project.root + '/' + file, status: 'passed',
      assertionResults: [{ fullName: file + ' original case', status: 'passed', failureMessages: [] }] })) };
}
test('consumer acceptance checks native file and case completeness', () => {
  assert.equal(Object.keys(verifyConsumer(report(), project)).length, 2);
  for (const mutate of [
    r => { r.success = false; },
    r => { r.testResults.pop(); r.numTotalTests = 1; },
    r => { r.testResults[1] = r.testResults[0]; },
    r => { r.testResults[0].status = 'failed'; },
    r => { r.testResults[0].assertionResults = []; },
    r => { r.testResults[0].assertionResults[0].status = 'failed'; },
    r => { r.testResults[0].assertionResults[0].failureMessages = ['failed']; },
    r => { r.numTotalTests = 999; },
  ]) { const r = report(); mutate(r); assert.throws(() => verifyConsumer(r, project)); }
  assert.throws(() => projectPath('/owned', '/outside/path'));
});

test('real staged fixture retains every partition and consumer and refuses repeats or drift', { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'fortemi-workspace-stages-'));
  const write = (path, data) => { const full = join(root, path); mkdirSync(resolve(full, '..'), { recursive: true }); writeFileSync(full, data); };
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  try {
    write('package.json', JSON.stringify({ private: true, packageManager: 'pnpm@10.6.5' }));
    write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'examples/*'\n");
    write('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters: {}\n");
    write('.gitignore', 'node_modules\ncoverage\ntest-results\nbuilt.txt\n');
    symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'));
    for (const path of ['packages/core', 'packages/graph', 'packages/react', 'examples/first', 'examples/second']) {
      const core = path === 'packages/core';
      write(path + '/package.json', JSON.stringify({ name: '@fixture/' + path.split('/').at(-1), version: '1.0.0', type: 'module',
        scripts: { test: 'vitest run', build: `node -e "require('node:fs').writeFileSync('built.txt','yes')"` } }));
      symlinkSync(join(repo, core ? 'packages/core' : 'packages/graph', 'node_modules'), join(root, path, 'node_modules'));
      write(path + '/vitest.config.ts', "export default { test: { include: ['*.test.mjs'], maxWorkers: 1" +
        (core ? ", coverage: { provider: 'v8', include: ['subject.mjs'], reporter: ['json-summary'], thresholds: { statements: 79 } }" : '') + ' } }');
      if (core) {
        write(path + '/subject.mjs', 'export const value = () => 1;');
        for (const name of ['a', 'b', 'c']) write(path + '/' + name + '.test.mjs', "import { it, expect } from 'vitest'; import { value } from './subject.mjs'; it('original case', () => expect(value()).toBe(1));");
        mkdirSync(join(root, path, 'scripts'));
        for (const file of ['ci-unit-partitions.mjs', 'ci-progress-reporter.mjs']) copyFileSync(join(repo, path, 'scripts', file), join(root, path, 'scripts', file));
      } else {
        const required = path === 'packages/graph' ? '../core/built.txt' : path === 'packages/react' ? '../graph/built.txt' : '../../packages/graph/built.txt';
        write(path + '/a.test.mjs', "import { it, expect } from 'vitest'; import { existsSync } from 'node:fs'; it('dependency build exists', () => expect(existsSync('" + required + "')).toBe(true));");
      }
    }
    write('examples/no-tests/package.json', JSON.stringify({ name: '@fixture/no-tests', version: '1.0.0', private: true }));
    git(['init', '--quiet']); git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid.example', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'owned fixture']);
    await assert.rejects(execute('unknown', { root }));
    await assert.rejects(execute('core-2', { root }));
    await execute('core-1', { root });
    await assert.rejects(execute('core-1', { root }));
    await assert.rejects(execute('verify', { root }));
    write('changed.txt', 'untracked source');
    await assert.rejects(execute('core-2', { root }), /clean committed/);
    rmSync(join(root, 'changed.txt'));
    for (const stage of stages.slice(1)) await execute(stage, { root });
    const coveragePath = 'packages/core/test-results/core-unit-completeness.json';
    const mergePath = 'test-results/local-workspace/core-merge/receipt.json';
    const coverageBytes = readFileSync(join(root, coveragePath)), mergeBytes = readFileSync(join(root, mergePath));
    const lowered = JSON.parse(coverageBytes); lowered.coverage.statements.pct = 78;
    write(coveragePath, JSON.stringify(lowered));
    await assert.rejects(execute('verify', { root }), /artifact changed/);
    const rebound = JSON.parse(mergeBytes);
    rebound.artifacts[coveragePath] = createHash('sha256').update(readFileSync(join(root, coveragePath))).digest('hex');
    write(mergePath, JSON.stringify(rebound));
    await assert.rejects(execute('verify', { root }), /Global coverage gate/);
    write(coveragePath, coverageBytes); write(mergePath, mergeBytes);
    const runPath = 'test-results/local-workspace/run.json', planBytes = readFileSync(join(root, runPath));
    const partial = JSON.parse(planBytes); partial.consumers.projects.pop();
    write(runPath, JSON.stringify(partial));
    await assert.rejects(execute('verify', { root }), /Consumer inventory changed/);
    write(runPath, planBytes);
    const complete = await execute('verify', { root });
    assert.equal(complete.core.files, 3); assert.equal(complete.core.tests, 3);
    assert.equal(complete.core.coverage.statements.pct, 100);
    assert.deepEqual(complete.consumers.map(r => r.project), ['packages/graph', 'packages/react', 'examples/first', 'examples/second']);
    assert.ok(complete.consumers.every(r => Object.keys(r.cases).length === 1));
    await assert.rejects(execute('verify', { root }));
    assert.equal(git(['status', '--porcelain']).trim(), '');
  } catch (error) {
    const path = join(root, 'test-results/local-workspace/consumers/execution.log');
    const diagnostic = existsSync(path) ? readFileSync(path, 'utf8').slice(-3000) : 'No consumer log';
    throw new Error('Owned fixture failed: ' + error.message.slice(0, 500) + '\n' + diagnostic, { cause: error });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
