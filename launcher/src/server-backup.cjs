'use strict';
// Database backups of a local repack: accounts, characters and bots, as compressed SQL dumps.
//
// The repack's own MySQL tools do the work (mysql/bin/mysqldump.exe and mysql.exe). They read the
// credentials from the repack's option file (mysql/admin-client.ini, written by the repack at
// start): the launcher only ever passes its path and never reads or shows the password.
// Backups live in <repack>/Backups as <stamp>[-label].sql.gz with a small .json beside each.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { portOpen } = require('./server-control.cjs');

const DATABASES = ['acore_auth', 'acore_characters', 'acore_playerbots'];
const OPTIONAL = ['acore_world'];
const NAME = /^\d{8}-\d{6}(-[a-z0-9-]{1,40})?\.sql\.gz$/;
const DUMP_FLAGS = ['--single-transaction', '--quick', '--no-tablespaces', '--skip-lock-tables', '--routines', '--events',
  '--set-gtid-purged=OFF', '--default-character-set=utf8mb4'];

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');

class ServerBackup {
  constructor(root, { notify = () => {} } = {}) {
    this.root = path.resolve(root);
    this.folder = path.join(this.root, 'Backups');
    this.notify = notify;
    this.busy = false;
  }

  port() {
    const settings = JSON.parse(fs.readFileSync(path.join(this.root, 'Settings/repack.json'), 'utf8').replace(/^﻿/, ''));
    const port = Number(settings.mysqlPort);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid MySQL port in Settings/repack.json.');
    return port;
  }

  client(tool, args) {
    const exe = path.join(this.root, 'mysql/bin', tool);
    const ini = path.join(this.root, 'mysql/admin-client.ini');
    if (!fs.existsSync(exe)) throw new Error(`${tool} is missing from this repack.`);
    if (!fs.existsSync(ini)) throw new Error('Start the server once: the repack writes its database settings at the first start.');
    return [exe, [`--defaults-file=${ini}`, '--host=127.0.0.1', `--port=${this.port()}`, ...args]];
  }

  async ready() {
    if (!(await portOpen(this.port()))) throw new Error('Start MySQL first: backups are made from the running database.');
    // Repacks share their port and credentials: make sure the MySQL answering is this repack's own.
    const [datadir] = await this.query('SELECT @@datadir');
    const served = path.resolve(String(datadir || '')).toLowerCase();
    if (served !== path.resolve(this.root, 'mysql/data').toLowerCase()) throw new Error('The MySQL running on this port belongs to another server. Stop that server first.');
  }

