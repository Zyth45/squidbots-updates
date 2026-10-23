'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const realms = require('../src/realms.cjs');

// A repack with CoA Bots, without MySQL: enough for everything a realm does on files.
function repack({ knowsRealms = true, version = '2.6' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-realms-'));
  const configs = path.join(root, 'CoA-Bots', 'Core', 'configs');
  fs.mkdirSync(path.join(configs, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'CoA-Bots', 'Core', 'worldserver.exe'), '');
  fs.writeFileSync(path.join(root, 'CoA-Bots', 'release.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(root, 'CoA-Bots', 'coa_common.py'), knowsRealms ? 'MYSQL_DATA_KNOWN = {"acore_characters_wildcard", "acore_characters_reborn"}\n' : 'MYSQL_DATA_KNOWN = {"acore_characters"}\n');
  fs.writeFileSync(path.join(configs, 'worldserver.conf'), [
    'RealmID = 1', 'WorldServerPort = 8085', 'Ra.Port = 3443', 'SOAP.Enabled = 1', 'Rate.XP.Kill = 1',
    'CharacterCreating.Disabled.ClassMask = 0', 'LogsDir = "C:/x/Core/Logs"',
    'CharacterDatabaseInfo = "127.0.0.1;3307;acore;secret;acore_characters"', '',
  ].join('\n'));
  fs.writeFileSync(path.join(configs, 'modules', 'playerbots.conf'), [
    'AiPlayerbot.MinRandomBots = 500', 'AiPlayerbot.MaxRandomBots = 500', 'AiPlayerbot.CommandServerPort = 8888',
    'AiPlayerbot.RandomBotAccountPrefix = "rndbot"', 'AiPlayerbot.CoaClassesOnly = 1',
    'PlayerbotsDatabaseInfo = "127.0.0.1;3307;acore;secret;acore_playerbots"', '',
  ].join('\n'));
  fs.writeFileSync(path.join(configs, 'modules', 'coa.conf'), 'CoA.ClassModel = "coa"\nCoA.GameModeMask = 0\n');
  fs.writeFileSync(path.join(configs, 'modules', 'mod-coa-challenges.conf'), 'CoAChallenges.GameModes.Realm = CoA\n');
  fs.writeFileSync(path.join(root, 'Settings.json'), '');
  return root;
}
const snapshot = folder => fs.readdirSync(folder, { recursive: true }).filter(name => fs.statSync(path.join(folder, name)).isFile()).sort().map(name => `${name}:${fs.readFileSync(path.join(folder, name), 'utf8')}`).join('\n');
const value = (file, key) => new RegExp(`^${key.replace(/\./g, '\\.')}\\s*=\\s*(.*)$`, 'm').exec(fs.readFileSync(file, 'utf8'))?.[1];
function realmFolder(root, key, saved) {
  const dir = path.join(root, 'Royaumes', key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'realm.json'), JSON.stringify({ key, id: key === 'wildcard' ? 2 : 3, name: key, worldPort: 8185, raPort: 3543, autostart: true, ...saved }));
  return dir;
}

test('without any realm, the server calls change nothing', async () => {
  const root = repack();
  const before = snapshot(root);
  await realms.stopAll(root);
  assert.deepStrictEqual(await realms.startMarked(root), []);
  const status = await realms.status(root, { live: false });
  assert.deepStrictEqual(status.realms.map(realm => realm.state), ['absent', 'absent']);
  assert.ok(!fs.existsSync(path.join(root, 'Royaumes')));
  assert.strictEqual(snapshot(root), before);
});

test('a realm is offered only when the installed update tool knows its databases', async () => {
  const old = repack({ knowsRealms: false });
  assert.ok((await realms.status(old, { live: false })).realms.every(realm => realm.ready === false));
  await assert.rejects(realms.create(old, 'wildcard'), /newer CoA Bots/);
  assert.ok(!fs.existsSync(path.join(old, 'Royaumes')));
  const ready = repack();
  assert.ok((await realms.status(ready, { live: false })).realms.every(realm => realm.ready === true));
});

test('configs of a realm: CoA, then its own values, then what its mode imposes; CoA files untouched', async () => {
  const root = repack();
  const coa = snapshot(path.join(root, 'CoA-Bots'));
  const dir = realmFolder(root, 'wildcard');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ 'worldserver.conf': { 'Rate.XP.Kill': '3', 'CharacterCreating.Disabled.ClassMask': '0' }, 'playerbots.conf': { 'AiPlayerbot.MaxRandomBots': '150' } }));
  await realms.writeConfigs(root, 'wildcard', JSON.parse(fs.readFileSync(path.join(dir, 'realm.json'), 'utf8')));
  const ws = path.join(dir, 'configs', 'worldserver.conf');
  const pb = path.join(dir, 'configs', 'modules', 'playerbots.conf');
  assert.strictEqual(value(ws, 'Rate.XP.Kill'), '3');
  assert.strictEqual(value(ws, 'CharacterCreating.Disabled.ClassMask'), '4294966783');
  assert.strictEqual(value(ws, 'RealmID'), '2');
  assert.strictEqual(value(ws, 'WorldServerPort'), '8185');
  assert.strictEqual(value(ws, 'Ra.Port'), '3543');
  assert.strictEqual(value(ws, 'SOAP.Enabled'), '0');
  assert.strictEqual(value(ws, 'CharacterDatabaseInfo'), '"127.0.0.1;3307;acore;secret;acore_characters_wildcard"');
  assert.match(value(ws, 'LogsDir'), /Royaumes\/wildcard\/Logs"$/);
  assert.strictEqual(value(pb, 'AiPlayerbot.MaxRandomBots'), '150');
  assert.strictEqual(value(pb, 'AiPlayerbot.MinRandomBots'), '500');
  assert.strictEqual(value(pb, 'AiPlayerbot.CommandServerPort'), '0');
  assert.strictEqual(value(pb, 'AiPlayerbot.RandomBotAccountPrefix'), '"rndwc"');
  assert.strictEqual(value(pb, 'PlayerbotsDatabaseInfo'), '"127.0.0.1;3307;acore;secret;acore_playerbots_wildcard"');
  assert.strictEqual(value(path.join(dir, 'configs', 'modules', 'coa.conf'), 'CoA.ClassModel'), '"hero"');
  assert.strictEqual(value(path.join(dir, 'configs', 'modules', 'coa.conf'), 'CoA.RandomBotAccountPrefix'), '"rndwc"');
  assert.strictEqual(value(path.join(dir, 'configs', 'modules', 'mod-coa-challenges.conf'), 'CoAChallenges.GameModes.Realm'), 'WildCard');
  assert.strictEqual(snapshot(path.join(root, 'CoA-Bots')), coa);
});

