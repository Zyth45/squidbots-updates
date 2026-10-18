'use strict';
// The bot package on top of a repack (CoA Bots): a signed release unpacked in <repack>/<folder>,
// then its own installer, which prepares the bot database and settings. The installer skips what is
// already done, so the same two steps install the package and bring it up to date.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { ClientUpdater } = require('./client-updater.cjs');

const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

class BotsPackage {
  constructor({ bots, key, notify = () => {}, onLine = () => {}, fetchImpl }) {
    this.bots = bots;
    this.onLine = onLine;
    // No channel of their own (the bots come inside the repack updates): an updater that never downloads.
    const url = bots.channelUrl || bots.manifestUrl;
    this.updater = url ? new ClientUpdater({ manifestUrl: url, requiredExecutable: bots.requiredExecutable, publicKey: key, rules: 'server', area: 'bots', notify, ...(fetchImpl ? { fetchImpl } : {}) }) : {
      status: { phase: 'idle' }, busy: false,
      installedVersion: async () => '', installedState: async () => null,
      check: async () => ({ needsUpdate: false, files: 0, bytes: 0 }),
      peek: async () => { throw new Error('The bots are updated with the repack.'); },
      update: async () => { throw new Error('The bots are updated with the repack.'); },
      cancel() {},
    };
    this.child = null;
  }

  folder(root) { return path.join(root, this.bots.folder); }

  async info(root) {
    if (!root) return { installed: false };
    const folder = this.folder(root);
    let release = null;
    try { release = JSON.parse((await fsp.readFile(path.join(folder, 'release.json'), 'utf8')).replace(/^\uFEFF/, '')); } catch {}
    return {
      // A full repack ships the bots folder: they are installed once their installer has run (it writes
      // playerbots.conf), not as soon as the files are there.
      installed: fs.existsSync(path.join(folder, this.bots.requiredExecutable)) && fs.existsSync(path.join(folder, 'Core', 'configs', 'modules', 'playerbots.conf')),
      packaged: fs.existsSync(path.join(folder, this.bots.requiredExecutable)),
      version: String(release?.version || await this.updater.installedVersion(folder).catch(() => '') || ''),
      builtFor: String(release?.release || ''),
      progress: this.updater.status,
      installing: !!this.child,
    };
  }

  check(root, options) { return this.updater.check(this.folder(root), options); }

  async install(root, options = {}) {
    await this.updater.update(this.folder(root), options);
    return this.runInstaller(root);
  }

  // Runs the package's installer without a console: it asks nothing when it cannot (defaults are used).
  async runInstaller(root) {
    if (this.child) throw new Error('The bot installer is already running.');
    const script = path.join(this.folder(root), ...this.bots.install.script.split('/'));
    if (!script.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(script)) throw new Error('This server folder has no CoA Bots in it (CoA-Bots\\Installer-Bots.ps1 is missing): it is another repack, or the CoA-Bots folder was moved. Choose the folder of the CoA Bots repack, or get it with "Download the server" on the home page.');
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...this.bots.install.args.map(arg => arg.replace(/\{root\}/g, path.resolve(root)))];
    const log = path.join(root, 'logs', 'launcher-bots-install.log');
    await fsp.mkdir(path.dirname(log), { recursive: true });
    await fsp.appendFile(log, `\n==== ${new Date().toISOString()} ${this.bots.install.script} ====\n`);
    const lines = [];
    const code = await new Promise((resolve, reject) => {
      const child = spawn(POWERSHELL, args, { cwd: this.folder(root), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      const timer = setTimeout(() => child.kill(), this.bots.install.timeout * 1000);
      let partial = '';
      const take = chunk => {
        partial += chunk.toString('utf8');
        const parts = partial.split(/\r?\n/);
        partial = parts.pop();
        for (const line of parts) { lines.push(line); fs.appendFile(log, `${line}\n`, () => {}); this.onLine(line); }
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.once('error', error => { clearTimeout(timer); this.child = null; reject(error); });
      child.once('exit', exitCode => { clearTimeout(timer); this.child = null; if (partial) { lines.push(partial); this.onLine(partial); } resolve(exitCode); });
    });
    if (code !== 0) throw new Error(lines.map(line => line.trim()).filter(Boolean).slice(-2).join(' ') || `The bot installer stopped (exit ${code}).`);
    return { ok: true, lines: lines.slice(-40) };
  }
}

module.exports = { BotsPackage };
