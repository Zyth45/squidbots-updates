'use strict';
// The game files Manastorm needs (its native window): a zip named in the signed feed, with its sha256 and size.
// Only Data\ and Interface\ files are taken; each file it replaces in the game is kept first in the launcher's data.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { downloadObject } = require('./downloader.cjs');

const run = promisify(execFile);
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const ALLOWED = /^(Data|Interface)\/[^:*?"<>|]+$/i;

// The zip's files, checked: relative, under Data/ or Interface/, no "..". The zip may have one top folder.
function entriesOf(listing) {
  const files = listing.split(/\r?\n/).map(line => line.replace(/\\/g, '/').trim()).filter(line => line && !line.endsWith('/'));
  const tops = new Set(files.map(file => file.split('/')[0]));
  const strip = tops.size === 1 && !/^(Data|Interface)$/i.test([...tops][0]) ? `${[...tops][0]}/` : '';
  return files.map(file => {
    const rel = strip && file.startsWith(strip) ? file.slice(strip.length) : file;
    if (!ALLOWED.test(rel) || rel.split('/').some(part => part === '..' || part === '.')) throw new Error(`The client zip holds a file outside Data and Interface (${file}): it is refused.`);
    return { inZip: file, rel };
  });
}

async function install({ client, entry, cacheDir, backupDir, fetchImpl }) {
  if (!client || !fs.existsSync(client)) throw new Error('Choose your game folder first (Your game card).');
  if (!entry?.url || !entry.sha256 || !entry.bytes) throw new Error('No client files to install yet: download the zip instead.');
  await fsp.mkdir(cacheDir, { recursive: true });
  const zip = path.join(cacheDir, `manastorm-client-${entry.sha256.slice(0, 12)}.zip`);
  await downloadObject({ url: new URL(entry.url), size: entry.bytes, sha256: entry.sha256, destination: zip, signal: AbortSignal.timeout(30 * 60 * 1000), fetchImpl, redirect: 'follow' });
  const files = entriesOf((await run(tar, ['-tf', zip], { maxBuffer: 16 << 20, windowsHide: true })).stdout);
  if (!files.length) throw new Error('The client zip is empty.');
  const stage = await fsp.mkdtemp(path.join(cacheDir, 'stage-'));
  try {
    await run(tar, ['-xf', zip, '-C', stage], { windowsHide: true, maxBuffer: 16 << 20 });
    const keep = path.join(backupDir, new Date().toISOString().replace(/[:.]/g, '-'));
    for (const file of files) {
      const target = path.join(client, ...file.rel.split('/'));
      if (fs.existsSync(target)) { await fsp.mkdir(path.dirname(path.join(keep, file.rel)), { recursive: true }); await fsp.copyFile(target, path.join(keep, file.rel)); }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(path.join(stage, ...file.inZip.split('/')), target);
    }
    return files.map(file => file.rel);
  } finally { await fsp.rm(stage, { recursive: true, force: true }); }
}

module.exports = { install, entriesOf };
