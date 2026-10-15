'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { ClientUpdater } = require('../src/client-updater.cjs');
const { Journal } = require('../src/journal.cjs');
const { publicKey } = require('../src/signing.cjs');
const { tempDir, keys, write, publish, serve, read, exists } = require('./helpers.cjs');

const signing = keys();
const key = publicKey(signing.publicRaw);

async function setup(files, options = {}) {
  const releases = await tempDir();
  const game = await tempDir();
  await publish(releases, options.version || 'v1', files, { key: signing.privateKey, components: options.components });
  const server = await serve(releases, options.hooks);
  const updater = new ClientUpdater({ manifestUrl: `${server.url}latest.json`, requiredExecutable: 'Wow.exe', publicKey: key, ...options.updater });
  return { releases, game, server, updater };
}

test('fresh install, then nothing to do', async t => {
  const { game, server, updater } = await setup({ 'Wow.exe': 'exe-1', 'Data/a.MPQ': 'aaaa', 'Data/enUS/b.MPQ': 'bbbb' });
  t.after(server.close);
  const check = await updater.check(game);
  assert.equal(check.needsUpdate, true);
  assert.equal(check.files, 3);
  assert.equal(check.signed, true);
  await updater.update(game);
  assert.equal(read(game, 'Data/enUS/b.MPQ'), 'bbbb');
  assert.equal((await updater.check(game)).needsUpdate, false);
  assert.equal(await updater.installedVersion(game), 'v1');
  assert.equal(exists(game, '.coa-launcher/client/journal.json'), false);
});

test('identical files are downloaded once and installed at every path', async t => {
  const same = Buffer.alloc(200000, 3);
  const { game, server, updater } = await setup({ 'Wow.exe': 'exe', 'A/x.dll': same, 'B/x.dll': same, 'C/x.dll': same, 'D/x.dll': same, 'E/x.dll': same, 'empty.txt': '', 'Logs2/empty.txt': '' });
  t.after(server.close);
  await updater.update(game);
  assert.equal(read(game, 'Logs2/empty.txt'), '', 'empty files are fine too');
  for (const folder of 'ABCDE') assert.equal(fs.readFileSync(path.join(game, folder, 'x.dll')).length, same.length);
  assert.equal(server.log.filter(entry => entry.url.includes(require('./helpers.cjs').sha(same))).length, 1);
});

test('update replaces, adds and removes only what changed, keeps player files', async t => {
  const { releases, game, server, updater } = await setup({ 'Wow.exe': 'exe-1', 'Data/a.MPQ': 'aaaa', 'old.dll': 'old' });
  t.after(server.close);
  await updater.update(game);
  await write(game, { 'WTF/Config.wtf': 'SET gxResolution "1920x1080"', 'Interface/AddOns/Mine/Mine.toc': '## Title: Mine', 'Screenshots/a.jpg': 'pic' });
  await publish(releases, 'v2', { 'Wow.exe': 'exe-2', 'Data/a.MPQ': 'aaaa', 'Data/new.MPQ': 'new' }, { key: signing.privateKey });
  server.log.length = 0;
  const check = await updater.check(game);
  assert.deepEqual([check.files, check.removed], [2, 1]);
  await updater.update(game);
  assert.equal(read(game, 'Wow.exe'), 'exe-2');
  assert.equal(read(game, 'Data/new.MPQ'), 'new');
  assert.equal(exists(game, 'old.dll'), false);
  assert.equal(read(game, 'WTF/Config.wtf'), 'SET gxResolution "1920x1080"');
  assert.equal(exists(game, 'Interface/AddOns/Mine/Mine.toc'), true);
  assert.equal(exists(game, 'Screenshots/a.jpg'), true);
  assert.equal(server.log.filter(entry => entry.url.includes('/objects/')).length, 2, 'only the two changed files are downloaded');
});

