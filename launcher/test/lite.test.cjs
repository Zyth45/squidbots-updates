'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tempDir, write } = require('./helpers.cjs');
const { validate } = require('../src/config.cjs');
const support = require('../src/support.cjs');
const { BotsPackage } = require('../src/bots.cjs');
const { sanitize } = require('../src/settings.cjs');

const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'launcher.config.json'), 'utf8'));

test('the shipped configuration is valid, with the game, the server and the bots', () => {
  const config = validate(BASE);
  assert.equal(config.game.clientExecutable, 'Ascension.exe');
  assert.equal(config.game.realmlists[0].address, '127.0.0.1');
  assert.equal(config.server.bots.folder, 'CoA-Bots');
  assert.deepEqual(config.server.bots.install.args, ['-Repack', '{root}', '-NoAddon', '-NoDashboard']);
});

test('hostile configurations are refused', () => {
  const clone = () => structuredClone(BASE);
  const cases = [
    config => { config.game.manifestUrl = 'http://evil.example.com/latest.json'; },
    config => { config.server.bots.folder = '../../Windows'; },
    config => { config.server.bots.install.script = 'C:/Windows/System32/evil.ps1'; },
    config => { config.server.bots.install.args = ['-Repack', '..\\..']; },
    config => { config.game.clientExecutable = '..\\cmd.exe'; },
    config => { config.game.realmlists = [{ name: 'x', address: 'a b; c' }]; },
  ];
  for (const change of cases) { const config = clone(); change(config); assert.throws(() => validate(config)); }
  const discord = clone();
  discord.discordUrl = 'https://evil.example.com/';
  assert.equal(validate(discord).discordUrl, '', 'only discord.gg invites are kept');
});

test('settings keep a valid realmlist only', () => {
  assert.equal(sanitize({ realmlist: '192.168.1.20' }).realmlist, '192.168.1.20');
  assert.equal(sanitize({ realmlist: 'play.example.org:3725' }).realmlist, 'play.example.org:3725');
  assert.equal(sanitize({ realmlist: 'x"; del C:' }).realmlist, '');
  assert.deepEqual(sanitize({ installPaths: { game: 'C:\\Games\\CoA', 'bad key': 'C:\\x', server: 'relative' } }).installPaths, { game: path.normalize('C:\\Games\\CoA') });
});

test('the support report is a real zip and holds no password', async () => {
  const root = await tempDir();
  const game = path.join(root, 'game');
  const server = path.join(root, 'server');
  await write(game, { 'Errors/crash-1.txt': 'Crash at 0x1234', 'WTF/Config.wtf': 'SET accountName "ME"' });
  await write(server, { 'logs/launcher-world.log': 'started\nLoginDatabaseInfo = "127.0.0.1;3307;acore;SECRETPASS;acore_auth"\nready', 'Core/Logs/Errors.log': 'error one', 'mysql/admin-client.ini': 'password=SECRETPASS' });
  const zip = await support.buildReport({ summary: 'Launcher 0.1.0\nToken: abc123', gameRoot: game, serverRoot: server });
  const file = path.join(root, 'report.zip');
  await fsp.writeFile(file, zip);
  const listing = execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-tf', file], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  assert.deepEqual(listing.sort(), ['client/Errors/crash-1.txt', 'report.txt', 'server/Core/Logs/Errors.log', 'server/launcher/launcher-world.log'].sort());
  const out = path.join(root, 'out');
  await fsp.mkdir(out);
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', file, '-C', out]);
  const world = await fsp.readFile(path.join(out, 'server/launcher/launcher-world.log'), 'utf8');
  assert.match(world, /LoginDatabaseInfo = \[removed\]/);
  assert.equal(world.includes('SECRETPASS'), false);
  assert.match(await fsp.readFile(path.join(out, 'report.txt'), 'utf8'), /Token: \[removed\]/);
});

test('the bot installer runs from the package folder and its output is streamed', async () => {
  const root = await tempDir();
  await write(root, { 'CoA-Bots/Installer-Bots.ps1': 'param([string]$Repack)\nWrite-Host "==> Checking the repack"\nWrite-Host "repack: $Repack"\nexit 0\n', 'CoA-Bots/Fail.ps1': 'Write-Host "Not a CoA repack"\nexit 1\n' });
  const lines = [];
  const bots = new BotsPackage({ bots: { folder: 'CoA-Bots', manifestUrl: 'http://127.0.0.1:1/latest.json', requiredExecutable: 'Core/worldserver.exe', install: { script: 'Installer-Bots.ps1', args: ['-Repack', '{root}'], timeout: 60 } }, key: null, onLine: line => lines.push(line) });
  const result = await bots.runInstaller(root);
  assert.ok(result.ok);
  assert.ok(lines.includes('==> Checking the repack'));
  assert.ok(lines.some(line => line === `repack: ${path.resolve(root)}`));
  assert.match(fs.readFileSync(path.join(root, 'logs', 'launcher-bots-install.log'), 'utf8'), /Checking the repack/);
  bots.bots.install.script = 'Fail.ps1';
  await assert.rejects(bots.runInstaller(root), /Not a CoA repack/);
  bots.bots.install.script = '../outside.ps1';
  await assert.rejects(bots.runInstaller(root), /missing/);
});

