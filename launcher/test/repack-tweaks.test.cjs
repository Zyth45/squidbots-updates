'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { quietPlayerLogger } = require('../src/repack-tweaks.cjs');

function repack(text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tweak-'));
  fs.mkdirSync(path.join(root, 'Settings'));
  fs.writeFileSync(path.join(root, 'Settings/worldserver.conf.template'), text);
  return root;
}
const read = root => fs.readFileSync(path.join(root, 'Settings/worldserver.conf.template'), 'utf8');

test('the player logger line is added once, after Logger.diff, keeping the line endings', async () => {
  const root = repack('Logger.root=2,Console Server\r\nLogger.diff=3,Console Server\r\n# Logger.entities.player=4,Console Server\r\n');
  assert.equal(await quietPlayerLogger(root), true);
  assert.equal(await quietPlayerLogger(root), false);
  assert.equal(read(root), 'Logger.root=2,Console Server\r\nLogger.diff=3,Console Server\r\nLogger.entities.player=1,Console Server\r\n# Logger.entities.player=4,Console Server\r\n');
});

test('a line of the player is never changed', async () => {
  const root = repack('Logger.diff=3,Console Server\nLogger.entities.player=4,Console Server\n');
  assert.equal(await quietPlayerLogger(root), false);
  assert.match(read(root), /Logger\.entities\.player=4,Console Server/);
});
