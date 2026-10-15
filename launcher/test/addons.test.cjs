'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { AddonManager } = require('../src/addons.cjs');
const { publicKey } = require('../src/signing.cjs');
const { tempDir, keys, write, serve, read, exists } = require('./helpers.cjs');

const tools = path.resolve(__dirname, '../../tools');
const signing = keys();

// Publishes a folder of addons with the real publishing tool.
async function publishAddons(source, output) {
  const keyFile = path.join(output, '..', 'test.private.pem');
  fs.writeFileSync(keyFile, signing.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  execFileSync(process.execPath, [path.join(tools, 'publish-addons.mjs'), output, '--source', source, '--key', keyFile, '--meta', path.join(source, '..', 'none.json')], { stdio: 'pipe' });
}

async function setup() {
  const work = await tempDir();
  const source = path.join(work, 'addons');
  const output = path.join(work, 'out');
  await write(source, {
    'DataStore/DataStore.toc': '## Title: DataStore\n## Version: 1.0\nDataStore.lua',
    'DataStore/DataStore.lua': 'DS=1',
    'DataStore_Mails/DataStore_Mails.toc': '## Title: DataStore Mails\n## Dependencies: DataStore',
    'DataStore_Mails/Mails.lua': 'M=1',
    'Altoholic/Altoholic.toc': '## Title: |cff00ff00Altoholic|r\n## Notes: Alts\n## Version: 3.3\n## RequiredDeps: DataStore',
    'Altoholic/Core.lua': 'A=1',
  });
  await publishAddons(source, output);
  const server = await serve(output);
  const game = await tempDir();
  await write(game, { 'Wow.exe': 'exe', 'WTF/Account/X/SavedVariables/Altoholic.lua': 'saved' });
  const manager = new AddonManager({ catalogUrl: `${server.url}catalog.json`, publicKey: publicKey(signing.publicRaw) });
  return { work, source, output, server, game, manager };
}

test('the publishing tool groups folders and reads dependencies', async t => {
  const { output, server } = await setup();
  t.after(server.close);
  const catalog = JSON.parse(fs.readFileSync(path.join(output, 'catalog.json'), 'utf8'));
  const byId = Object.fromEntries(catalog.packages.map(pkg => [pkg.id, pkg]));
  assert.deepEqual(byId.datastore.folders, ['DataStore', 'DataStore_Mails']);
  assert.deepEqual(byId.altoholic.dependencies, ['datastore']);
  assert.equal(byId.altoholic.name, 'Altoholic', 'WoW colour codes removed');
  assert.ok(fs.existsSync(path.join(output, 'catalog.json.sig')));
});

test('install pulls dependencies, update and uninstall keep the player data', async t => {
  const { source, output, server, game, manager } = await setup();
  t.after(server.close);
  const result = await manager.install(game, ['altoholic']);
  assert.deepEqual(result.installed, ['datastore', 'altoholic']);
  assert.equal(read(game, 'Interface/AddOns/DataStore_Mails/Mails.lua'), 'M=1');
  let list = await manager.list(game, true);
  assert.deepEqual(list.packages.map(pkg => pkg.status), ['installed', 'installed']);

  // New version: one file changes, one disappears.
  fs.writeFileSync(path.join(source, 'Altoholic', 'Core.lua'), 'A=2');
  fs.rmSync(path.join(source, 'DataStore_Mails', 'Mails.lua'));
  await publishAddons(source, output);
  list = await manager.list(game, true);
  assert.equal(list.packages.find(pkg => pkg.id === 'altoholic').status, 'update');
  await manager.install(game, ['altoholic', 'datastore']);
  assert.equal(read(game, 'Interface/AddOns/Altoholic/Core.lua'), 'A=2');
  assert.equal(exists(game, 'Interface/AddOns/DataStore_Mails/Mails.lua'), false);

  await assert.rejects(manager.uninstall(game, 'datastore'), /required by Altoholic/);
  fs.writeFileSync(path.join(game, 'Interface', 'AddOns', 'Altoholic', 'Core.lua'), 'my tweak');
  const removed = await manager.uninstall(game, 'altoholic');
  assert.equal(removed.kept, 1);
  assert.equal(read(game, 'Interface/AddOns/Altoholic/Core.lua'), 'my tweak');
  assert.equal(exists(game, 'Interface/AddOns/Altoholic/Altoholic.toc'), false);
  assert.equal(read(game, 'WTF/Account/X/SavedVariables/Altoholic.lua'), 'saved');
});

test('a hand-installed copy is moved aside, never deleted', async t => {
  const { server, game, manager } = await setup();
  t.after(server.close);
  await write(game, { 'Interface/AddOns/DataStore/DataStore.toc': '## Title: old', 'Interface/AddOns/DataStore/mine.lua': 'mine' });
  await assert.rejects(manager.install(game, ['datastore']), error => error.code === 'ADDON_MANUAL' && error.folders.includes('DataStore'));
  await manager.install(game, ['datastore'], { replaceManual: true });
  assert.equal(read(game, 'Interface/AddOns/DataStore/DataStore.lua'), 'DS=1');
  const replaced = path.join(game, '.coa-launcher', 'addons', 'replaced');
  const stamp = fs.readdirSync(replaced)[0];
  assert.equal(fs.readFileSync(path.join(replaced, stamp, 'DataStore', 'mine.lua'), 'utf8'), 'mine');
});

test('a tampered catalog is refused', async t => {
  const { output, server, game, manager } = await setup();
  t.after(server.close);
  const catalog = JSON.parse(fs.readFileSync(path.join(output, 'catalog.json'), 'utf8'));
  catalog.packages[0].files[0].path = 'Interface/AddOns/DataStore/../../../evil.lua';
  fs.writeFileSync(path.join(output, 'catalog.json'), JSON.stringify(catalog));
  await assert.rejects(manager.list(game, true), /signature is invalid/);
});
