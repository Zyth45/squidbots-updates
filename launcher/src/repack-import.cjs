'use strict';
// A repack the player downloaded (Jealous's release, from Proton or Discord) brought into the launcher:
// its sha256 is compared with a signed list of known releases, its content is checked, and Windows' own
// tar.exe unpacks it into an empty folder. Nothing of the repack is hosted by us.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
// What makes a full repack (an update zip has none of these).
const REQUIRED = ['Core/worldserver.exe', 'Core/authserver.exe', 'mysql/bin/mysqld.exe', 'Scripts/manage.py', 'Settings/repack.json'];

async function hashZip(file, onProgress = () => {}) {
  const { size } = await fsp.stat(file);
  const hash = crypto.createHash('sha256');
  let done = 0;
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 4 << 20 })) {
    hash.update(chunk);
    done += chunk.length;
    onProgress(done, size);
  }
  return { sha256: hash.digest('hex'), size };
}

function run(args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(TAR, args, { windowsHide: true });
    let tail = '';
    let buffer = '';
    const read = chunk => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) { if (line) onLine?.(line); tail = line || tail; }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.once('error', reject);
    child.once('exit', code => { if (buffer) onLine?.(buffer); code === 0 ? resolve() : reject(new Error(`The archive could not be read (${tail || `tar exit ${code}`}).`)); });
  });
}

// The entries of the zip: one top folder (CoA-Repack/) or the repack at its root.
async function inspectZip(file) {
  const entries = [];
  await run(['-tf', file], line => entries.push(line.replace(/\\/g, '/')));
  const tops = new Set(entries.map(entry => entry.split('/')[0]));
  const top = tops.size === 1 && entries.every(entry => entry.includes('/') || entry.endsWith('/')) ? [...tops][0] : '';
  const files = new Set(entries.map(entry => (top ? entry.slice(top.length + 1) : entry).toLowerCase()));
  const missing = REQUIRED.filter(relative => !files.has(relative.toLowerCase()));
  // A zip must stay inside the folder it is unpacked to.
  if (entries.some(entry => entry.startsWith('/') || /^[A-Za-z]:/.test(entry) || entry.split('/').includes('..'))) throw new Error('This archive has unsafe paths and was refused.');
  return { entries: entries.length, top, missing, update: missing.length === REQUIRED.length };
}

async function extractZip(file, destination, { top = '', total = 0, onProgress = () => {} } = {}) {
  await fsp.mkdir(destination, { recursive: true });
  let done = 0;
  const args = ['-xvf', file, '-C', destination];
  if (top) args.push('--strip-components', '1');
  await run(args, () => { done++; if (done % 200 === 0) onProgress(done, total); });
  onProgress(total || done, total || done);
}

// The signed list of known releases: [{ sha256, name, release, date, botsRelease, notes }].
function findKnown(list, sha256) {
  return (Array.isArray(list?.repacks) ? list.repacks : []).find(item => String(item.sha256).toLowerCase() === sha256) || null;
}

module.exports = { hashZip, inspectZip, extractZip, findKnown, REQUIRED };