test('a file modified by the player is repaired, an obsolete modified file is kept', async t => {
  const { releases, game, server, updater } = await setup({ 'Wow.exe': 'exe-1', 'Data/a.MPQ': 'aaaa', 'tool.exe': 'tool' });
  t.after(server.close);
  await updater.update(game);
  fs.writeFileSync(path.join(game, 'Data', 'a.MPQ'), 'corrupted');
  fs.writeFileSync(path.join(game, 'tool.exe'), 'my own version');
  await publish(releases, 'v2', { 'Wow.exe': 'exe-1', 'Data/a.MPQ': 'aaaa' }, { key: signing.privateKey });
  const check = await updater.check(game, { force: true });
  assert.equal(check.files, 1);
  assert.deepEqual(check.kept, ['tool.exe']);
  await updater.update(game, { force: true });
  assert.equal(read(game, 'Data/a.MPQ'), 'aaaa');
  assert.equal(read(game, 'tool.exe'), 'my own version');
});

test('a tampered manifest or a wrong signature is refused', async t => {
  const { releases, game, server, updater } = await setup({ 'Wow.exe': 'exe-1' });
  t.after(server.close);
  const manifest = JSON.parse(fs.readFileSync(path.join(releases, 'latest.json'), 'utf8'));
  manifest.files[0].sha256 = 'f'.repeat(64);
  fs.writeFileSync(path.join(releases, 'latest.json'), JSON.stringify(manifest));
  await assert.rejects(updater.check(game), /signature is invalid/);
  fs.rmSync(path.join(releases, 'latest.json.sig'));
  await assert.rejects(updater.check(game), /signature is invalid/);
});

test('a manifest cannot write player files or escape the folder', async t => {
  for (const bad of ['WTF/Config.wtf', 'Interface/AddOns/X/x.lua', '../evil.exe', 'Data/enUS/realmlist.wtf', 'C:/Windows/evil.dll', 'Data/con.MPQ']) {
    const { game, server, updater } = await setup({ 'Wow.exe': 'exe', [bad]: 'x' });
    await assert.rejects(updater.check(game), /Invalid|Unsafe|protected/, bad);
    await server.close();
  }
  t.diagnostic('protected and unsafe paths refused');
});

test('optional components are installed when ticked and removed when unticked', async t => {
  const components = [{ id: 'hd', name: 'HD', default: false }];
  const { game, server, updater } = await setup({ 'Wow.exe': 'exe', 'Data/patch-HD.MPQ': { content: 'hd-textures', component: 'hd' } }, { components });
  t.after(server.close);
  await updater.update(game);
  assert.equal(exists(game, 'Data/patch-HD.MPQ'), false, 'not installed by default');
  await updater.update(game, { components: { hd: true } });
  assert.equal(read(game, 'Data/patch-HD.MPQ'), 'hd-textures');
  const check = await updater.check(game, { components: { hd: false } });
  assert.equal(check.removed, 1);
  await updater.update(game, { components: { hd: false } });
  assert.equal(exists(game, 'Data/patch-HD.MPQ'), false);
});

test('an interrupted download resumes with HTTP Range', async t => {
  const big = Buffer.alloc(3 * 1024 * 1024, 7);
  let cut = true;
  const { game, server, updater } = await setup({ 'Wow.exe': 'exe', 'Data/big.MPQ': big });
  t.after(server.close);
  const objectName = require('./helpers.cjs').sha(big);
  // Leave a half-downloaded part file as if the launcher had been closed mid-download.
  const part = path.join(game, '.coa-launcher', 'client', 'downloads', `${objectName}.part`);
  await fsp.mkdir(path.dirname(part), { recursive: true });
  await fsp.writeFile(part, big.subarray(0, 1024 * 1024));
  cut = false;
  await updater.update(game);
  assert.ok(!cut);
  assert.ok(server.log.some(entry => entry.url.endsWith(objectName) && entry.range === `bytes=${1024 * 1024}-`), 'resumed from 1 MB');
  assert.equal(fs.readFileSync(path.join(game, 'Data', 'big.MPQ')).length, big.length);
});

test('a corrupted download is detected and fetched again', async t => {
  let first = true;
  const { releases, game, server, updater } = await setup({ 'Wow.exe': 'exe', 'Data/a.MPQ': 'good-content' }, {
    hooks: { before: () => null },
  });
  t.after(server.close);
  // First request for the object serves garbage of the right size.
  const object = fs.readdirSync(path.join(releases, 'objects')).find(name => fs.readFileSync(path.join(releases, 'objects', name), 'utf8') === 'good-content');
  const real = fs.readFileSync(path.join(releases, 'objects', object));
  fs.writeFileSync(path.join(releases, 'objects', object), 'bad-content!');
  setTimeout(() => { if (first) { first = false; fs.writeFileSync(path.join(releases, 'objects', object), real); } }, 100);
  await updater.update(game);
  assert.equal(read(game, 'Data/a.MPQ'), 'good-content');
});

