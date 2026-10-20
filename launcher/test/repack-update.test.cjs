'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanManifest, status } = require('../src/repack-update.cjs');

const manifest = {
  version: '2.4', release: 'main-20261020-0123abcd', from: ['main-20261011-a543922b', 'bad'],
  package: { url: 'https://github.com/x/y/releases/download/v2.4/CoA-Update-2.4.zip', sha256: 'a'.repeat(64), size: 10, folder: 'CoA-Update-2.4' },
};

function repack(release, cut = false) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-upd-'));
  fs.writeFileSync(path.join(folder, 'RELEASE.json'), JSON.stringify({ releaseId: release }));
  if (cut) { fs.mkdirSync(path.join(folder, 'Backups')); fs.writeFileSync(path.join(folder, 'Backups', 'update-in-progress.json'), '{}'); }
  return folder;
}

test('the update list is checked: release, package, accepted releases', () => {
  const clean = cleanManifest(manifest);
  assert.deepEqual(clean.from, ['main-20261011-a543922b']);
  assert.throws(() => cleanManifest({ ...manifest, release: 'x' }));
  assert.throws(() => cleanManifest({ ...manifest, package: { ...manifest.package, url: 'http://x/y.zip' } }));
  assert.throws(() => cleanManifest({ ...manifest, package: { ...manifest.package, folder: '../evil' } }));
});

test('the state of a repack: available, current, unsupported, cut', () => {
  const clean = cleanManifest(manifest);
  assert.equal(status(repack('main-20261011-a543922b'), clean).state, 'available');
  assert.equal(status(repack('main-20261020-0123abcd'), clean).state, 'current');
  assert.equal(status(repack('main-20250101-deadbeef'), clean).state, 'unsupported');
  assert.equal(status(repack('main-20261011-a543922b', true), clean).state, 'cut');
  assert.equal(status(repack('main-20261011-a543922b'), null).state, 'none');
});

test('a part listed for older releases is left out for a server that already has it', () => {
  const maps = { url: 'https://github.com/x/y/releases/download/v2.6/maps-1.zip', sha256: 'b'.repeat(64), size: 1000, from: ['main-20261011-a543922b'] };
  const always = { url: 'https://github.com/x/y/releases/download/v2.6/more.zip', sha256: 'c'.repeat(64), size: 5 };
  const clean = cleanManifest({ ...manifest, from: ['main-20261011-a543922b', 'main-20261018-0ab739f5'], package: { ...manifest.package, parts: [maps, always] } });
  const old = status(repack('main-20261011-a543922b'), clean);
  assert.equal(old.state, 'available');
  assert.equal(old.manifest.package.parts.length, 2);
  const recent = status(repack('main-20261018-0ab739f5'), clean);
  assert.deepEqual(recent.manifest.package.parts.map(part => part.size), [5]);
});
