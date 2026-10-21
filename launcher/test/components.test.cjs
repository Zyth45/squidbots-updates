'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const components = require('../src/components.cjs');

const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'comp-'));
function write(root, files) { for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); } }
function zipOf(files, top) { const src = tmp(); write(src, files); const zip = path.join(tmp(), 'c.zip'); execFileSync(tar, ['-a', '-cf', zip, '-C', src, ...top]); return zip; }
function serve(file) {
  return new Promise(resolve => { const server = http.createServer((req, res) => { const data = fs.readFileSync(file); res.writeHead(200, { 'Content-Length': data.length }); res.end(data); }).listen(0, '127.0.0.1', () => resolve(server)); });
}
const offerOf = async (name, zip, version) => {
  const server = await serve(zip);
  const data = fs.readFileSync(zip);
  return { server, offer: { name, version, url: `http://127.0.0.1:${server.address().port}/c.zip`, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length } };
};

test('a component is offered only when newer, never a beta', () => {
  const root = tmp();
  write(root, { 'CoA-Bots/Client/Interface/AddOns/SquidBotsLite/SquidBotsLite.toc': '## Version: 2.4\n', 'CoA-Bots/Tools/Dashboard/index.html': 'x' });
  const list = components.status(root, { addon: { version: '2.5' }, dashboard: { version: '2.2.2' } });
  assert.deepEqual(list.map(item => [item.name, item.installed, item.available]), [['addon', '2.4', true], ['dashboard', '0', true]]);
  assert.equal(components.status(root, { addon: { version: '2.4' } })[0].available, false);
  const base = { name: 'addon', url: 'https://example.org/a.zip', sha256: 'a'.repeat(64), size: 1 };
  assert.throws(() => components.clean('addon', { ...base, version: '2.6-beta' }));
  assert.equal(components.clean('addon', { ...base, version: '2.6' }).version, '2.6');
});

test('the dashboard is copied over its folder: the player data stays, the old files are kept aside', async () => {
  const root = tmp();
  write(root, { 'CoA-Bots/Tools/Dashboard/index.html': 'old', 'CoA-Bots/Tools/Dashboard/dashboard.json': '{"mine":1}', 'CoA-Bots/Tools/Dashboard/maps/a.png': 'map' });
  const zip = zipOf({ 'VERSION': '2.2.2\n', 'index.html': 'new' }, ['VERSION', 'index.html']);
  const { server, offer } = await offerOf('dashboard', zip, '2.2.2');
  const backupDir = tmp();
  try { assert.equal(await components.install(root, offer, { cacheDir: tmp(), backupDir, fetchImpl: fetch }), '2.2.2'); } finally { server.close(); }
  const dir = path.join(root, 'CoA-Bots/Tools/Dashboard');
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(dir, 'dashboard.json'), 'utf8'), '{"mine":1}');
  assert.ok(fs.existsSync(path.join(dir, 'maps/a.png')));
  const kept = fs.readdirSync(backupDir)[0];
  assert.equal(fs.readFileSync(path.join(backupDir, kept, 'index.html'), 'utf8'), 'old');
});

test('the addon folder is replaced as a whole (a removed file goes away)', async () => {
  const root = tmp();
  write(root, { 'CoA-Bots/Client/Interface/AddOns/SquidBotsLite/SquidBotsLite.toc': '## Version: 2.4\n', 'CoA-Bots/Client/Interface/AddOns/SquidBotsLite/Old.lua': 'gone' });
  const zip = zipOf({ 'SquidBotsLite/SquidBotsLite.toc': '## Version: 2.5\n', 'SquidBotsLite/SquidBotsLite.lua': 'x' }, ['SquidBotsLite']);
  const { server, offer } = await offerOf('addon', zip, '2.5');
  try { assert.equal(await components.install(root, offer, { cacheDir: tmp(), backupDir: tmp(), fetchImpl: fetch }), '2.5'); } finally { server.close(); }
  assert.ok(!fs.existsSync(path.join(root, 'CoA-Bots/Client/Interface/AddOns/SquidBotsLite/Old.lua')));
});

test('an addon for a newer CoA Bots waits: shown, never installed on an older server', () => {
  const root = tmp();
  write(root, { 'CoA-Bots/Client/Interface/AddOns/SquidBotsLite/SquidBotsLite.toc': '## Version: 2.6\n', 'CoA-Bots/release.json': JSON.stringify({ version: '2.5' }) });
  const offer = components.clean('addon', { name: 'addon', version: '2.6.1', url: 'https://x.test/a.zip', sha256: 'a'.repeat(64), size: 10, minBots: '2.6' });
  assert.equal(offer.minBots, '2.6');
  let item = components.status(root, { addon: offer })[0];
  assert.deepEqual([item.available, item.waiting], [false, { minBots: '2.6', bots: '2.5' }]);
  assert.equal(components.blocker(root, offer), 'bots');
  write(root, { 'CoA-Bots/release.json': JSON.stringify({ version: '2.6' }) });
  item = components.status(root, { addon: offer })[0];
  assert.deepEqual([item.available, item.waiting], [true, null]);
  write(root, { 'CoA-Bots/release.json': JSON.stringify({ version: '2.7-beta1' }) });
  assert.equal(components.blocker(root, offer), '');
  write(root, { 'CoA-Bots/release.json': '' });
  assert.equal(components.blocker(root, offer), 'bots');
  assert.equal(components.blocker(root, { ...offer, minBots: '' }), '');
});
