'use strict';
// Moving a local server to a new version of the repack, the way that keeps the players' progress:
// the new version is installed in a folder of its own (its database ready and up to date), then
// the accounts, characters and bots are copied over from the old one, which stays untouched as the
// way back. The copy is done by Migrate-Accounts.py (bundled here), run with the new repack's own
// Python: it streams the databases from one MySQL to the other, applies the character database
// migrations the old one had not had, and backs up the new install first.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { portOpen } = require('./server-control.cjs');

const SCRIPT = path.join(__dirname, 'data', 'Migrate-Accounts.py');
const REQUIRED = ['Settings/repack.json', 'Core/worldserver.exe', 'mysql/bin/mysqld.exe'];

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

// What a folder holds: is it a repack, which release, with or without CoA Bots, ever started.
function inspect(folder) {
  const root = path.resolve(String(folder || ''));
  const missing = REQUIRED.filter(relative => !fs.existsSync(path.join(root, relative)));
  const release = readJsonFile(path.join(root, 'RELEASE.json')) || {};
  const bots = readJsonFile(path.join(root, 'CoA-Bots/release.json'));
  const settings = readJsonFile(path.join(root, 'Settings/repack.json')) || {};
  const state = readJsonFile(path.join(root, '.coa-launcher/server/state.json'));
  return {
    path: root,
    repack: missing.length === 0,
    missing,
    release: String(release.releaseId || state?.version || ''),
    releaseDate: String(release.releaseDate || ''),
    bots: bots ? { version: String(bots.version || ''), release: String(bots.release || '') } : null,
    started: fs.existsSync(path.join(root, 'mysql/admin-client.ini')),
    hasData: fs.existsSync(path.join(root, 'mysql/data/acore_characters')),
    ports: { mysql: Number(settings.mysqlPort) || 0, auth: Number(settings.authPort) || 0, world: Number(settings.worldPort) || 0 },
  };
}

// A new folder next to the current one, named after the release it will hold.
function suggestFolder(current, version) {
  const parent = path.dirname(path.resolve(current));
  // "CoA-Repack-jealous-20260925" + "jealous-20260929" -> "CoA-Repack-jealous-20260929", not "…-jealous-jealous-…".
  // Same for "CoA-Repack-coa-core-20260929-…": every lower-case word before the date belongs to the old version.
  const base = `${path.basename(current).replace(/-(?:[a-z]+-)*\d{8}.*$/, '')}-${String(version || 'new').replace(/[^A-Za-z0-9.-]+/g, '-')}`.slice(0, 80);
  let candidate = path.join(parent, base);
  for (let i = 2; fs.existsSync(candidate) && i < 100; i++) candidate = path.join(parent, `${base}-${i}`);
  return candidate;
}

// Parses the script's summary lines ("accounts   : 12").
function summarize(lines) {
  const out = {};
  for (const line of lines) {
    const count = /^\s*(old|new) install: (\d+) accounts, (\d+) characters/.exec(line);
    if (count) out[count[1]] = { accounts: Number(count[2]), characters: Number(count[3]) };
    const result = /^\s{4}(accounts|characters|backup)\s*:\s*(.+)$/.exec(line);
    if (result) (out.result ||= {})[result[1]] = result[1] === 'backup' ? result[2].trim() : Number(result[2]);
    const bots = /Of the old characters, (\d+) belong to bot accounts and (\d+) do not/.exec(line);
    if (bots) out.oldBots = { bots: Number(bots[1]), players: Number(bots[2]) };
    if (/These accounts exist in both installs/.test(line)) out.clashes = true;
    const existing = /The new install already has (\d+) characters/.exec(line);
    if (existing) out.newHasCharacters = Number(existing[1]);
  }
  return out;
}

class ServerUpgrade {
  constructor({ notify = () => {} } = {}) {
    this.notify = notify;
    this.child = null;
  }

  get busy() { return !!this.child; }

  // Copies accounts/characters/bots from `from` into `to`. check=true only reports.
  async migrate({ from, to, check = false, force = false, noBots = false }) {
    if (this.child) throw new Error('A migration is already running.');
    const source = inspect(from);
    const target = inspect(to);
    if (!source.repack) throw new Error(`The old folder is not a repack (${source.missing.join(', ')} missing).`);
    if (!target.repack) throw new Error(`The new folder is not a repack (${target.missing.join(', ')} missing).`);
    if (source.path.toLowerCase() === target.path.toLowerCase()) throw new Error('The old and the new folder are the same one.');
    if (!source.hasData) throw new Error('The old repack has no database to copy.');
    if (!target.started) throw new Error('Start the new server once (then stop it): its database is created at the first start.');
    for (const repack of [source, target]) {
      if (repack.ports.world && await portOpen(repack.ports.world)) throw new Error(`Stop the worldserver of ${repack.path} first.`);
    }
    const python = path.join(target.path, 'Runtime/python/python.exe');
    if (!fs.existsSync(python)) throw new Error('The new repack has no Runtime/python to run the migration.');
    const script = path.join(target.path, '.coa-launcher', 'Migrate-Accounts.py');
    await fsp.mkdir(path.dirname(script), { recursive: true });
    await fsp.writeFile(script, await fsp.readFile(SCRIPT));
    const args = ['-B', '-u', script, source.path, '--to', target.path, '--yes'];
    if (check) args.push('--check');
    if (force) args.push('--force');
    if (noBots) args.push('--no-bots');
    const lines = [];
    const log = path.join(target.path, 'logs', 'launcher-migration.log');
    await fsp.mkdir(path.dirname(log), { recursive: true });
    await fsp.appendFile(log, `\n==== ${new Date().toISOString()} migrate ${check ? '(check) ' : ''}${source.path} -> ${target.path} ====\n`);
    const code = await new Promise((resolve, reject) => {
      const child = spawn(python, args, { cwd: target.path, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      this.child = child;
      let partial = '';
      const take = chunk => {
        partial += chunk.toString('utf8');
        const parts = partial.split(/\r?\n/);
        partial = parts.pop();
        for (const line of parts) {
          lines.push(line);
          fs.appendFile(log, `${line}\n`, () => {});
          this.notify({ line });
        }
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.once('error', error => { this.child = null; reject(error); });
      child.once('exit', exitCode => {
        this.child = null;
        if (partial) { lines.push(partial); this.notify({ line: partial }); }
        resolve(exitCode);
      });
    });
    const summary = summarize(lines);
    if (code !== 0) {
      const last = lines.map(line => line.trim()).filter(Boolean).slice(-3).join(' ');
      const error = new Error(last || `The migration stopped (exit ${code}).`);
      error.summary = summary;
      throw error;
    }
    return { ok: true, check, summary, lines: lines.slice(-60) };
  }

  cancel() {
    if (this.child) this.child.kill();
  }
}

module.exports = { ServerUpgrade, inspect, suggestFolder, summarize };
