'use strict';
// Updates of the repack (core, CoA Bots, addon, dashboard) from the releases of squidbots-updates.
// The launcher does not copy a single file of the repack itself: it downloads the signed update package, checks
// its fingerprint, puts its folder in the repack, then runs the package's own tool (coa_update.py) with --json:
// checks, backup, clean stop, files, bot database, test start, undo and the finishing of a cut update all stay
// in that tool, the same one a player runs by hand and the one every release is tested with.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { downloadObject } = require('./downloader.cjs');

const text = (value, max) => String(value ?? '').slice(0, max);
const RELEASE = /^main-\d{8}-[0-9a-f]{7,40}$/;
const FOLDER = /^CoA-Update-[0-9A-Za-z.-]{1,20}$/;

// Versions like 2.4, 2.5-beta.1, 2.5: number by number, then a stable version before a beta of the same number.
function compareVersions(a, b) {
  const key = value => {
    const match = /^(\d+(?:\.\d+)*)(.*)$/.exec(String(value || '').trim()) || [null, '0', ''];
    return { nums: match[1].split('.').map(Number), beta: /beta|rc|pre/i.test(match[2]), step: Number(/(\d+)/.exec(match[2])?.[1] || 0) };
  };
  const x = key(a), y = key(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) if ((x.nums[i] || 0) !== (y.nums[i] || 0)) return (x.nums[i] || 0) - (y.nums[i] || 0);
  if (x.beta !== y.beta) return x.beta ? -1 : 1;
  return x.step - y.step;
}

// The manifest (update.json + update.json.sig): what the latest update is and which releases it updates.
function cleanManifest(data) {
  if (!data || typeof data !== 'object') throw new Error('The update list is malformed.');
  const pkg = data.package || {};
  if (!RELEASE.test(data.release || '')) throw new Error('The update list has no valid release.');
  if (!/^[0-9a-f]{64}$/.test(pkg.sha256 || '') || !(pkg.size > 0) || !FOLDER.test(pkg.folder || '') || !/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(pkg.url || '')) {
    throw new Error('The update list has no valid package.');
  }
  // More zips when the package is too big for one file (each one holds the same CoA-Update-x folder).
  const parts = (Array.isArray(pkg.parts) ? pkg.parts : []).slice(0, 8).map(part => {
    if (!/^[0-9a-f]{64}$/.test(part?.sha256 || '') || !(part.size > 0) || !/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(part.url || '')) throw new Error('The update list has an invalid package part.');
    // A part can say which installed releases need it (the maps of 2.5: only for a server older than 2.5).
    const from = Array.isArray(part.from) ? part.from.filter(item => RELEASE.test(item)) : null;
    return { url: part.url, sha256: part.sha256, size: Number(part.size), ...(from ? { from } : {}) };
  });
  return {
    version: text(data.version, 20),
    // A beta is signed as such: a launcher that does not take betas never installs it.
    channel: data.channel === 'beta' ? 'beta' : 'stable',
    release: data.release,
    from: (Array.isArray(data.from) ? data.from : []).filter(item => RELEASE.test(item)),
    publishedAt: text(data.publishedAt, 40),
    notes: text(data.notes, 60000),
    // The same notes in French and Russian, when the release has them.
    notesI18n: Object.fromEntries(['fr', 'ru'].filter(lang => typeof data.notesI18n?.[lang] === 'string').map(lang => [lang, text(data.notesI18n[lang], 60000)])),
    notice: typeof data.notice === 'string' ? { en: text(data.notice, 600) } : data.notice && typeof data.notice === 'object' ? Object.fromEntries(['en', 'fr', 'ru'].filter(lang => typeof data.notice[lang] === 'string').map(lang => [lang, text(data.notice[lang], 600)])) : null,
    diskBytes: Number.isSafeInteger(data.diskBytes) && data.diskBytes > 0 ? data.diskBytes : 0,
    minLauncher: /^\d+(\.\d+){0,3}$/.test(data.minLauncher || '') ? data.minLauncher : '',
    package: { url: pkg.url, sha256: pkg.sha256, size: Number(pkg.size), folder: pkg.folder, parts },
  };
}

