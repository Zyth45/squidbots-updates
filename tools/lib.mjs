// Shared helpers for the publishing tools: content-addressed objects and signed manifests.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Same path rules as the launcher itself, so a release the launcher would refuse is never published.
export const releaseFormat = require('../launcher/src/release-format.cjs');

export function parseArgs(argv, flags = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const name = arg.slice(2);
    if (flags[name] === 'bool') out[name] = true;
    else if (flags[name] === 'list') (out[name] ||= []).push(argv[++i]);
    else out[name] = argv[++i];
  }
  return out;
}

export async function walk(root, relative = '') {
  const files = [];
  for (const entry of await fsp.readdir(path.join(root, relative), { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Links are not published: ${rel}`);
    if (entry.isDirectory()) files.push(...await walk(root, rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

export async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
}

// objects/<sha256>.gz next to the object, kept only when it saves at least 5 %. Returns its size, or 0.
export async function storeCompressed(objectsDir, hash, size) {
  const plain = path.join(objectsDir, hash);
  const packed = `${plain}.gz`;
  if (fs.existsSync(packed)) return fs.statSync(packed).size;
  if (fs.existsSync(`${plain}.nogz`)) return 0;
  const zlib = await import('node:zlib');
  const { pipeline } = await import('node:stream/promises');
  const temp = `${packed}.${process.pid}.tmp`;
  await pipeline(fs.createReadStream(plain), zlib.createGzip({ level: 9 }), fs.createWriteStream(temp));
  const packedSize = fs.statSync(temp).size;
  if (packedSize > size * 0.95) { await fsp.unlink(temp); await fsp.writeFile(`${plain}.nogz`, ''); return 0; }
  await fsp.rename(temp, packed);
  return packedSize;
}

// Stores a file once under objects/<sha256>; a hard link avoids copying gigabytes when possible.
export async function storeObject(file, objectsDir, hash, { copy = false } = {}) {
  const target = path.join(objectsDir, hash);
  if (fs.existsSync(target)) return false;
  await fsp.mkdir(objectsDir, { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  if (copy) await fsp.copyFile(file, temp);
  else { try { await fsp.link(file, temp); } catch { await fsp.copyFile(file, temp); } }
  await fsp.rename(temp, target);
  return true;
}

export function loadPrivateKey(file) {
  if (!file) return null;
  const key = crypto.createPrivateKey(fs.readFileSync(file));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('The signing key must be Ed25519 (use tools/keygen.mjs).');
  return key;
}

// Writes manifest.json then manifest.json.sig; the manifest is renamed last so clients never see half a release.
export async function writeSigned(file, value, key) {
  const bytes = Buffer.from(JSON.stringify(value, null, 1) + '\n');
  await fsp.mkdir(path.dirname(file), { recursive: true });
  if (key) await fsp.writeFile(`${file}.sig.tmp`, crypto.sign(null, bytes, key).toString('base64') + '\n');
  await fsp.writeFile(`${file}.tmp`, bytes);
  if (key) await fsp.rename(`${file}.sig.tmp`, `${file}.sig`);
  else await fsp.rm(`${file}.sig`, { force: true });
  await fsp.rename(`${file}.tmp`, file);
}

export async function pruneObjects(objectsDir, keep) {
  let removed = 0;
  for (const name of await fsp.readdir(objectsDir).catch(() => [])) {
    if (/^[a-f0-9]{64}$/.test(name) && !keep.has(name)) { await fsp.rm(path.join(objectsDir, name)); removed++; }
  }
  return removed;
}

export const formatBytes = value => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i ? 1 : 0)} ${units[i]}`;
};
