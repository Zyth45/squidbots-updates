'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir, write } = require('./helpers.cjs');
const { repackChecks, FIXES } = require('../src/repack-checks.cjs');

// A repack with every known problem the checks can find on disk.
async function brokenRepack() {
  const root = await tempDir();
  await write(root, {
    'Settings/worldserver.conf.template': 'SourceDirectory = ""\nUpdates.EnableDatabases = 0\n',
    'Settings/repack.json': '{"raPort": 3443}',
    'Scripts/manage.py': 'SOURCE = "@SOURCE@"\n',
    'Source/sql-tree/data/sql/updates/db_world/a.sql': 'SELECT 1;',
    'Core/configs/modules/coa.conf.dist': 'CoA.Enable = 1\n',
    'Core/configs/modules/ok.conf.dist': 'A = 1\n',
    'Core/configs/modules/ok.conf': 'A = 1\n',
    'CoA-Bots/Core/configs/modules/playerbots.conf': 'Playerbots.Updates.EnableDatabases = 1\nAiPlayerbot.BotsWhisperPublic = 1\nAiPlayerbot.MaxRandomBots = 500\nPlayerbotsDatabaseInfo = "127.0.0.1;<MYSQL_PORT>;acore;x;acore_playerbots"\n',
    'CoA-Bots/release.json': '{"version": "1.6"}',
    'CoA-Bots/Installer-Bots.ps1': "$x.Replace('', '\')",
    'CoA-Bots/Database/world/updates/rev_20260925_50_lfg_wing_final_bosses.sql': 'SELECT 1;',
    'mysql/data/acore_auth/x.ibd': '', 'mysql/data/_backup/acore_auth/x.ibd': '',
    'mysql/logs/mysql-error.log': '[ERROR] Multiple files found for the same tablespace ID',
    'Data/maps/0000000.map': 'm', 'Data/dbc/Spell.dbc': 'd',
  });
  return root;
}

async function run(root) {
  const checks = [];
  await repackChecks({ root, services: [], mysqlQuery: null, add: (group, id, state, data = {}, action = '') => checks.push({ group, id, state, data, action }) });
  return Object.fromEntries(checks.map(check => [check.id, check]));
}

test('every known problem on disk is found', async () => {
  const found = await run(await brokenRepack());
  assert.equal(found['conf.updates'].state, 'bad');
  assert.equal(found['conf.updates'].action, 'fix:updates');
  assert.equal(found['conf.dist'].state, 'bad');
  assert.equal(found['conf.dist'].data.count, 1, 'only the module without its .conf');
  assert.equal(found['bots.dbupdates'].state, 'bad');
  assert.equal(found['bots.conf'].state, 'bad', 'placeholders left in playerbots.conf');
  assert.equal(found['bots.whisper'].state, 'warn');
  assert.equal(found['bots.leftover'].state, 'bad');
  assert.equal(found['mysql.folders'].state, 'bad');
  assert.equal(found['mysql.folders'].data.folders, '_backup');
  assert.equal(found['mysql.tablespace'].state, 'bad');
  assert.equal(found['data.maps'].state, 'bad');
  assert.equal(found['data.maps'].data.missing, 'vmaps, mmaps');
  assert.equal(found['runtime.python'].state, 'bad');
});

test('the safe fixes repair what they say, keep a copy, and the checks turn green', async () => {
  const root = await brokenRepack();
  for (const id of ['updates', 'conf-dist', 'bots-updates', 'whisper', 'bots-leftover']) await FIXES[id]({ root });
  const found = await run(root);
  for (const id of ['conf.updates', 'conf.dist', 'bots.dbupdates']) assert.equal(found[id].state, 'ok', id);
  assert.equal(found['bots.whisper'], undefined);
  assert.equal(found['bots.leftover'], undefined);
  assert.match(fs.readFileSync(path.join(root, 'Settings/worldserver.conf.template'), 'utf8'), /^SourceDirectory = "@SOURCE@"$/m);
  assert.ok(fs.readdirSync(path.join(root, 'Settings')).some(name => name.startsWith('worldserver.conf.template.bak-')), 'a copy is kept');
  assert.equal(fs.readFileSync(path.join(root, 'Core/configs/modules/coa.conf'), 'utf8'), 'CoA.Enable = 1\n');
  assert.equal(fs.readFileSync(path.join(root, 'Core/configs/modules/ok.conf'), 'utf8'), 'A = 1\n', 'an existing .conf is never overwritten');
});

test('a 1.5 install keeps its own world update', async () => {
  const root = await brokenRepack();
  fs.writeFileSync(path.join(root, 'CoA-Bots/release.json'), '{"version": "1.5"}');
  assert.equal((await run(root))['bots.leftover'], undefined);
});