test('a crash in the middle of applying is rolled back on the next start', async t => {
  const { releases, game, server, updater } = await setup({ 'Wow.exe': 'exe-1', 'Data/a.MPQ': 'a-1', 'Data/b.MPQ': 'b-1' });
  t.after(server.close);
  await updater.update(game);
  // Simulate power loss after the first file of v2 was swapped in.
  const journal = new Journal(game, 'client');
  const staged = path.join(game, 'new-a.tmp');
  fs.writeFileSync(staged, 'a-2');
  const originalRename = fsp.rename;
  let swaps = 0;
  fsp.rename = async (from, to) => {
    if (String(to).endsWith(path.join('Data', 'b.MPQ')) && ++swaps === 1) throw Object.assign(new Error('power loss'), { code: 'EIO' });
    return originalRename(from, to);
  };
  try {
    await assert.rejects(journal.apply([{ path: 'Data/a.MPQ', source: staged }, { path: 'Data/b.MPQ', source: staged }], { stateFile: 'state.json', previous: null, commit: async () => {} }), /power loss/);
  } finally { fsp.rename = originalRename; }
  assert.equal(read(game, 'Data/a.MPQ'), 'a-1', 'first file restored');
  assert.equal(read(game, 'Data/b.MPQ'), 'b-1');
  assert.equal(exists(game, '.coa-launcher/client/journal.json'), false);
  await publish(releases, 'v1', { 'Wow.exe': 'exe-1', 'Data/a.MPQ': 'a-1', 'Data/b.MPQ': 'b-1' }, { key: signing.privateKey });
  assert.equal((await updater.check(game, { force: true })).needsUpdate, false);
});

test('server profile: preserved configuration and seeded database are never overwritten', async t => {
  const releases = await tempDir();
  const root = await tempDir();
  const files = { 'Core/worldserver.exe': 'world-1', 'Core/configs/worldserver.conf': { content: 'default conf', preserve: true }, 'mysql/data/ibdata1': { content: 'fresh db', preserve: true } };
  await publish(releases, 'r1', files, { key: signing.privateKey });
  const server = await serve(releases);
  t.after(server.close);
  const updater = new ClientUpdater({ manifestUrl: `${server.url}latest.json`, requiredExecutable: 'Core/worldserver.exe', publicKey: key, rules: 'server', area: 'repack' });
  await updater.update(root);
  assert.equal(read(root, 'mysql/data/ibdata1'), 'fresh db', 'seed installed on a fresh install');
  fs.writeFileSync(path.join(root, 'mysql', 'data', 'ibdata1'), 'players progress');
  fs.writeFileSync(path.join(root, 'Core', 'configs', 'worldserver.conf'), 'my settings');
  await publish(releases, 'r2', { ...files, 'Core/worldserver.exe': 'world-2', 'Core/configs/worldserver.conf': { content: 'new default', preserve: true }, 'mysql/data/ibdata1': { content: 'new fresh db', preserve: true } }, { key: signing.privateKey });
  await updater.update(root);
  assert.equal(read(root, 'Core/worldserver.exe'), 'world-2');
  assert.equal(read(root, 'Core/configs/worldserver.conf'), 'my settings');
  assert.equal(read(root, 'mysql/data/ibdata1'), 'players progress');
  // A release that tries to ship the database without preserve is refused outright.
  await publish(releases, 'r3', { 'Core/worldserver.exe': 'world-3', 'mysql/data/ibdata1': 'wipe' }, { key: signing.privateKey });
  await assert.rejects(updater.check(root), /protected/);
});

