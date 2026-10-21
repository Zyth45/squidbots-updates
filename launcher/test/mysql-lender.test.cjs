'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mysqlLender } = require('../src/mysql-lender.cjs');

// A fake server: which services run, and what the lender asked for.
function server(running = [], { realm = false } = {}) {
  const on = new Set(running);
  const calls = [];
  const lender = mysqlLender({
    status: async () => ['mysql', 'auth', 'world'].map(id => ({ id, state: on.has(id) ? 'running' : 'stopped' })),
    start: async id => { calls.push(`start ${id}`); on.add(id); },
    stopAll: async () => { calls.push('stopAll'); on.clear(); },
    realmRunning: async () => realm,
  });
  return { on, calls, lender };
}

test('a stopped server is stopped again after a realm task, even when the task fails', async () => {
  const ok = server();
  assert.strictEqual(await ok.lender(async () => 'made'), 'made');
  assert.deepStrictEqual(ok.calls, ['start mysql', 'stopAll']);
  assert.strictEqual(ok.on.size, 0);
  const failed = server();
  await assert.rejects(failed.lender(async () => { throw new Error('boom'); }), /boom/);
  assert.deepStrictEqual(failed.calls, ['start mysql', 'stopAll']);
});

test('MySQL already running, or something else running: it is never stopped', async () => {
  const running = server(['mysql']);
  await running.lender(async () => {});
  assert.ok(!running.calls.includes('stopAll'));
  const world = server();
  await world.lender(async () => { world.on.add('world'); });
  assert.ok(!world.calls.includes('stopAll'));
  const realm = server([], { realm: true });
  await realm.lender(async () => {});
  assert.ok(!realm.calls.includes('stopAll'));
});

test('two realms switched on together: MySQL stops once, after the last one', async () => {
  const both = server();
  let finishFirst;
  const first = both.lender(() => new Promise(resolve => { finishFirst = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const second = both.lender(async () => 'second');
  await second;
  assert.ok(!both.calls.includes('stopAll'));
  finishFirst();
  await first;
  assert.deepStrictEqual(both.calls.filter(call => call === 'stopAll'), ['stopAll']);
});
