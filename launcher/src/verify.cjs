'use strict';
// "Is my server healthy?" A list of checks on the core, the bots, the services, the database and the
// files around them. Each check says ok / warn / bad / info, with the figures behind it and the action
// that fixes it. Quick checks read files and ports; the deep ones also verify every file of the core and
// the bots against their signed release.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { isNewer } = require('./updates.cjs');
const { repackChecks } = require('./repack-checks.cjs');

const DAY = 24 * 3600 * 1000;

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) hash.update(chunk);
  return hash.digest('hex');
}

const readJson = async file => { try { return JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^﻿/, '')); } catch { return null; } };

// The end of a log, from its last start (a log can be large).
async function tail(file, bytes = 4 * 1024 * 1024) {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) return null;
  const handle = await fsp.open(file, 'r');
  try {
    const size = Math.min(stat.size, bytes);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, stat.size - size);
    return { text: buffer.toString('utf8'), mtime: stat.mtimeMs };
  } finally { await handle.close(); }
}

// What the last start of the worldserver did with the database updates.
async function databaseUpdates(root) {
  for (const file of ['Core/Logs/Server.log', 'CoA-Bots/Core/Logs/Server.log']) {
    const log = await tail(path.join(root, file));
    if (!log) continue;
    const lines = log.text.split(/\r?\n/);
    let start = -1;
    for (let i = lines.length - 1; i >= 0; i--) if (/Updating .* database|Applied \d+ quer/i.test(lines[i])) { start = i; break; }
    if (start < 0) continue;
    const from = lines.slice(0, start + 1).findLastIndex(line => /Updating .* database/i.test(line));
    // Never further back than this start's own banner: a failure of an earlier start is not this one's.
    const banner = lines.slice(0, from + 1).findLastIndex(line => /AzerothCore rev\./.test(line));
    const block = lines.slice(Math.max(0, from - 200, banner), start + 400);
    const failed = block.filter(line => /(failed|error).*(update|apply)|(update|apply).*(failed|error)|could not be applied/i.test(line)).slice(0, 5);
    const applied = block.map(line => line.match(/Applied (\d+) quer/i)).filter(Boolean).reduce((sum, match) => sum + Number(match[1]), 0);
    return { failed, applied, at: log.mtime };
  }
  return null;
}

const CRASH_FOLDERS = ['Core/Crashes', 'CoA-Bots/Core/Crashes', 'Crashes'];

// One crash writes a .txt and a .dmp of the same name: it is counted once.
async function crashes(root, days = 7) {
  const found = new Map();
  for (const folder of CRASH_FOLDERS) {
    const entries = await fsp.readdir(path.join(root, folder), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(txt|dmp)$/i.test(entry.name)) continue;
      const stat = await fsp.stat(path.join(root, folder, entry.name)).catch(() => null);
      const key = `${folder}/${entry.name.replace(/\.(txt|dmp)$/i, '')}`;
      if (stat && Date.now() - stat.mtimeMs < days * DAY) found.set(key, Math.max(found.get(key) || 0, stat.mtimeMs));
    }
  }
  return [...found.values()].sort((a, b) => b - a);
}

// "Put away": the crash reports move to Crashes\archive (kept for the support, no longer counted).
async function archiveCrashes(root) {
  let moved = 0;
  for (const folder of CRASH_FOLDERS) {
    const dir = path.join(root, folder);
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(txt|dmp)$/i.test(entry.name)) continue;
      await fsp.mkdir(path.join(dir, 'archive'), { recursive: true });
      await fsp.rename(path.join(dir, entry.name), path.join(dir, 'archive', entry.name));
      moved++;
    }
  }
  return moved;
}