test('an older signed release (replayed, or stable after test) is never installed', async t => {
  const { releases, game, server, updater } = await setup({ 'Wow.exe': 'exe-1' });
  t.after(server.close);
  await publish(releases, 'v2', { 'Wow.exe': 'exe-2' }, { key: signing.privateKey, publishedAt: '2030-01-02T00:00:00Z' });
  await updater.update(game);
  await publish(releases, 'v1', { 'Wow.exe': 'exe-1' }, { key: signing.privateKey, publishedAt: '2030-01-01T00:00:00Z' });
  const check = await updater.check(game);
  assert.equal(check.needsUpdate, false);
  assert.equal(check.ahead, 'v2');
  await updater.update(game);
  assert.equal(read(game, 'Wow.exe'), 'exe-2');
  assert.equal(await updater.installedVersion(game), 'v2', 'the newer release stays recorded');
});

test('Windows short names cannot reach protected folders', () => {
  const { checkPath } = require('../src/release-format.cjs');
  for (const value of ['INTERF~1/AddOns/x.lua', 'REALML~1.WTF', 'Data/enUS/REALML~1.WTF']) assert.throws(() => checkPath(value), /Unsafe path/);
  assert.equal(checkPath('Data/patch-A.MPQ'), 'Data/patch-A.MPQ');
});

test('a repack database seed is installed once, then never compared again (MySQL renames its files)', async t => {
  const releases = await tempDir();
  const game = await tempDir();
  await publish(releases, 'r1', { 'Core/worldserver.exe': 'exe', 'mysql/data/#innodb_redo/#ib_redo1': { content: 'redo-1', preserve: true }, 'mysql/data/ibdata1': { content: 'data', preserve: true } }, { key: signing.privateKey });
  const server = await serve(releases);
  t.after(server.close);
  const updater = new ClientUpdater({ manifestUrl: `${server.url}latest.json`, requiredExecutable: 'Core/worldserver.exe', publicKey: key, rules: 'server', area: 'repack' });
  await updater.update(game);
  assert.equal(read(game, 'mysql/data/#innodb_redo/#ib_redo1'), 'redo-1');
  // MySQL ran: it rotated its redo log and changed its data file.
  fs.renameSync(path.join(game, 'mysql/data/#innodb_redo/#ib_redo1'), path.join(game, 'mysql/data/#innodb_redo/#ib_redo2'));
  fs.writeFileSync(path.join(game, 'mysql/data/ibdata1'), 'live data');
  const check = await updater.check(game);
  assert.equal(check.needsUpdate, false);
  await updater.update(game, { force: true });
  assert.equal(exists(game, 'mysql/data/#innodb_redo/#ib_redo1'), false, 'the old redo file is not put back');
  assert.equal(read(game, 'mysql/data/ibdata1'), 'live data');
});

test('an existing game folder (never seen by the launcher) only downloads what differs', async t => {
  const big = Buffer.alloc(300000, 7);
  const { game, server, updater } = await setup({ 'Wow.exe': 'exe-2', 'Data/common.MPQ': big, 'Data/patch-A.MPQ': 'new patch', 'Extensions.dll': 'dll-2' });
  t.after(server.close);
  // The player's own copy: same big archive, an old patch, an old DLL, and no .coa-launcher folder at all.
  await write(game, { 'Wow.exe': 'exe-2', 'Data/common.MPQ': big, 'Data/patch-A.MPQ': 'old patch', 'WTF/Config.wtf': 'SET realmList "old"' });
  const check = await updater.check(game);
  assert.deepEqual([check.files, check.removed], [2, 0], 'only the changed patch and the missing DLL');
  server.log.length = 0;
  await updater.update(game);
  const fetched = server.log.filter(entry => entry.url.includes('/objects/'));
  assert.equal(fetched.length, 2);
  assert.equal(fetched.some(entry => entry.url.includes(require('./helpers.cjs').sha(big))), false, 'the 300 KB archive already there is not downloaded again');
  assert.equal(read(game, 'Data/patch-A.MPQ'), 'new patch');
  assert.equal(read(game, 'WTF/Config.wtf'), 'SET realmList "old"', 'player settings untouched');
});

