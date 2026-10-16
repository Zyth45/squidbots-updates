'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { realmlistStatus, configureRealmlist } = require('../src/game.cjs');

function client(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-'));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}
const ours = { hosts: ['127.0.0.1', 'localhost', '192.168.1.83'], port: 3730 };

test('a game on another server is reported, then pointed at ours with Config.wtf', async () => {
  const root = client({ 'Data/enUS/realmlist.wtf': 'set realmlist logon.example.org\r\n', 'WTF/Config.wtf': 'SET locale "enUS"\r\nSET realmList "logon.example.org"\r\n' });
  const before = await realmlistStatus(root, ours);
  assert.equal(before.state, 'wrong');
  assert.equal(before.expected, '127.0.0.1:3730');
  assert.deepEqual(before.files.map(item => item.file), ['WTF/Config.wtf', 'Data/enUS/realmlist.wtf']);
  await configureRealmlist(root, before.expected);
  const after = await realmlistStatus(root, ours);
  assert.equal(after.state, 'ok');
  assert.match(fs.readFileSync(path.join(root, 'WTF/Config.wtf'), 'utf8'), /SET locale "enUS"/);
  assert.ok(fs.existsSync(path.join(root, '.coa-launcher/realmlist-backup/Data/enUS/realmlist.wtf')));
});

test('the right port is required, a LAN address of this PC is accepted, no file is missing', async () => {
  assert.equal((await realmlistStatus(client({ 'Data/enUS/realmlist.wtf': 'set realmlist 127.0.0.1\r\n' }), ours)).state, 'wrong');
  assert.equal((await realmlistStatus(client({ 'Data/enUS/realmlist.wtf': 'set realmlist 192.168.1.83:3730\r\n' }), ours)).state, 'ok');
  assert.equal((await realmlistStatus(client({ 'Data/enUS/realmlist.wtf': 'set realmlist 127.0.0.1\r\n' }), { hosts: ['127.0.0.1'], port: 3724 })).state, 'ok');
  assert.equal((await realmlistStatus(client({}), ours)).state, 'missing');
});