test('stopping retries once when the repack script fails the first time', async () => {
  const { ServerControl } = require('../src/server-control.cjs');
  const root = await tempDir();
  await fsp.copyFile(process.execPath, path.join(root, 'runner.exe'));
  await write(root, { 'stop.js': "const fs=require('fs');const p=__dirname+'/tried';if(!fs.existsSync(p)){fs.writeFileSync(p,'1');console.log('ERROR: connection reset');process.exit(1)}console.log('All services stopped.')" });
  const control = new ServerControl({ root, services: [{ id: 'mysql', name: 'MySQL', port: 1, start: null }], commands: { stopAll: { exe: 'runner.exe', args: ['stop.js'], timeout: 30 } } });
  control.retryDelay = 50;
  await control.stopAll();
  assert.match(fs.readFileSync(path.join(root, 'logs', 'launcher-stop-all.log'), 'utf8'), /connection reset[\s\S]*All services stopped/);
  assert.equal(control.states.size, 0);
});

test('the red dot only lights up for a newer published core or bots release', async () => {
  const { isNewer, peekUpdates } = require('../src/updates.cjs');
  assert.equal(isNewer({ version: 'r5', publishedAt: '2026-09-29T10:00:00Z' }, { version: 'r6', publishedAt: '2026-09-30T10:00:00Z' }), true);
  assert.equal(isNewer({ version: 'r6', publishedAt: '2026-09-30T10:00:00Z' }, { version: 'r5', publishedAt: '2026-09-29T10:00:00Z' }), false, 'an older release is not an update');
  assert.equal(isNewer({ version: 'r5' }, { version: 'r5' }), false);
  assert.equal(isNewer(null, { version: 'r6' }), false, 'a folder the launcher never installed raises no flag');
  const updater = (installed, release) => ({ installedState: async () => installed, peek: async () => release });
  const repack = updater({ version: 'r5', publishedAt: '1' }, { version: 'r6', publishedAt: '2' });
  const bots = { info: async () => ({ installed: true }), folder: root => root + '/CoA-Bots', updater: updater({ version: 'b1', publishedAt: '1' }, { version: 'b1', publishedAt: '1' }) };
  assert.deepEqual(await peekUpdates({ folder: 'C:/x', repack, bots }), { core: 'r6', bots: null });
  const offline = { installedState: async () => ({ version: 'r5' }), peek: async () => { throw new Error('offline'); } };
  assert.deepEqual(await peekUpdates({ folder: 'C:/x', repack: offline, bots: null }), { core: null, bots: null });
  assert.deepEqual(await peekUpdates({ folder: '', repack, bots }), { core: null, bots: null });
});

test('two looks on the classic skin: abyss (default) and amber', () => {
  assert.equal(sanitize({}).theme, 'abyss');
  assert.equal(sanitize({ theme: 'classic' }).theme, 'classic');
  assert.equal(sanitize({ theme: 'abyss' }).theme, 'abyss');
  assert.equal(sanitize({ theme: 'forge' }).theme, 'abyss');
  assert.equal(sanitize({ theme: '../evil' }).theme, 'abyss');
});

test('updates-only mode: the base game link must be HTTPS', () => {
  const config = structuredClone(BASE);
  config.game.updatesOnly = true;
  config.game.baseClient = { url: 'https://drive.proton.me/urls/EXAMPLE', note: { fr: 'Client de base' } };
  const valid = validate(config);
  assert.equal(valid.game.updatesOnly, true);
  assert.equal(valid.game.baseClient.url, 'https://drive.proton.me/urls/EXAMPLE');
  config.game.baseClient.url = 'http://127.0.0.1/client.zip';
  assert.throws(() => validate(config), /HTTPS/);
  assert.equal(validate(BASE).game.updatesOnly, false);
});

test('stable and test channels: optional test addresses, validated like the others', () => {
  const config = structuredClone(BASE);
  config.server.testManifestUrl = 'https://updates.example.com/test/repack/latest.json';
  config.server.bots.testManifestUrl = 'https://updates.example.com/test/bots/latest.json';
  delete config.game.testManifestUrl;
  const valid = validate(config);
  assert.equal(valid.server.testManifestUrl, config.server.testManifestUrl);
  assert.equal(valid.server.bots.testManifestUrl, config.server.bots.testManifestUrl);
  assert.equal(valid.game.testManifestUrl, '');
  config.game.testManifestUrl = 'http://evil.example.com/latest.json';
  assert.throws(() => validate(config), /HTTPS/);
  assert.equal(sanitize({}).channel, 'stable');
  assert.equal(sanitize({ channel: 'test' }).channel, 'test');
  assert.equal(sanitize({ channel: 'nightly' }).channel, 'stable');
});

test('the server edition starts without a bots channel (bots come with the repack updates)', () => {
  const { loadConfig } = require('../src/config.cjs');
  const { BotsPackage } = require('../src/bots.cjs');
  const config = loadConfig(require('node:path').join(__dirname, '../editions/server/launcher.config.json'));
  assert.equal(config.server.bots.manifestUrl, '');
  const bots = new BotsPackage({ bots: { ...config.server.bots, channelUrl: '' }, key: config.keys.bots });
  assert.equal(bots.updater.busy, false);
});