test('keys of a newer bots version are found and added with their defaults', async () => {
  const root = await tempDir();
  await write(root, {
    'CoA-Bots/Core/configs/modules/playerbots.conf': 'AiPlayerbot.Enabled = 1\nAiPlayerbot.MaxRandomBots = 900\n',
    'CoA-Bots/Core/configs/modules/playerbots.conf.dist': 'AiPlayerbot.Enabled = 1\nAiPlayerbot.MaxRandomBots = 500\nAiPlayerbot.CoaNewThing = 3\n',
    'Core/configs/modules/playerbots.conf': 'AiPlayerbot.MaxRandomBots = 50\n',
  });
  let found = await run(root);
  assert.equal(found['bots.missingkeys'].state, 'warn');
  assert.equal(found['bots.missingkeys'].data.keys, 'AiPlayerbot.CoaNewThing');
  assert.equal(found['bots.which'].state, 'warn', 'the repack copy is not the one read');
  await FIXES['bots-keys']({ root });
  const conf = fs.readFileSync(path.join(root, 'CoA-Bots/Core/configs/modules/playerbots.conf'), 'utf8');
  assert.match(conf, /AiPlayerbot.MaxRandomBots = 900/, 'existing values untouched');
  assert.match(conf, /AiPlayerbot.CoaNewThing = 3/);
  found = await run(root);
  assert.equal(found['bots.missingkeys'].state, 'ok');
});

test('module settings that fill the log: warned, and the shipped .conf.dist put where the server reads them', async () => {
  const root = await brokenRepack();
  const line = '> Config: Missing property DynamicXP.Rate in config file C:/x/worldserver.conf or module config, add "DynamicXP.Rate = 1" to this file.\n';
  await write(root, {
    'Core/Logs/Server.log': line.repeat(600),
    'CoA-Bots/Core/configs/modules/dynamicxp.conf.dist': 'DynamicXP.Rate = 1\n',
    'Core/configs/modules/wildcard.conf': 'Wildcard.Mine = 7\n',
    'CoA-Bots/Core/configs/modules/wildcard.conf.dist': 'Wildcard.Mine = 1\n',
  });
  let found = await run(root);
  assert.equal(found['conf.missing'].state, 'warn');
  assert.equal(found['conf.missing'].action, 'fix:missing-props');
  await FIXES['missing-props']({ root });
  assert.equal(fs.readFileSync(path.join(root, 'Core/configs/modules/dynamicxp.conf'), 'utf8'), 'DynamicXP.Rate = 1\n');
  assert.equal(fs.readFileSync(path.join(root, 'Core/configs/modules/wildcard.conf'), 'utf8'), 'Wildcard.Mine = 7\n', 'an existing .conf is kept');
  assert.ok(!fs.existsSync(path.join(root, 'Core/configs/modules/playerbots.conf.dist')), 'playerbots stays with the bots');
  found = await run(root);
  assert.equal(found['conf.missing'].action, '');
});

test('who can join: written into manage.py and both templates, and again after an update replaced them', async () => {
  const network = require('../src/network.cjs');
  const root = await tempDir();
  const manage = 'def start_mysql():\n    if not recovery:\n        mysql(f"UPDATE acore_auth.realmlist SET name=\'AzerothCore\',address=\'127.0.0.1\',"\n              f"localAddress=\'127.0.0.1\',port={config[\'worldPort\']} WHERE id=1;")\n';
  const template = 'Something = 1\nBindIP = "127.0.0.1"\nOther = 2\n';
  await write(root, { 'Scripts/manage.py': manage, 'Settings/authserver.conf.template': template, 'Settings/worldserver.conf.template': template });
  await assert.rejects(network.saveNetwork(root, { mode: 'open', address: 'bad address;', name: 'X' }), /valid address/);
  const result = await network.saveNetwork(root, { mode: 'open', address: '192.168.1.50', name: 'Squid Realm' });
  assert.equal(result.changed.length, 3);
  const edited = fs.readFileSync(path.join(root, 'Scripts/manage.py'), 'utf8');
  assert.match(edited, /SET name='Squid Realm',address='192.168.1.50',/);
  assert.match(edited, /localAddress='127.0.0.1'/, 'the local address stays');
  assert.match(fs.readFileSync(path.join(root, 'Settings/worldserver.conf.template'), 'utf8'), /^BindIP = "0.0.0.0"$/m);
  // An update brings the original files back: applying again restores the choice.
  fs.writeFileSync(path.join(root, 'Scripts/manage.py'), manage);
  fs.writeFileSync(path.join(root, 'Settings/authserver.conf.template'), template);
  assert.equal((await network.applyNetwork(root)).length, 2);
  assert.match(fs.readFileSync(path.join(root, 'Settings/authserver.conf.template'), 'utf8'), /^BindIP = "0.0.0.0"$/m);
  // Back to this PC only.
  await network.saveNetwork(root, { mode: 'local', address: '192.168.1.50', name: 'Squid Realm' });
  assert.match(fs.readFileSync(path.join(root, 'Scripts/manage.py'), 'utf8'), /address='127.0.0.1',/);
  assert.match(fs.readFileSync(path.join(root, 'Settings/worldserver.conf.template'), 'utf8'), /^BindIP = "127.0.0.1"$/m);
});