// updaters: { repack, bots } ClientUpdater-like; botsPackage: BotsPackage; control: ServerControl; backup: ServerBackup.
async function runChecks({ root, inspect, control, backup, repack, botsPackage, deep = false }) {
  const checks = [];
  const add = (group, id, state, data = {}, action = '') => checks.push({ group, id, state, data, action });
  const info = inspect(root);

  // ---- core
  if (!info.repack) {
    add('core', 'core.installed', 'bad', { missing: info.missing.slice(0, 4).join(', ') }, 'install');
    return checks;
  }
  add('core', 'core.installed', 'ok', { version: info.release || '?' });
  if (repack) {
    try {
      const [installed, release] = await Promise.all([repack.installedState(root), repack.peek()]);
      if (!installed) add('core', 'core.update', 'info', { latest: release.version }, 'check');
      else if (isNewer(installed, release)) add('core', 'core.update', 'warn', { latest: release.version, installed: installed.version }, 'upgrade');
      else add('core', 'core.update', 'ok', { installed: installed.version });
    } catch (error) { add('core', 'core.update', 'info', { error: error.message }); }
    if (deep) {
      try {
        const result = await repack.check(root, { force: true });
        add('core', 'core.files', result.needsUpdate ? 'warn' : 'ok', { files: result.files, removed: result.removed }, result.needsUpdate ? 'repair' : '');
      } catch (error) { add('core', 'core.files', 'info', { error: error.message }); }
    }
  }

  // ---- bots
  if (botsPackage) {
    const bots = await botsPackage.info(root);
    if (!bots.installed) add('bots', 'bots.installed', 'info', {}, 'bots-install');
    else {
      add('bots', 'bots.installed', 'ok', { version: bots.version, builtFor: bots.builtFor });
      try {
        const folder = botsPackage.folder(root);
        if (!botsPackage.bots.manifestUrl) throw Object.assign(new Error('updated with the repack'), { skip: true });
        const [installed, release] = await Promise.all([botsPackage.updater.installedState(folder), botsPackage.updater.peek()]);
        if (installed && isNewer(installed, release)) add('bots', 'bots.update', 'warn', { latest: release.version, installed: installed.version }, 'bots-install');
        else if (installed) add('bots', 'bots.update', 'ok', { installed: installed.version });
      } catch (error) { if (!error.skip) add('bots', 'bots.update', 'info', { error: error.message }); }
      // The bot worldserver is built from one exact core: the core's own worldserver must be that one.
      const release = await readJson(path.join(root, botsPackage.bots.folder, 'release.json'));
      const expected = String(release?.originalWorldserverSha256 || '').toLowerCase();
      const coreExe = path.join(root, 'Core/worldserver.exe');
      if (!expected) add('bots', 'bots.match', 'info', {});
      else if (!fs.existsSync(coreExe)) add('bots', 'bots.match', 'bad', {}, 'repair');
      else add('bots', 'bots.match', (await sha256(coreExe)) === expected ? 'ok' : 'bad', { release: String(release.release || '') }, 'bots-install');
      // The repack's own list (CoA-Bots\manifest.json, written by each release and each update) is the
      // reference: the download channel may hold an older version than the one the repack was updated to.
      const local = deep ? await readJson(path.join(root, botsPackage.bots.folder, 'manifest.json')) : null;
      if (local?.files && typeof local.files === 'object') {
        const bad = [];
        for (const [rel, file] of Object.entries(local.files)) {
          const full = path.join(root, botsPackage.bots.folder, ...rel.split('/'));
          if (!full.startsWith(path.join(root, botsPackage.bots.folder) + path.sep)) continue;
          const stat = await fsp.stat(full).catch(() => null);
          if (!stat || stat.size !== file.bytes || (await sha256(full)) !== String(file.sha256).toLowerCase()) bad.push(rel);
        }
        add('bots', 'bots.files', bad.length ? 'warn' : 'ok', { files: bad.length, list: bad.slice(0, 10), version: String(local.version || '') }, '');
      } else if (deep) {
        try {
          const result = await botsPackage.check(root, { force: true });
          add('bots', 'bots.files', result.needsUpdate ? 'warn' : 'ok', { files: result.files }, result.needsUpdate ? 'bots-install' : '');
        } catch (error) { add('bots', 'bots.files', 'info', { error: error.message }); }
      }
    }
  }

  // ---- services
  const services = control ? await control.status() : [];
  for (const service of services) {
    const state = service.state === 'running' ? 'ok' : service.state === 'foreign' ? 'bad' : 'info';
    add('services', `service.${service.state === 'foreign' ? 'foreign' : service.state === 'running' ? 'running' : 'stopped'}`, state, { name: service.name, port: service.port, other: service.other || '', variant: service.variant || '' }, service.state === 'stopped' ? 'start' : '');
  }
  const mysql = services.find(service => service.id === 'mysql');
  let own = false;
  if (mysql?.state === 'running' && backup) {
    try { await backup.ready(); own = true; add('services', 'db.own', 'ok'); }
    catch (error) { add('services', 'db.own', 'bad', { error: error.message }); }
  }
  // The known problems of the repacks: settings, files, processes, database.
  await repackChecks({ root, add, services, mysqlQuery: own ? sql => backup.query(sql) : null });

  // ---- database updates, crashes, backups, disk
  const updates = await databaseUpdates(root);
  if (updates) add('health', 'db.updates', updates.failed.length ? 'bad' : 'ok', { applied: updates.applied, failed: updates.failed.join(' | '), at: updates.at });
  const crashList = await crashes(root);
  add('health', 'crashes', crashList.length ? 'warn' : 'ok', { count: crashList.length, last: crashList[0] || 0 }, crashList.length ? 'crashes-archive' : '');
  if (backup) {
    const list = await backup.list().catch(() => []);
    const last = list[0] ? Date.parse(list[0].createdAt) : 0;
    add('health', 'backup.age', !last ? 'warn' : Date.now() - last > 7 * DAY ? 'warn' : 'ok', { at: last, days: last ? Math.floor((Date.now() - last) / DAY) : 0 }, 'backup');
  }
  try {
    const disk = await fsp.statfs(root);
    const free = disk.bavail * disk.bsize;
    add('health', 'disk', free < 5 * 1024 ** 3 ? 'warn' : 'ok', { free });
  } catch {}
  return checks;
}

const summary = checks => ({
  bad: checks.filter(check => check.state === 'bad').length,
  warn: checks.filter(check => check.state === 'warn').length,
  ok: checks.filter(check => check.state === 'ok').length,
  total: checks.length,
});

module.exports = { runChecks, summary, databaseUpdates, crashes, archiveCrashes };
