'use strict';
// Components published on their own (Zyth45/squidbots-updates, release "components"): the SquidBots addon and the
// bots dashboard, updated without a full repack update and without stopping the server. Each has a signed
// <name>.json (version, url, sha256, size, notes). The newer copy always wins: a component is offered only when
// it is newer than the one in the repack, never a beta (a beta must not replace a final version).
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { downloadObject } = require('./downloader.cjs');
const { compareVersions } = require('./repack-update.cjs');

const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const NAMES = ['addon', 'dashboard'];
const ADDON_DIR = ['CoA-Bots', 'Client', 'Interface', 'AddOns', 'SquidBotsLite'];
const DASHBOARD_DIR = ['CoA-Bots', 'Tools', 'Dashboard'];
const VERSION = /^\d+(\.\d+){0,3}$/;
const URL_OK = /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/;

function clean(name, data) {
  if (!data || typeof data !== 'object' || data.name !== name) throw new Error(`The ${name} list is malformed.`);
  if (!VERSION.test(data.version || '')) throw new Error(`The ${name} list has no final version.`);
  if (!/^[0-9a-f]{64}$/.test(data.sha256 || '') || !(data.size > 0) || !URL_OK.test(data.url || '')) throw new Error(`The ${name} list has no valid file.`);
  return { name, version: data.version, url: data.url, sha256: data.sha256, size: Number(data.size), notes: String(data.notes || '').slice(0, 4000), minLauncher: VERSION.test(data.minLauncher || '') ? data.minLauncher : '', minBots: VERSION.test(data.minBots || '') ? data.minBots : '' };
}

// The version in the repack: the addon's .toc, the dashboard's VERSION file (none = older than 2.2.2).
function installed(root, name) {
  try {
    if (name === 'addon') return /^##\s*Version:\s*(.+)$/m.exec(fsSync.readFileSync(path.join(root, ...ADDON_DIR, 'SquidBotsLite.toc'), 'utf8'))?.[1].trim() || '';
    return fsSync.readFileSync(path.join(root, ...DASHBOARD_DIR, 'VERSION'), 'utf8').trim() || '0';
  } catch { return name === 'dashboard' && fsSync.existsSync(path.join(root, ...DASHBOARD_DIR)) ? '0' : ''; }
}

// The CoA Bots version of the server (CoA-Bots\release.json): a component may need a given one (the addon talks to the
// bots module of its version: an addon 2.6.1 must not reach a 2.5 server).
function botsVersion(root) {
  try { return String(JSON.parse(fsSync.readFileSync(path.join(root, 'CoA-Bots', 'release.json'), 'utf8').replace(/^\uFEFF/, '')).version || ''); } catch { return ''; }
}
// Why a newer component cannot be installed on this server yet ('' when it can).
function blocker(root, offer) {
  if (!offer?.minBots) return '';
  const bots = botsVersion(root);
  return bots && compareVersions(bots.replace(/[^\d.].*$/, ''), offer.minBots) >= 0 ? '' : 'bots';
}

function status(root, lists) {
  return NAMES.map(name => {
    const here = root ? installed(root, name) : '';
    const offer = lists[name] || null;
    const newer = !!(offer && here && compareVersions(offer.version, here) > 0);
    const blocked = newer ? blocker(root, offer) : '';
    // A newer copy the server is too old for is shown as waiting, never installed.
    return { name, installed: here, version: offer?.version || '', available: newer && !blocked, waiting: blocked ? { minBots: offer.minBots, bots: botsVersion(root) } : null, notes: newer ? offer.notes : '', minLauncher: offer?.minLauncher || '' };
  });
}

const unpack = (zip, into) => new Promise((resolve, reject) => execFile(tar, ['-xf', zip, '-C', into], { windowsHide: true, maxBuffer: 1 << 20 }, error => (error ? reject(new Error(`The file could not be unpacked: ${error.message}`)) : resolve())));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

// Downloads (fingerprint checked), keeps the copy it replaces, installs. Returns what was done.
async function install(root, offer, { cacheDir, backupDir, fetchImpl }) {
  await fs.mkdir(cacheDir, { recursive: true });
  const zip = path.join(cacheDir, `${offer.sha256}.zip`);
  await downloadObject({ url: new URL(offer.url), size: offer.size, sha256: offer.sha256, destination: zip, signal: AbortSignal.timeout(30 * 60 * 1000), fetchImpl, redirect: 'follow' });
  const stage = await fs.mkdtemp(path.join(cacheDir, `${offer.name}-`));
  try {
    await unpack(zip, stage);
    if (offer.name === 'addon') {
      // One SquidBotsLite folder at the top of the zip, replacing the repack's copy as a whole.
      const source = path.join(stage, 'SquidBotsLite');
      if (!fsSync.existsSync(path.join(source, 'SquidBotsLite.toc'))) throw new Error('The addon zip has no SquidBotsLite folder at its top.');
      const target = path.join(root, ...ADDON_DIR);
      if (fsSync.existsSync(target)) await fs.cp(target, path.join(backupDir, `addon-${installed(root, 'addon') || 'old'}-${stamp()}`), { recursive: true });
      const fresh = `${target}.new`;
      await fs.rm(fresh, { recursive: true, force: true });
      await fs.cp(source, fresh, { recursive: true });
      await fs.rm(target, { recursive: true, force: true });
      await fs.rename(fresh, target);
    } else {
      // The dashboard's files at the top of the zip, copied over the folder: only what the zip holds is replaced,
      // the player's data (settings, webhook, history, extracted maps) is never in the zip, never touched.
      if (!fsSync.existsSync(path.join(stage, 'VERSION'))) throw new Error('The dashboard zip has no VERSION file at its top.');
      const target = path.join(root, ...DASHBOARD_DIR);
      const keep = path.join(backupDir, `dashboard-${installed(root, 'dashboard') || 'old'}-${stamp()}`);
      for (const entry of await fs.readdir(stage, { withFileTypes: true })) {
        const old = path.join(target, entry.name);
        if (fsSync.existsSync(old)) await fs.cp(old, path.join(keep, entry.name), { recursive: true });
      }
      await fs.mkdir(target, { recursive: true });
      await fs.cp(stage, target, { recursive: true, force: true });
    }
    return installed(root, offer.name);
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}

module.exports = { NAMES, clean, installed, status, install, blocker, botsVersion };