  async query(sql) {
    const [exe, args] = this.client('mysql.exe', ['-N', '-B', '-e', sql]);
    return new Promise((resolve, reject) => {
      const child = spawn(exe, args, { windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.stderr.on('data', chunk => { err += chunk; });
      child.once('error', reject);
      child.once('exit', code => (code === 0 ? resolve(out.split(/\r?\n/).filter(Boolean)) : reject(new Error(err.trim().split(/\r?\n/).pop() || 'MySQL refused the query.'))));
    });
  }

  async databases(includeWorld) {
    const present = new Set(await this.query('SHOW DATABASES'));
    // The extra realms of the launcher (Wildcard, Reborn) have their own characters and bots databases.
    const realms = [...present].filter(name => /^acore_(characters|playerbots)_(wildcard|reborn)$/.test(name)).sort();
    return [...DATABASES, ...realms, ...(includeWorld ? OPTIONAL : [])].filter(name => present.has(name));
  }

  async exclusive(work) {
    if (this.busy) throw new Error('A backup or a restore is already running.');
    this.busy = true;
    try { return await work(); } finally { this.busy = false; }
  }

  // Dump straight into gzip: no uncompressed multi-gigabyte file on the way.
  create({ label = '', includeWorld = false, reason = 'manual' } = {}) {
    return this.exclusive(async () => {
      await this.ready();
      const databases = await this.databases(includeWorld);
      if (!databases.length) throw new Error('No game database was found.');
      const tag = String(label).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      const name = `${stamp()}${tag ? `-${tag}` : ''}.sql.gz`;
      await fsp.mkdir(this.folder, { recursive: true });
      const target = path.join(this.folder, name);
      const [exe, args] = this.client('mysqldump.exe', [...DUMP_FLAGS, '--databases', ...databases]);
      this.notify({ phase: 'backup', message: `Saving ${databases.join(', ')}…`, bytes: 0 });
      const child = spawn(exe, args, { windowsHide: true });
      let err = '';
      child.stderr.on('data', chunk => { err += chunk; });
      let bytes = 0;
      child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes % (8 << 20) < chunk.length) this.notify({ phase: 'backup', message: `Saving ${databases.join(', ')}…`, bytes }); });
      const exited = new Promise(resolve => child.once('exit', resolve));
      try {
        await pipeline(child.stdout, zlib.createGzip({ level: 6 }), fs.createWriteStream(`${target}.part`));
        const code = await exited;
        if (code !== 0) throw new Error(err.trim().split(/\r?\n/).pop() || `mysqldump failed (exit ${code}).`);
        await fsp.rename(`${target}.part`, target);
      } catch (error) {
        await fsp.rm(`${target}.part`, { force: true });
        throw error;
      }
      const size = (await fsp.stat(target)).size;
      const meta = { name, createdAt: new Date().toISOString(), databases, label: String(label).slice(0, 80), reason, size, dumpedBytes: bytes };
      await fsp.writeFile(target.replace(/\.sql\.gz$/, '.json'), JSON.stringify(meta, null, 2));
      this.notify({ phase: 'done', message: 'Backup saved.' });
      return meta;
    });
  }

  async list() {
    const names = (await fsp.readdir(this.folder).catch(() => [])).filter(name => NAME.test(name)).sort().reverse();
    const list = [];
    for (const name of names) {
      const file = path.join(this.folder, name);
      const stat = await fsp.stat(file);
      let meta = {};
      try { meta = JSON.parse(await fsp.readFile(file.replace(/\.sql\.gz$/, '.json'), 'utf8')); } catch {}
      list.push({ name, size: stat.size, createdAt: meta.createdAt || stat.mtime.toISOString(), databases: Array.isArray(meta.databases) ? meta.databases : [], label: String(meta.label || ''), reason: String(meta.reason || '') });
    }
    return list;
  }

  file(name) {
    if (!NAME.test(String(name))) throw new Error('Unknown backup.');
    const file = path.join(this.folder, name);
    if (!fs.existsSync(file)) throw new Error('This backup no longer exists.');
    return file;
  }

  async remove(name) {
    const file = this.file(name);
    await fsp.rm(file);
    await fsp.rm(file.replace(/\.sql\.gz$/, '.json'), { force: true });
  }

  // Restores a backup over the current databases. The world must be stopped (players and bots
  // would write over it); the current state is saved first, so a restore can itself be undone.
  async restore(name, { worldPort } = {}) {
    const file = this.file(name);
    if (worldPort && await portOpen(worldPort)) throw new Error('Stop the worldserver before restoring a backup.');
    const safety = await this.create({ label: 'before-restore', reason: 'automatic' });
    return this.exclusive(async () => {
      await this.ready();
      const [exe, args] = this.client('mysql.exe', ['--default-character-set=utf8mb4']);
      this.notify({ phase: 'restore', message: `Restoring ${name}…` });
      const child = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', chunk => { err += chunk; });
      const exited = new Promise(resolve => child.once('exit', resolve));
      await pipeline(fs.createReadStream(file), zlib.createGunzip(), child.stdin);
      const code = await exited;
      if (code !== 0) throw new Error(`${err.trim().split(/\r?\n/).pop() || 'The restore failed.'} The databases as they were just before are in ${safety.name}.`);
      this.notify({ phase: 'done', message: 'Backup restored.' });
      return { restored: name, safety: safety.name };
    });
  }
}

module.exports = { ServerBackup, DATABASES };
