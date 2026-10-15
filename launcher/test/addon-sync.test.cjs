'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const addon = require('../src/addon-sync.cjs');

function setup(repackVersion, clientVersion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-addon-'));
  const source = path.join(root, 'repack', 'CoA-Bots', 'Client', 'Interface', 'AddOns', 'SquidBotsLite');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'SquidBotsLite.toc'), `## Title: SquidBots Lite\n## Version: ${repackVersion}\n`);
  const client = path.join(root, 'game');
  fs.mkdirSync(client);
  fs.writeFileSync(path.join(client, 'Ascension.exe'), '');
  if (clientVersion) {
    const into = path.join(client, 'Interface', 'AddOns', 'SquidBotsLite');
    fs.mkdirSync(into, { recursive: true });
    fs.writeFileSync(path.join(into, 'SquidBotsLite.toc'), `## Version: ${clientVersion}\n`);
  }
  return { root, repack: path.join(root, 'repack'), client };
}

test('versions are compared number by number', () => {
  assert.equal(addon.newer('2.10', '2.9'), true);
  assert.equal(addon.newer('2.3', '2.3'), false);
  assert.equal(addon.newer('2.2', '2.3'), false);
});

test('the addon state: no game folder, missing, outdated, current', () => {
  const a = setup('2.3', '');
  assert.equal(addon.status(a.repack, '').state, 'noclient');
  assert.equal(addon.status(a.repack, a.client).state, 'missing');
  const b = setup('2.3', '2.2');
  assert.equal(addon.status(b.repack, b.client).state, 'outdated');
  const c = setup('2.3', '2.3');
  assert.equal(addon.status(c.repack, c.client).state, 'current');
});

test('installing replaces the addon and keeps the old one aside', async () => {
  const a = setup('2.3', '2.2');
  const backups = path.join(a.root, 'backups');
  assert.deepEqual(await addon.install(a.repack, a.client, backups), ['SquidBotsLite']);
  assert.equal(addon.status(a.repack, a.client).state, 'current');
  assert.ok(fs.existsSync(path.join(backups, 'SquidBotsLite-2.2', 'SquidBotsLite.toc')));
  await assert.rejects(addon.install(a.repack, path.join(a.root, 'nowhere'), backups));
});
