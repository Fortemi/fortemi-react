import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export function verifyResourceEvents({ memory, tasks }) {
  function counters(text) {
    const result = {};
    for (const line of text.trim().split('\n')) {
      const match = line.match(/^(\w+) (\d+)$/);
      assert.ok(match, 'Malformed resource event counter');
      assert.ok(!Object.hasOwn(result, match[1]), 'Duplicate resource event counter');
      const value = Number(match[2]);
      assert.ok(Number.isSafeInteger(value));
      result[match[1]] = value;
    }
    return result;
  }
  const observed = { memory: counters(memory), tasks: counters(tasks) };
  for (const name of ['max', 'oom', 'oom_kill']) assert.equal(observed.memory[name], 0, `Memory ${name} event`);
  assert.equal(observed.tasks.max, 0, 'Container task-limit rejection');
  return observed;
}

export function verifyBrowserReport(report) {
  const projects = ['chromium', 'firefox', 'webkit'];
  assert.deepEqual(report.config.projects.map(p => p.name).sort(), projects);
  assert.equal(report.stats.unexpected, 0, 'Unexpected browser failures');
  assert.deepEqual(report.errors, [], 'Browser runner errors');
  const counts = Object.fromEntries(projects.map(p => [p, 0]));
  function visit(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs) {
        for (const test of spec.tests) {
          assert.ok(Object.hasOwn(counts, test.projectName), 'Unknown browser project');
          assert.ok(['expected', 'flaky', 'skipped'].includes(test.status), 'Nonpassing browser case');
          if (test.status !== 'skipped') {
            assert.ok(test.results.some(r => r.status === 'passed'), 'No passing browser attempt');
            counts[test.projectName]++;
          }
        }
      }
      visit(suite.suites || []);
    }
  }
  visit(report.suites);
  assert.ok(Object.values(counts).every(n => n > 0), 'Every browser must execute passing cases');
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), report.stats.expected + report.stats.flaky,
    'Browser report count mismatch');
  return counts;
}

export function verifyRuntime({ memory, swap, tasks, cpu, status }) {
  assert.equal(memory.trim(), '8589934592', 'Expected an 8-GiB container hard limit');
  assert.equal(swap.trim(), '0', 'Container swap must be disabled');
  assert.equal(tasks.trim(), '256', 'Expected a 256-task container limit');
  const limits = cpu.trim().split(/\s+/).map(Number);
  assert.equal(limits.length, 2);
  assert.ok(limits.every(n => Number.isSafeInteger(n) && n > 0));
  assert.equal(limits[0], 2 * limits[1], 'Expected a two-CPU container quota');
  const allowed = status.match(/^Cpus_allowed_list:\s*(\S+)$/m)?.[1];
  assert.ok(allowed, 'Missing CPU affinity observation');
  const cpus = [];
  let previous = -1;
  for (const group of allowed.split(',')) {
    assert.match(group, /^\d+(?:-\d+)?$/);
    const [start, end = start] = group.split('-').map(Number);
    assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start > previous && end >= start);
    if (cpus.length < 2) cpus.push(start);
    if (cpus.length < 2 && end > start) cpus.push(start + 1);
    previous = end;
  }
  return cpus.join(',');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--finish') {
    assert.equal(process.argv.length, 3);
    const events = { memory: readFileSync('/sys/fs/cgroup/memory.events', 'utf8'),
      tasks: readFileSync('/sys/fs/cgroup/pids.events', 'utf8') };
    writeFileSync('/results/resource-events.json', JSON.stringify(events, null, 2) + '\n', { flag: 'wx' });
    verifyResourceEvents(events);
    process.exit(0);
  }
  if (process.argv[2] === '--report') {
    assert.equal(process.argv.length, 4);
    const file = process.argv[3];
    const counts = verifyBrowserReport(JSON.parse(readFileSync(file, 'utf8')));
    writeFileSync(join(dirname(file), 'acceptance.json'), JSON.stringify({ status: 'BROWSER_TESTS_PASS', counts,
      scope: 'Browser report validation; container cleanup must also succeed' }, null, 2) + '\n', { flag: 'wx' });
    console.log('Browser report accepted: ' + JSON.stringify(counts));
    process.exit(0);
  }
  assert.equal(process.argv.length, 2);
  const observation = Object.fromEntries(['memory.max', 'memory.swap.max', 'pids.max', 'cpu.max']
    .map(name => [name, readFileSync('/sys/fs/cgroup/' + name, 'utf8')]));
  const affinity = verifyRuntime({ memory: observation['memory.max'], swap: observation['memory.swap.max'],
    tasks: observation['pids.max'], cpu: observation['cpu.max'], status: readFileSync('/proc/self/status', 'utf8') });
  writeFileSync('/results/runtime.json', JSON.stringify({ at: new Date().toISOString(), observation, affinity,
    scope: 'Container cgroup-v2 bounds and selected payload affinity, not browser acceptance' }, null, 2) + '\n', { flag: 'wx' });
  console.log(affinity);
}
