'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { tempDir } = require('./helpers.cjs');
const { ServerConfig } = require('../src/server-config.cjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'repack');

async function copyRepack() {
  const root = await tempDir();
  await fsp.cp(FIXTURE, root, { recursive: true });
  return root;
}

test('settings files of a repack with CoA Bots are found, templates first', async () => {
  const config = new ServerConfig(await copyRepack());
  const files = await config.files();
  const world = files.find(file => file.id === 'worldserver.conf');
  assert.equal(world.path, 'Settings/worldserver.conf.template');
  assert.equal(world.dist, 'Core/configs/worldserver.conf.dist');
  assert.equal(files.find(file => file.id === 'playerbots.conf').scope, 'bots');
  const overview = await config.overview();
  const bots = overview.settings.find(setting => setting.key === 'AiPlayerbot.MaxRandomBots');
  assert.match(bots.value, /^\d+$/);
  assert.equal(overview.settings.find(setting => setting.key === 'AiPlayerbot.BroadcastWorldChannelName')?.value.includes('"'), false);
  assert.ok(overview.recipes.some(recipe => recipe.id === 'coa-recommended'));
});

test('details: documentation from the .dist, secrets never sent, managed keys locked', async () => {
  const config = new ServerConfig(await copyRepack());
  const world = await config.details('worldserver.conf');
  const kill = world.entries.find(entry => entry.key === 'Rate.XP.Kill');
  assert.match(kill.description, /Experience rates/);
  assert.equal(kill.default, '1');
  const login = world.entries.find(entry => entry.key === 'LoginDatabaseInfo');
  assert.equal(login.value, '');
  assert.equal(login.locked, 'secret');
  assert.match(world.entries.find(entry => entry.key === 'MapUpdate.Threads').locked, /CoA Bots/);
  const bots = await config.details('playerbots.conf');
  const secret = bots.entries.find(entry => entry.key === 'PlayerbotsDatabaseInfo');
  assert.equal(secret.value, '');
  assert.equal(JSON.stringify(bots).includes('FIXTURE-SECRET'), false);
  assert.match(bots.entries.find(entry => entry.key === 'AiPlayerbot.RandomBotAutologin').description, /randombot/i);
});

test('save changes one value in place, keeps a backup and records the change', async () => {
  const root = await copyRepack();
  const config = new ServerConfig(root);
  const file = path.join(root, 'CoA-Bots/Core/configs/modules/playerbots.conf');
  const before = fs.readFileSync(file, 'utf8');
  const result = await config.save([
    { file: 'playerbots.conf', key: 'AiPlayerbot.MaxRandomBots', value: '42' },
    { file: 'playerbots.conf', key: 'AiPlayerbot.BroadcastWorldChannelName', value: 'Ascension' },
  ]);
  assert.deepEqual(result.written, ['playerbots.conf']);
  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /^AiPlayerbot\.MaxRandomBots = 42$/m);
  assert.match(after, /^AiPlayerbot\.BroadcastWorldChannelName = "Ascension"$/m);
  assert.equal(after.split('\n').length, before.split('\n').length, 'no line added or removed');
  const backup = path.join(root, '.coa-launcher/config-backups', result.backup, 'CoA-Bots/Core/configs/modules/playerbots.conf');
  assert.equal(fs.readFileSync(backup, 'utf8'), before);
  const recorded = JSON.parse(fs.readFileSync(path.join(root, '.coa-launcher/config-changes.json'), 'utf8'));
  assert.equal(recorded['playerbots.conf|AiPlayerbot.MaxRandomBots'], '42');

  await config.restore(result.backup);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('invalid, secret and managed values are refused and nothing is written', async () => {
  const root = await copyRepack();
  const config = new ServerConfig(root);
  const file = path.join(root, 'CoA-Bots/Core/configs/modules/playerbots.conf');
  const before = fs.readFileSync(file, 'utf8');
  for (const change of [
    { file: 'playerbots.conf', key: 'AiPlayerbot.Enabled', value: 'yes' },
    { file: 'playerbots.conf', key: 'AiPlayerbot.MaxRandomBots', value: '10\nAiPlayerbot.Enabled = 0' },
    { file: 'playerbots.conf', key: 'PlayerbotsDatabaseInfo', value: 'x' },
    { file: 'worldserver.conf', key: 'MapUpdate.Threads', value: '4' },
    { file: '../../evil.conf', key: 'A', value: '1' },
  ]) {
    await assert.rejects(config.save([{ file: 'playerbots.conf', key: 'AiPlayerbot.MaxRandomBots', value: '12' }, change]));
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('recorded changes are carried to an upgraded repack', async () => {
  const oldRoot = await copyRepack();
  const newRoot = await copyRepack();
  await new ServerConfig(oldRoot).save([{ file: 'worldserver.conf', key: 'Rate.XP.Kill', value: '3' }, { file: 'playerbots.conf', key: 'AiPlayerbot.BroadcastWorldChannelName', value: 'Monde' }]);
  const result = await new ServerConfig(oldRoot).carryTo(newRoot);
  assert.deepEqual(result.applied.sort(), ['AiPlayerbot.BroadcastWorldChannelName', 'Rate.XP.Kill']);
  assert.match(fs.readFileSync(path.join(newRoot, 'Settings/worldserver.conf.template'), 'utf8'), /^Rate\.XP\.Kill\s*=\s*3$/m);
  assert.match(fs.readFileSync(path.join(newRoot, 'CoA-Bots/Core/configs/modules/playerbots.conf'), 'utf8'), /^AiPlayerbot\.BroadcastWorldChannelName = "Monde"$/m);
});