test('the settings page of a realm: origins, own values saved, mode values refused, back to CoA', async () => {
  const root = repack();
  realmFolder(root, 'reborn');
  const overview = { settings: [
    { file: 'worldserver.conf', key: 'Rate.XP.Kill', kind: 'float', value: '1' },
    { file: 'worldserver.conf', key: 'CharacterCreating.Disabled.ClassMask', kind: 'int', value: '0' },
    { file: 'playerbots.conf', key: 'AiPlayerbot.MaxRandomBots', kind: 'int', value: '500' },
  ] };
  let page = await realms.settingsOf(root, 'reborn', overview);
  assert.deepStrictEqual(page.settings.map(setting => setting.origin), ['coa', 'mode', 'coa']);
  assert.strictEqual(page.settings[1].value, '4294965760');
  assert.strictEqual(page.realm.key, 'reborn');
  await assert.rejects(realms.saveSettings(root, 'reborn', [{ file: 'worldserver.conf', key: 'CharacterCreating.Disabled.ClassMask', value: '1' }]), /game mode/);
  await assert.rejects(realms.saveSettings(root, 'reborn', [{ file: 'worldserver.conf', key: 'RealmID', value: '1' }]), /refused/);
  await assert.rejects(realms.saveSettings(root, 'reborn', [{ file: 'playerbots.conf', key: 'AiPlayerbot.MaxRandomBots', value: 'many' }]), /refused/);
  await realms.saveSettings(root, 'reborn', [{ file: 'playerbots.conf', key: 'AiPlayerbot.MaxRandomBots', value: '200' }]);
  page = await realms.settingsOf(root, 'reborn', overview);
  assert.deepStrictEqual(page.settings[2], { ...overview.settings[2], coaValue: '500', value: '200', origin: 'own' });
  await realms.saveSettings(root, 'reborn', [{ file: 'playerbots.conf', key: 'AiPlayerbot.MaxRandomBots', reset: true }]);
  page = await realms.settingsOf(root, 'reborn', overview);
  assert.strictEqual(page.settings[2].origin, 'coa');
  assert.strictEqual(page.settings[2].value, '500');
});

test('realms never answer for an unknown key or path', async () => {
  const root = repack();
  await assert.rejects(realms.create(root, '../x'), /Unknown realm/);
  await assert.rejects(realms.saveSettings(root, 'wildcard', [{ file: 'worldserver.conf', key: 'Rate.XP.Kill', value: '2' }]), /Create the realm first/);
});

