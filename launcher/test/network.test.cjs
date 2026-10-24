'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const network = require('../src/network.cjs');

function repack({ bind = '127.0.0.1', address = '127.0.0.1', name = 'AzerothCore' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'net-'));
  fs.mkdirSync(path.join(root, 'Settings'));
  fs.mkdirSync(path.join(root, 'Scripts'));
  for (const file of ['authserver', 'worldserver']) fs.writeFileSync(path.join(root, 'Settings', `${file}.conf.template`), `# BindIP\nBindIP = "${bind}"\n`);
  fs.writeFileSync(path.join(root, 'Scripts', 'manage.py'), `        mysql(f"UPDATE acore_auth.realmlist SET name='${name}',address='${address}',"\n`);
  return root;
}
const read = (root, file) => fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');

test('a server opened by hand is shown as it is and never rewritten before a start', async () => {
  const root = repack({ bind: '0.0.0.0', address: 'play.example.org', name: 'My Realm' });
  const seen = await network.readNetwork(root);
  assert.deepEqual(seen, { mode: 'open', address: 'play.example.org', name: 'My Realm', chosen: false });
  assert.deepEqual(await network.applyNetwork(root), []);
  assert.match(read(root, 'Settings/authserver.conf.template'), /BindIP = "0.0.0.0"/);
  assert.match(read(root, 'Scripts/manage.py'), /name='My Realm',address='play.example.org'/);
});

test('a choice saved in the launcher is applied again after an update put the files back', async () => {
  const root = repack();
  await network.saveNetwork(root, { mode: 'open', address: '192.168.1.83', name: 'Squid' });
  fs.writeFileSync(path.join(root, 'Scripts', 'manage.py'), `        mysql(f"UPDATE acore_auth.realmlist SET name='AzerothCore',address='127.0.0.1',"\n`);
  assert.deepEqual(await network.applyNetwork(root), ['Scripts/manage.py']);
  assert.match(read(root, 'Scripts/manage.py'), /name='Squid',address='192.168.1.83'/);
  assert.match(read(root, 'Settings/worldserver.conf.template'), /BindIP = "0.0.0.0"/);
});

test('the remote console stays on this PC, and no temporary file is left', async () => {
  const root = repack();
  fs.appendFileSync(path.join(root, 'Settings', 'worldserver.conf.template'), 'Ra.IP = "0.0.0.0"\n');
  await network.saveNetwork(root, { mode: 'open', address: '192.168.1.83', name: 'Squid' });
  assert.match(read(root, 'Settings/worldserver.conf.template'), /Ra\.IP = "127\.0\.0\.1"/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'Settings')).filter(name => name.includes('.tmp-')), []);
});
