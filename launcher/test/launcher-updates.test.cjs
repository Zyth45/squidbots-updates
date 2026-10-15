'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { tempDir } = require('./helpers.cjs');
const { fetchSigned, publicKey } = require('../src/signing.cjs');
const { sha512 } = require('../src/launcher-updates.cjs');

const TOOL = path.join(__dirname, '..', '..', 'tools', 'publish-launcher.mjs');
const fileFetch = root => async url => {
  try { return new Response(await fsp.readFile(path.join(root, new URL(String(url)).pathname.split('/').pop()))); }
  catch { return new Response('', { status: 404 }); }
};

async function build(dist, installer) {
  await fsp.mkdir(dist, { recursive: true });
  await fsp.writeFile(path.join(dist, 'Setup-1.2.0.exe'), installer);
  const hash = crypto.createHash('sha512').update(installer).digest('base64');
  await fsp.writeFile(path.join(dist, 'latest.yml'), `version: 1.2.0\nfiles:\n  - url: Setup-1.2.0.exe\n    sha512: ${hash}\npath: Setup-1.2.0.exe\nsha512: ${hash}\n`);
}

test('publish-launcher signs version and SHA-512; tampering is refused', async () => {
  const root = await tempDir();
  const { privateKey, publicKey: pub } = crypto.generateKeyPairSync('ed25519');
  const pem = path.join(root, 'key.pem');
  await fsp.writeFile(pem, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const raw = pub.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64');
  const dist = path.join(root, 'dist');
  const out = path.join(root, 'out');
  await build(dist, Buffer.from('installer v1.2.0'));
  execFileSync(process.execPath, [TOOL, dist, out, '--key', pem]);

  const url = new URL('http://updates.test/launcher/launcher.json');
  const { data, signed } = await fetchSigned(url, { key: publicKey(raw), fetchImpl: fileFetch(out), maxBytes: 65536 });
  assert.ok(signed);
  assert.strictEqual(data.version, '1.2.0');
  assert.strictEqual(data.sha512, await sha512(path.join(out, 'Setup-1.2.0.exe')));

  // A host that swaps the installer and latest.yml cannot produce a matching signed launcher.json.
  await fsp.writeFile(path.join(out, 'Setup-1.2.0.exe'), 'malicious');
  assert.notStrictEqual(data.sha512, await sha512(path.join(out, 'Setup-1.2.0.exe')));
  const forged = JSON.stringify({ ...data, sha512: await sha512(path.join(out, 'Setup-1.2.0.exe')) }, null, 1) + '\n';
  await fsp.writeFile(path.join(out, 'launcher.json'), forged);
  await assert.rejects(fetchSigned(url, { key: publicKey(raw), fetchImpl: fileFetch(out), maxBytes: 65536 }), /signature is invalid/);
});

test('publish-launcher refuses an installer that does not match latest.yml', async () => {
  const root = await tempDir();
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = path.join(root, 'key.pem');
  await fsp.writeFile(pem, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const dist = path.join(root, 'dist');
  await build(dist, Buffer.from('installer'));
  await fsp.writeFile(path.join(dist, 'Setup-1.2.0.exe'), 'changed after the build');
  assert.throws(() => execFileSync(process.execPath, [TOOL, dist, path.join(root, 'out'), '--key', pem], { stdio: 'pipe' }));
});