test('modules of a realm: as CoA, own on/off, back to CoA; what the mode has not is set and hidden', async () => {
  const root = repack();
  const modules = path.join(root, 'CoA-Bots', 'Core', 'configs', 'modules');
  fs.appendFileSync(path.join(modules, 'playerbots.conf'), 'AiPlayerbot.Enabled = 1\n');
  fs.writeFileSync(path.join(modules, 'mod_ahbot.conf'), 'AuctionHouseBot.Enable = true\n');
  fs.writeFileSync(path.join(modules, 'manastorm-endless.conf'), 'Manastorm.Enable = 1\n');
  fs.appendFileSync(path.join(modules, 'coa.conf'), 'CoA.RotationAssist.Enable = 1\n');
  fs.writeFileSync(path.join(modules, 'coa_custom_races.conf'), 'CoACustomRaces.Enable = 1\nCoACustomRaces.BotsEnable = 1\n');
  realmFolder(root, 'wildcard');
  const byId = list => Object.fromEntries(list.map(module => [module.id, `${module.origin}:${module.on ? 'on' : 'off'}`]));
  assert.deepStrictEqual(byId(await realms.modulesOf(root, 'wildcard')), { bots: 'coa:on', ahbot: 'coa:on', manastorm: 'coa:on', rotation: 'mode:off', multirace: 'mode:off' });
  await realms.setModule(root, 'wildcard', 'ahbot', 'off');
  await realms.setModule(root, 'wildcard', 'bots', 'off');
  assert.deepStrictEqual(byId(await realms.modulesOf(root, 'wildcard')).ahbot, 'own:off');
  await assert.rejects(realms.setModule(root, 'wildcard', 'rotation', 'on'), /game mode/);
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'Royaumes', 'wildcard', 'realm.json'), 'utf8'));
  await realms.writeConfigs(root, 'wildcard', saved);
  const conf = rel => path.join(root, 'Royaumes', 'wildcard', 'configs', 'modules', rel);
  assert.strictEqual(value(conf('mod_ahbot.conf'), 'AuctionHouseBot.Enable'), 'false');
  assert.strictEqual(value(conf('playerbots.conf'), 'AiPlayerbot.Enabled'), '0');
  assert.strictEqual(value(conf('coa.conf'), 'CoA.RotationAssist.Enable'), '0');
  assert.strictEqual(value(conf('coa_custom_races.conf'), 'CoACustomRaces.Enable'), '0');
  assert.strictEqual(value(path.join(modules, 'mod_ahbot.conf'), 'AuctionHouseBot.Enable'), 'true');
  await realms.setModule(root, 'wildcard', 'ahbot', 'coa');
  assert.strictEqual(byId(await realms.modulesOf(root, 'wildcard')).ahbot, 'coa:on');
});

test('Reborn has no Manastorm: off even without its .conf (the module is on by default)', async () => {
  const root = repack();
  const dir = realmFolder(root, 'reborn');
  await realms.writeConfigs(root, 'reborn', JSON.parse(fs.readFileSync(path.join(dir, 'realm.json'), 'utf8')));
  assert.strictEqual(value(path.join(dir, 'configs', 'modules', 'manastorm-endless.conf'), 'Manastorm.Enable'), '0');
  assert.strictEqual(value(path.join(dir, 'configs', 'modules', 'coa.conf'), 'Ascension.Manastorm.Enable'), '0');
});

test('CoA left out of "Start all" only when asked and a realm starts with the server', async () => {
  const root = repack();
  assert.strictEqual(await realms.coaAutostart(root), true);
  await realms.setCoaAutostart(root, false);
  assert.strictEqual(await realms.skipCoaAtStart(root), false);
  realmFolder(root, 'wildcard', { autostart: true });
  assert.strictEqual(await realms.skipCoaAtStart(root), true);
  await realms.setCoaAutostart(root, true);
  assert.strictEqual(await realms.skipCoaAtStart(root), false);
});

test('no realm before CoA Bots 2.6: the tab stays hidden, nothing can be created', async () => {
  for (const version of ['2.0', '2.5']) {
    const root = repack({ version });
    const status = await realms.status(root, { live: false });
    assert.strictEqual(status.supported, false);
    assert.strictEqual(status.available, false);
    await assert.rejects(realms.create(root, 'wildcard'), /newer CoA Bots/);
  }
  const ready = await realms.status(repack({ version: '2.6' }), { live: false });
  assert.strictEqual(ready.available, true);
  assert.deepStrictEqual(['2.5', '2.6', '2.6-beta1', '2.10', ''].map(realms.versionReady), [false, true, true, true, false]);
});