// What is installed in a repack folder.
function installed(folder) {
  const read = file => { try { return JSON.parse(fsSync.readFileSync(path.join(folder, file), 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
  return {
    release: read('RELEASE.json')?.releaseId || null,
    bots: read('CoA-Bots/release.json')?.version || null,
    // coa_update.py leaves this file while an update runs: present at start = an update was cut.
    cut: fsSync.existsSync(path.join(folder, 'Backups', 'update-in-progress.json')),
  };
}

// current | available | unsupported (a release this update does not take) | cut | none (no list read yet).
function status(folder, manifest) {
  const here = installed(folder);
  if (here.cut) return { state: 'cut', here, manifest };
  if (!manifest) return { state: 'none', here, manifest };
  if (here.release === manifest.release) return { state: 'current', here, manifest };
  if (manifest.from.includes(here.release)) return { state: 'available', here, manifest: forRelease(manifest, here.release) };
  // A tester on a beta newer than the stable version offered: nothing to do until a newer one comes.
  if (here.bots && compareVersions(here.bots, manifest.version) > 0) return { state: 'current', ahead: true, here, manifest };
  return { state: 'unsupported', here, manifest };
}

// The update package: downloaded once into the launcher's cache, its fingerprint checked, then unpacked into the
// repack (the zip holds one CoA-Update-x folder). An older copy of that folder is replaced.
// The update as this server takes it: the parts it already has (listed for other releases only) are left out.
function forRelease(manifest, release) {
  if (!manifest?.package?.parts?.length) return manifest;
  return { ...manifest, package: { ...manifest.package, parts: manifest.package.parts.filter(part => !part.from || part.from.includes(release)) } };
}

// The whole download (main zip and its parts), for the progress bar and the big update notice.
const packageSize = manifest => manifest.package.size + (manifest.package.parts || []).reduce((sum, part) => sum + part.size, 0);

async function fetchPackage(manifest, cacheDir, { fetchImpl, signal, onBytes }) {
  const files = [{ url: manifest.package.url, sha256: manifest.package.sha256, size: manifest.package.size }, ...(manifest.package.parts || [])];
  const zips = [];
  let before = 0;
  for (const file of files) {
    const zip = path.join(cacheDir, `${file.sha256}.zip`);
    // GitHub serves release files through a redirect; the fingerprint is checked whatever the host.
    await downloadObject({ url: new URL(file.url), size: file.size, sha256: file.sha256, destination: zip, signal, fetchImpl, onBytes: have => onBytes?.(before + have), redirect: 'follow' });
    before += file.size;
    zips.push(zip);
  }
  return zips;
}

async function unpack(zips, folder, packageFolder, onZip = () => {}) {
  const target = path.join(folder, packageFolder);
  await fs.rm(target, { recursive: true, force: true });
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const list = [].concat(zips);
  for (const [index, zip] of list.entries()) {
    onZip(index + 1, list.length);
    await new Promise((resolve, reject) => execFile(tar, ['-xf', zip, '-C', folder], { windowsHide: true, maxBuffer: 1 << 20 }, error => (error ? reject(new Error(`The update could not be unpacked: ${error.message}`)) : resolve())));
  }
  if (!fsSync.existsSync(path.join(target, 'update', 'coa_update.py'))) throw new Error('The update package does not hold its update tool.');
  return target;
}

// Runs the package's tool. Every line it prints is one JSON event; the last error event carries the code.
function runTool(folder, packageFolder, command, extra, onEvent) {
  const python = path.join(folder, 'Runtime', 'python', 'python.exe');
  const tool = path.join(folder, packageFolder, 'update', 'coa_update.py');
  const args = ['-B', '-X', 'utf8', tool, command, '--json', '--yes', '--repack', folder, ...extra];
  return new Promise(resolve => {
    const child = spawn(python, args, { cwd: path.join(folder, packageFolder), windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    const result = { code: null, error: null, details: [], log: [] };
    let buffer = '';
    const line = raw => {
      const value = raw.trim();
      if (!value) return;
      let event;
      try { event = JSON.parse(value); } catch { event = { event: 'info', text: value }; }
      result.log.push(`${event.time || ''} [${event.event}] ${event.text || ''}`.trim());
      if (result.log.length > 400) result.log.shift();
      if (event.event === 'error') { result.error = { code: Number(event.code) || 0, text: text(event.text, 2000) }; result.details = []; }
      if (event.event === 'detail' && result.error) result.details.push(text(event.text, 500));
      onEvent(event);
    };
    child.stdout.on('data', chunk => { buffer += chunk.toString('utf8'); const lines = buffer.split(/\r?\n/); buffer = lines.pop(); lines.forEach(line); });
    child.stderr.on('data', chunk => chunk.toString('utf8').split(/\r?\n/).forEach(raw => raw.trim() && result.log.push(`[stderr] ${raw.trim()}`)));
    child.on('error', error => { result.error = { code: 1, text: `The update tool could not be started: ${error.message}` }; });
    child.on('close', code => { if (buffer) line(buffer); result.code = result.error && code === 0 ? result.error.code : code; resolve(result); });
  });
}

module.exports = { cleanManifest, compareVersions, forRelease, packageSize, installed, status, fetchPackage, unpack, runTool };
