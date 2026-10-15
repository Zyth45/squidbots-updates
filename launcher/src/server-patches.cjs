'use strict';
// SQL fixes for a local repack: .sql files dropped in <repack>/Patches/<database>/ (or shipped by
// a release there), applied on demand in name order, each one once. What was applied, and the
// SHA-256 of the file at the time, is kept in .coa-launcher/sql-patches.json; a file changed since
// is shown as such instead of being run again silently. A backup comes before every run.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicJson, readJson } = require('./release-format.cjs');

const DATABASES = ['acore_world', 'acore_characters', 'acore_auth', 'acore_playerbots'];
const FILE = /^[A-Za-z0-9][A-Za-z0-9 _.,()+-]{0,120}\.sql$/;
const STATE = '.coa-launcher/sql-patches.json';
const MAX = 64 * 1024 * 1024;

class ServerPatches {
  constructor(root, backup) {
    this.root = path.resolve(root);
    this.backup = backup;
  }

  async list() {
    const state = (await readJson(path.join(this.root, STATE))) || {};
    const list = [];
    for (const database of DATABASES) {
      const folder = path.join(this.root, 'Patches', database);
      const names = (await fsp.readdir(folder).catch(() => [])).filter(name => FILE.test(name)).sort();
      for (const name of names) {
        const file = path.join(folder, name);
        const stat = await fsp.stat(file);
        if (!stat.isFile() || stat.size > MAX) continue;
        const sha256 = crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
        const id = `${database}/${name}`;
        const applied = state[id];
        list.push({ id, database, name, size: stat.size, status: !applied ? 'pending' : applied.sha256 === sha256 ? 'applied' : 'changed', appliedAt: applied?.appliedAt || null });
      }
    }
    return { folder: path.join(this.root, 'Patches'), databases: DATABASES, patches: list };
  }

  async ensureFolders() {
    for (const database of DATABASES) await fsp.mkdir(path.join(this.root, 'Patches', database), { recursive: true });
    return path.join(this.root, 'Patches');
  }

  run(database, file) {
    const [exe, args] = this.backup.client('mysql.exe', ['--default-character-set=utf8mb4', database]);
    return new Promise((resolve, reject) => {
      const child = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', chunk => { err += chunk; });
      child.once('error', reject);
      child.once('exit', code => (code === 0 ? resolve() : reject(new Error(err.trim().split(/\r?\n/).pop() || 'MySQL refused this file.'))));
      fs.createReadStream(file).pipe(child.stdin);
    });
  }

  // ids: ["acore_world/2026_09_30_fix.sql", ...]; stops at the first file MySQL refuses.
  async apply(ids) {
    const { patches } = await this.list();
    const chosen = patches.filter(patch => ids.includes(patch.id));
    if (!chosen.length) throw new Error('Choose the SQL files to apply.');
    await this.backup.ready();
    const safety = await this.backup.create({ label: 'before-sql', reason: 'automatic', includeWorld: chosen.some(patch => patch.database === 'acore_world') });
    const statePath = path.join(this.root, STATE);
    const state = (await readJson(statePath)) || {};
    const applied = [];
    for (const patch of chosen) {
      const file = path.join(this.root, 'Patches', patch.database, patch.name);
      try { await this.run(patch.database, file); }
      catch (error) { throw new Error(`${patch.name}: ${error.message} Files applied before it: ${applied.length}. Backup: ${safety.name}.`); }
      state[patch.id] = { sha256: crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex'), appliedAt: new Date().toISOString() };
      await atomicJson(statePath, state);
      applied.push(patch.id);
    }
    return { applied, backup: safety.name };
  }
}

module.exports = { ServerPatches, DATABASES };