test('a switched-off realm never starts, not even with the server', async () => {
  const root = repack();
  const dir = realmFolder(root, 'wildcard', { disabled: true, autostart: true });
  fs.mkdirSync(path.join(dir, 'configs'));
  fs.writeFileSync(path.join(dir, 'configs', 'worldserver.conf'), '');
  await assert.rejects(realms.start(root, 'wildcard'), /switched off/);
  assert.deepStrictEqual(await realms.startMarked(root), []);
  await realms.setCoaAutostart(root, false);
  assert.strictEqual(await realms.skipCoaAtStart(root), false);
  assert.strictEqual((await realms.status(root, { live: false })).realms[0].state, 'disabled');
});

test('start with the server: a realm waits its turn, and is left stopped when memory is too low', async () => {
  const root = repack();
  for (const key of ['wildcard', 'reborn']) {
    const dir = realmFolder(root, key, { autostart: true });
    fs.mkdirSync(path.join(dir, 'configs'));
    fs.writeFileSync(path.join(dir, 'configs', 'worldserver.conf'), '');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ 'playerbots.conf': { 'AiPlayerbot.MaxRandomBots': '150' } }));
  }
  await realms.queueMarked(root);
  let list = (await realms.status(root, { live: false })).realms;
  assert.deepStrictEqual(list.map(realm => `${realm.state}:${realm.after}`), ['queued:coa', 'queued:coa']);
  assert.strictEqual(list[0].firstStart, true);
  const failed = await realms.startMarked(root, { freeMb: () => 1000 });
  assert.deepStrictEqual(failed.map(item => item.error), ['memory', 'memory']);
  list = (await realms.status(root, { live: false })).realms;
  assert.deepStrictEqual(list.map(realm => realm.state), ['stopped', 'stopped']);
  assert.deepStrictEqual(list[0].skipped, { reason: 'memory', need: realms.neededMb(150), free: 1000 });
  assert.strictEqual(realms.neededMb(300), 6600);
});

test('bots in game of a realm come from its own status file, and only while it is fresh', () => {
  const root = repack();
  const logs = path.join(realmFolder(root, 'wildcard'), 'Logs');
  fs.mkdirSync(logs);
  fs.writeFileSync(path.join(logs, 'bot-status.json'), JSON.stringify({ at: Date.now() / 1000, bots: [{}, {}, {}] }));
  assert.strictEqual(realms.botsOnline(root, 'wildcard'), 3);
  fs.writeFileSync(path.join(logs, 'bot-status.json'), JSON.stringify({ at: Date.now() / 1000 - 3600, bots: [{}] }));
  assert.strictEqual(realms.botsOnline(root, 'wildcard'), null);
  assert.strictEqual(realms.botsOnline(root, 'reborn'), null);
});

test('home page figures: realms added up with CoA, or alone when CoA is stopped', () => {
  const live = require('../src/live.cjs');
  const wildcard = { key: 'wildcard', state: 'running', players: 2, online: 140, bots: 150, memory: 3e9, tick: 80, tickMean: 75 };
  const reborn = { key: 'reborn', state: 'running', players: 1, online: 100, bots: 150, memory: 2e9, tick: 60 };
  const off = { key: 'reborn', state: 'stopped', players: 9, memory: 9e9 };
  const coa = () => ({ running: true, players: 4, memory: 6e9, tick: 50, bots: { count: 300, inCombat: 5, target: 300 } });
  const both = live.withRealms(coa(), [wildcard, reborn]);
  assert.deepStrictEqual(both.realms, { count: 3, players: 7, bots: 540 });
  assert.strictEqual(both.memory, 11e9);
  assert.strictEqual(both.tick, 50);
  const alone = live.withRealms({ running: false }, [wildcard, off]);
  assert.strictEqual(alone.running, true);
  assert.strictEqual(alone.realmOnly, 'wildcard');
  assert.deepStrictEqual([alone.players, alone.bots.count, alone.bots.target, alone.memory, alone.tickMean], [2, 140, 150, 3e9, 75]);
  assert.strictEqual(alone.realms, null);
  assert.deepStrictEqual(live.withRealms({ running: false }, [off]), { running: false });
});

test('the bot tables shipped by CoA Bots are the ones a realm keeps in step with acore_playerbots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-'));
  const dir = path.join(root, 'CoA-Bots', 'Database', 'playerbots', 'custom');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.sql'), 'CREATE TABLE IF NOT EXISTS `playerbots_coa_wcr_enchants` (id INT);\nCREATE TABLE IF NOT EXISTS playerbots_custom_strategy_bak_v21 LIKE x;');
  fs.writeFileSync(path.join(dir, 'b.sql'), "DELETE FROM playerbots_custom_strategy WHERE 1;\nINSERT INTO `playerbots_coa_wcr_builds` VALUES (1);\nUPDATE characters SET x=1;");
  assert.deepEqual(realms.shippedTables(root).sort(), ['playerbots_coa_wcr_builds', 'playerbots_coa_wcr_enchants', 'playerbots_custom_strategy']);
});