test('updates only: a release of changed files is accepted and leaves the rest of the game alone', async t => {
  const patch = { 'Data/patch-Z.MPQ': 'new-patch', 'Data/enUS/patch-enUS-Z.MPQ': 'new-locale' };
  const plain = await setup(patch);
  t.after(plain.server.close);
  await assert.rejects(plain.updater.check(plain.game), /does not contain Wow\.exe/, 'a full-game launcher still refuses a release without the executable');
  const { game, server, updater } = await setup(patch, { updater: { updatesOnly: true } });
  t.after(server.close);
  await write(game, { 'Wow.exe': 'players-own-exe', 'Data/common.MPQ': 'base-game', 'Data/patch-Z.MPQ': 'old-patch' });
  const check = await updater.check(game);
  assert.equal(check.files, 2, 'only the changed and the new file are offered');
  await updater.update(game);
  assert.equal(read(game, 'Data/patch-Z.MPQ'), 'new-patch');
  assert.equal(read(game, 'Data/enUS/patch-enUS-Z.MPQ'), 'new-locale');
  assert.equal(read(game, 'Wow.exe'), 'players-own-exe', 'files outside the release are never touched');
  assert.equal(read(game, 'Data/common.MPQ'), 'base-game');
  assert.equal((await updater.check(game)).needsUpdate, false);
});

test('retired addons of the base game are moved aside once, never deleted, and never again', async t => {
  const releases = await tempDir();
  const game = await tempDir();
  await publish(releases, 'r1', { 'Data/patch-Z.MPQ': 'z' }, { key: signing.privateKey });
  // The helper does not write "retire": add it and sign again.
  const manifest = JSON.parse(fs.readFileSync(path.join(releases, 'latest.json'), 'utf8'));
  manifest.retire = ['Interface/AddOns/ElvUI', 'Interface/AddOns/Blizzard_TalentUI', 'Interface/AddOns/NotThere'];
  const signed = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(path.join(releases, 'latest.json'), signed);
  fs.writeFileSync(path.join(releases, 'latest.json.sig'), require('node:crypto').sign(null, signed, signing.privateKey).toString('base64'));
  const server = await serve(releases);
  t.after(server.close);
  const updater = new ClientUpdater({ manifestUrl: `${server.url}latest.json`, requiredExecutable: 'Wow.exe', publicKey: key, updatesOnly: true });
  await write(game, { 'Wow.exe': 'exe', 'Interface/AddOns/ElvUI/ElvUI.toc': 'elv', 'Interface/AddOns/Blizzard_TalentUI/x.lua': 'old', 'Interface/AddOns/SquidBotsLite/SquidBotsLite.toc': 'squid' });
  const check = await updater.check(game);
  assert.equal(check.needsUpdate, true);
  assert.deepEqual(check.retire.sort(), ['Blizzard_TalentUI', 'ElvUI']);
  await updater.update(game);
  assert.equal(exists(game, 'Interface/AddOns/ElvUI'), false);
  assert.equal(read(game, 'Retired addons/ElvUI/ElvUI.toc'), 'elv', 'moved, not deleted');
  assert.equal(read(game, 'Retired addons/Blizzard_TalentUI/x.lua'), 'old');
  assert.equal(read(game, 'Interface/AddOns/SquidBotsLite/SquidBotsLite.toc'), 'squid', 'other addons are left alone');
  // The player puts ElvUI back: the launcher leaves it there from now on.
  await write(game, { 'Interface/AddOns/ElvUI/ElvUI.toc': 'elv-again' });
  assert.equal((await updater.check(game)).needsUpdate, false);
  await updater.update(game);
  assert.equal(read(game, 'Interface/AddOns/ElvUI/ElvUI.toc'), 'elv-again');
});

test('a release can only retire addon folders', () => {
  const { validateManifest } = require('../src/release-format.cjs');
  const base = { schema: 1, version: 'v', files: [{ path: 'Wow.exe', size: 1, sha256: 'a'.repeat(64) }] };
  for (const bad of ['WTF', 'Interface/AddOns', 'Interface/AddOns/../../WTF', 'Data/patch-A.MPQ', 'Interface/AddOns/A/B', 'C:/x']) {
    assert.throws(() => validateManifest({ ...base, retire: [bad] }, 'Wow.exe'), undefined, bad);
  }
  assert.deepEqual(validateManifest({ ...base, retire: ['Interface/AddOns/ElvUI_OptionsUI'] }, 'Wow.exe').retire, ['Interface/AddOns/ElvUI_OptionsUI']);
});

