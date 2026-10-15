'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { tempDir, write, read, exists } = require('./helpers.cjs');
const tools = require('../src/client-tools.cjs');

test('WTF is copied, listed and put back; the settings replaced are kept in a new copy', async () => {
  const game = await tempDir();
  await write(game, { 'WTF/Config.wtf': 'SET gxResolution "1920x1080"', 'WTF/Account/ME/SavedVariables/DBM.lua': 'DBM = { v = 1 }' });
  const first = await tools.backupSettings(game);
  assert.ok(first.size > 0);
  await write(game, { 'WTF/Config.wtf': 'SET gxResolution "800x600"', 'WTF/new.txt': 'x' });
  const list = await tools.listSettingsBackups(game);
  assert.equal(list.length, 1);
  await new Promise(resolve => setTimeout(resolve, 1100));
  const result = await tools.restoreSettings(game, first.id);
  assert.equal(read(game, 'WTF/Config.wtf'), 'SET gxResolution "1920x1080"');
  assert.equal(exists(game, 'WTF/new.txt'), false);
  assert.ok(result.previous, 'the settings in place were copied before being replaced');
  assert.equal(read(game, `.coa-launcher/wtf-backups/${result.previous}/WTF/Config.wtf`), 'SET gxResolution "800x600"');
});

test('no WTF yet: nothing to copy; unknown backups are refused', async () => {
  const game = await tempDir();
  assert.equal(await tools.backupSettings(game), null);
  await assert.rejects(tools.restoreSettings(game, '../../evil'), /Unknown backup/);
});

test('the cache is emptied and its size reported', async () => {
  const game = await tempDir();
  await write(game, { 'Cache/WDB/enUS/itemcache.wdb': Buffer.alloc(5000), 'WTF/Config.wtf': 'keep' });
  const result = await tools.clearCache(game);
  assert.equal(result.freed, 5000);
  assert.equal(exists(game, 'Cache'), false);
  assert.equal(read(game, 'WTF/Config.wtf'), 'keep');
  assert.deepEqual(await tools.clearCache(game), { freed: 0 });
  assert.ok(path.isAbsolute(game));
});