test('a file already in the folder under another name is reused, not downloaded', async t => {
  const releases = await tempDir();
  const game = await tempDir();
  const big = Buffer.alloc(300000, 7);
  await publish(releases, 'r1', { 'Data/patch-WB1.MPQ': big, 'Data/patch-Q.MPQ': 'q' }, { key: signing.privateKey });
  const manifest = JSON.parse(fs.readFileSync(path.join(releases, 'latest.json'), 'utf8'));
  manifest.files.find(file => file.path === 'Data/patch-WB1.MPQ').alt = ['Data/patch-WB1.MPQ.DISABLED'];
  manifest.files.find(file => file.path === 'Data/patch-Q.MPQ').alt = ['Data/patch-Q.MPQ.DISABLED'];
  const signed = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(path.join(releases, 'latest.json'), signed);
  fs.writeFileSync(path.join(releases, 'latest.json.sig'), require('node:crypto').sign(null, signed, signing.privateKey).toString('base64'));
  const server = await serve(releases);
  t.after(server.close);
  const updater = new ClientUpdater({ manifestUrl: `${server.url}latest.json`, requiredExecutable: 'Wow.exe', publicKey: key, updatesOnly: true });
  // The disabled copy of WB1 is the right file; the one of Q is not (it must be downloaded).
  await write(game, { 'Wow.exe': 'exe', 'Data/patch-WB1.MPQ.DISABLED': big, 'Data/patch-Q.MPQ.DISABLED': 'z' });
  const check = await updater.check(game);
  assert.equal(check.files, 2);
  assert.equal(check.reused, 1);
  assert.equal(check.bytes, 1, 'only patch-Q is downloaded');
  await updater.update(game);
  assert.deepEqual(fs.readFileSync(path.join(game, 'Data', 'patch-WB1.MPQ')), big);
  assert.equal(read(game, 'Data/patch-Q.MPQ'), 'q');
  assert.deepEqual(fs.readFileSync(path.join(game, 'Data', 'patch-WB1.MPQ.DISABLED')), big, 'the original copy is left as it was');
  assert.equal(server.log.some(entry => entry.url.includes(manifest.files.find(file => file.path === 'Data/patch-WB1.MPQ').sha256)), false, 'WB1 was never requested');
  assert.equal((await updater.check(game)).needsUpdate, false);
});

test('compressed objects (.gz) are downloaded, unpacked and verified; a bad one is refused', async t => {
  const zlib = require('node:zlib');
  const crypto = require('node:crypto');
  const releases = await tempDir();
  const game = await tempDir();
  const big = Buffer.alloc(400000, 'a');
  await publish(releases, 'r1', { 'Wow.exe': 'exe', 'Data/big.MPQ': big }, { key: signing.privateKey });
  const manifest = JSON.parse(fs.readFileSync(path.join(releases, 'latest.json'), 'utf8'));
  const entry = manifest.files.find(file => file.path === 'Data/big.MPQ');
  const packed = zlib.gzipSync(big);
  fs.writeFileSync(path.join(releases, 'objects', `${entry.sha256}.gz`), packed);
  fs.unlinkSync(path.join(releases, 'objects', entry.sha256)); // only the .gz is there: it must be the one used
  entry.gz = packed.length;
  const sign = () => { const bytes = Buffer.from(JSON.stringify(manifest)); fs.writeFileSync(path.join(releases, 'latest.json'), bytes); fs.writeFileSync(path.join(releases, 'latest.json.sig'), crypto.sign(null, bytes, signing.privateKey).toString('base64')); };
  sign();
  const server = await serve(releases);
  t.after(server.close);
  const updater = new ClientUpdater({ manifestUrl: `${server.url}latest.json`, requiredExecutable: 'Wow.exe', publicKey: key });
  const check = await updater.check(game);
  assert.ok(check.bytes < 10000, 'the size shown is the compressed one');
  await updater.update(game);
  assert.deepEqual(fs.readFileSync(path.join(game, 'Data', 'big.MPQ')), big);
  // A .gz that unpacks to something else is refused.
  const other = await tempDir();
  fs.writeFileSync(path.join(releases, 'objects', `${entry.sha256}.gz`), zlib.gzipSync(Buffer.alloc(400000, 'b')));
  entry.gz = fs.statSync(path.join(releases, 'objects', `${entry.sha256}.gz`)).size;
  sign();
  await assert.rejects(updater.update(other), /verification/);
  assert.equal(exists(other, 'Data/big.MPQ'), false);
});
