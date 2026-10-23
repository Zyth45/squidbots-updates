'use strict';
// Starts, stops and watches the services of a local repack (MySQL, authserver, worldserver,
// launcher API). A service is "running" when its port answers; only programs that live inside
// the repack folder can be started or stopped.
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const net = require('node:net');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const exec = promisify(execFile);
const SERVICE_ID = /^[a-z][a-z0-9-]{1,20}$/;
const ACCOUNT = /^[A-Za-z0-9]{3,17}$/;
const PASSWORD = /^[\x21-\x7E]{6,16}$/;

// A command is a program inside the repack plus its arguments, e.g. a repack's own manager script.
function validateCommand(value, label) {
  if (!value) return null;
  if (typeof value.exe !== 'string' || path.isAbsolute(value.exe) || value.exe.split(/[\\/]/).includes('..') || !/\.exe$/i.test(value.exe)) throw new Error(`${label}: exe must be a relative path inside the repack.`);
  const args = (value.args || []).map(String);
  if (args.some(arg => arg.includes('..'))) throw new Error(`${label}: arguments cannot leave the repack folder.`);
  return { exe: value.exe, args, timeout: Math.min(600, Math.max(5, Number(value.timeout) || 180)) };
}

function validateServices(list) {
  if (!Array.isArray(list) || !list.length || list.length > 8) throw new Error('A local realm needs a list of services.');
  const ids = new Set();
  return list.map(service => {
    if (!SERVICE_ID.test(service.id) || ids.has(service.id)) throw new Error(`Invalid service id: ${service.id}`);
    ids.add(service.id);
    const start = validateCommand(service.start, `${service.id} start`);
    // Another way to start the same service when a file is there (the bot-enabled worldserver of
    // CoA Bots when it is installed): the first match wins, the plain start otherwise.
    const alternatives = (service.alternatives || []).slice(0, 4).map((item, index) => {
      if (typeof item.exists !== 'string' || path.isAbsolute(item.exists) || item.exists.split(/[\\/]/).includes('..')) throw new Error(`${service.id}: alternatives need a relative "exists" path.`);
      return { exists: item.exists, label: String(item.label || '').slice(0, 40), start: validateCommand(item.start, `${service.id} alternative ${index + 1}`) };
    });
    const stop = validateCommand(service.stop, `${service.id} stop`);
    if (!start && (typeof service.exe !== 'string' || path.isAbsolute(service.exe) || service.exe.split(/[\\/]/).includes('..') || !/\.exe$/i.test(service.exe))) throw new Error(`${service.id}: exe must be a relative path inside the repack.`);
    const port = Number(service.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${service.id}: invalid port.`);
    const args = (service.args || []).map(String);
    if (args.some(arg => arg.includes('..'))) throw new Error(`${service.id}: arguments cannot leave the repack folder.`);
    return {
      id: service.id, name: String(service.name || service.id).slice(0, 30), exe: service.exe || '', args, port, start, stop, alternatives,
      cwd: typeof service.cwd === 'string' && !path.isAbsolute(service.cwd) && !service.cwd.includes('..') ? service.cwd : path.dirname(service.exe || '.'),
      console: service.console === true,
      stopCommand: typeof service.stopCommand === 'string' ? service.stopCommand.slice(0, 80) : '',
      stopExe: typeof service.stopExe === 'string' && !path.isAbsolute(service.stopExe) && !service.stopExe.includes('..') ? service.stopExe : '',
      stopArgs: (service.stopArgs || []).map(String),
      startTimeout: Math.min(600, Math.max(10, Number(service.startTimeout) || 120)),
    };
  });
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 800 });
    const done = ok => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

class ServerControl {
  constructor({ root, services, commands = {}, notify = () => {}, onAuthStarted = null }) {
    this.onAuthStarted = onAuthStarted;
    this.root = path.resolve(root);
    this.services = services;
    this.commands = commands;
    this.notify = notify;
    this.children = new Map();
    this.states = new Map();
  }

  // Runs a repack command to completion, logging its output; stdin lines are sent then closed.
  async run(command, logId, input = [], secrets = []) {
    const exe = this.resolve(command.exe);
    if (!fs.existsSync(exe)) throw new Error(`${command.exe} is missing. Install or repair the repack first.`);
    await fsp.mkdir(path.dirname(this.logFile(logId)), { recursive: true });
    return new Promise((resolve, reject) => {
      const child = spawn(exe, command.args.map(arg => arg.replace(/\{root\}/g, this.root)), { cwd: this.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      const collect = chunk => { output += chunk.toString(); if (output.length > 200000) output = output.slice(-100000); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      for (const line of input) child.stdin.write(`${line}\r\n`);
      child.stdin.end();
      const timer = setTimeout(() => { child.kill(); reject(new Error(`${command.exe} took too long.`)); }, command.timeout * 1000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => {
        clearTimeout(timer);
        for (const secret of secrets) output = output.split(secret).join('********');
        fs.appendFileSync(this.logFile(logId), `\n==== ${new Date().toISOString()} ${path.basename(command.exe)} ${command.args.join(' ')} (exit ${code}) ====\n${output}`);
        if (code === 0) resolve(output);
        else reject(new Error(output.split(/\r?\n/).filter(Boolean).slice(-2).join(' ') || `${command.exe} failed (exit ${code}).`));
      });
    });
  }

  resolve(relative) {
    const file = path.resolve(this.root, relative);
    if (!file.startsWith(this.root + path.sep)) throw new Error('Path outside the repack folder.');
    return file;
  }

  logFile(id) { return path.join(this.root, 'logs', `launcher-${id}.log`); }

  // Who listens on a port: { pid, file, inside } (inside = a program of this repack). Several
  // repacks use the same ports, so an answering port is not proof that this server is running.
  async portOwner(port) {
    if (process.platform !== 'win32') return null;
    const { stdout } = await exec('netstat.exe', ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 10000 }).catch(() => ({ stdout: '' }));
    const line = stdout.split(/\r?\n/).find(row => new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+\\d+`).test(row));
    const pid = Number(line?.trim().split(/\s+/).pop());
    if (!pid) return null;
    this.paths ||= new Map();
    if (!this.paths.has(pid)) {
      const { stdout: exePath } = await exec('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).Path`], { windowsHide: true, timeout: 10000 }).catch(() => ({ stdout: '' }));
      if (this.paths.size > 64) this.paths.clear();
      this.paths.set(pid, exePath.trim());
    }
    const file = this.paths.get(pid);
    if (!file) return { pid, file: '', inside: null };
    return { pid, file, inside: path.resolve(file).toLowerCase().startsWith(this.root.toLowerCase() + path.sep) };
  }

  processAlive(id) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(this.root, '.state', `${id}.json`), 'utf8'));
      if (!record?.pid || !String(record.exe || '').toLowerCase().startsWith(this.root.toLowerCase())) return false;
      process.kill(Number(record.pid), 0);
      return true;
    } catch { return false; }
  }

  async status() {
    const result = [];
    for (const service of this.services) {
      const open = await portOpen(service.port);
      const transient = this.states.get(service.id);
      let state = transient && (transient === 'starting' ? !open : open) ? transient : open ? 'running' : 'stopped';
      // The repack records the process it started (.state/<service>.json): alive with its port still closed,
      // the service is loading (a first world start with bots takes minutes), not stopped.
      if (state === 'stopped' && this.processAlive(service.id)) state = 'starting';
      let other = '';
      if (state === 'running') {
        const owner = await this.portOwner(service.port);
        if (owner?.inside === false) { state = 'foreign'; other = owner.file; }
      }
      result.push({ id: service.id, name: service.name, port: service.port, state, other, variant: this.variant(service), managed: this.children.has(service.id), console: service.console && this.children.has(service.id) });
    }
    return result;
  }

  async assertPortFree(service) {
    if (!(await portOpen(service.port))) return false;
    const owner = await this.portOwner(service.port);
    if (owner?.inside === false) throw new Error(`${service.name}: port ${service.port} is used by another program (${owner.file}). Stop it first.`);
    return true;
  }

  async emit() { this.notify(await this.status()); }

  async start(id) {
    const service = this.services.find(item => item.id === id);
    if (!service) throw new Error('Unknown service.');
    if (await this.assertPortFree(service)) return;
    const start = this.startCommand(service);
    if (start) {
      // The repack's own manager starts the service (and whatever it depends on) and waits for it.
      this.states.set(id, 'starting');
      await this.emit();
      try { await this.run({ ...start, timeout: Math.max(start.timeout, service.startTimeout) }, id); }
      finally { this.states.delete(id); await this.emit(); }
      if (!(await portOpen(service.port))) throw new Error(`${service.name} did not open port ${service.port}. Look at its log.`);
      if (id === 'auth') await this.onAuthStarted?.().catch(() => {});
      return;
    }
    const exe = this.resolve(service.exe);
    if (!fs.existsSync(exe)) throw new Error(`${service.name}: ${service.exe} is missing. Install or repair the repack first.`);
    await fsp.mkdir(path.dirname(this.logFile(id)), { recursive: true });
    const log = fs.openSync(this.logFile(id), 'a');
    fs.writeSync(log, `\n==== ${new Date().toISOString()} started by the launcher ====\n`);
    const child = spawn(exe, service.args.map(arg => arg.replace(/\{root\}/g, this.root)), {
      cwd: this.resolve(service.cwd || '.'), windowsHide: true, detached: false,
      stdio: [service.console ? 'pipe' : 'ignore', log, log],
    });
    fs.closeSync(log);
    this.children.set(id, child);
    this.states.set(id, 'starting');
    child.once('exit', () => { this.children.delete(id); this.states.delete(id); this.emit().catch(() => {}); });
    child.once('error', () => { this.children.delete(id); this.states.delete(id); });
    await this.emit();
    const deadline = Date.now() + service.startTimeout * 1000;
    while (Date.now() < deadline) {
      if (!this.children.has(id)) throw new Error(`${service.name} stopped while starting. Look at its log.`);
      if (await portOpen(service.port)) { this.states.delete(id); await this.emit(); if (id === 'auth') await this.onAuthStarted?.().catch(() => {}); return; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    this.states.delete(id);
    await this.emit();
    throw new Error(`${service.name} did not open port ${service.port} in time. Look at its log.`);
  }

  startCommand(service) {
    if (this.withBots === false) return service.start;
    const alternative = (service.alternatives || []).find(item => fs.existsSync(path.join(this.root, item.exists)));
    return alternative?.start || service.start;
  }

  // Which variant a service will start with, for the page ("Worldserver · with CoA Bots").
  variant(service) {
    if (this.withBots === false) return '';
    return (service.alternatives || []).find(item => fs.existsSync(path.join(this.root, item.exists)))?.label || '';
  }

  // The worldserver applies the updates of the auth database too: the authserver starts once the world is up
  // (an authserver of CoA Bots 2.6 stops at start when its new tables are not there yet).
  async startAll() {
    const order = [...this.services.filter(service => service.id !== 'auth'), ...this.services.filter(service => service.id === 'auth')];
    for (const service of order) await this.start(service.id);
  }

  // Finds the process listening on a port and returns it only if it lives in the repack folder.
  async ownedProcess(port) {
    if (process.platform !== 'win32') return null;
    const { stdout } = await exec('netstat.exe', ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 10000 });
    const line = stdout.split(/\r?\n/).find(row => new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+\\d+`).test(row));
    const pid = Number(line?.trim().split(/\s+/).pop());
    if (!pid) return null;
    const { stdout: exePath } = await exec('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).Path`], { windowsHide: true, timeout: 10000 });
    const file = exePath.trim();
    return file && path.resolve(file).toLowerCase().startsWith(this.root.toLowerCase() + path.sep) ? { pid, file } : null;
  }

  async stop(id) {
    const service = this.services.find(item => item.id === id);
    if (!service) throw new Error('Unknown service.');
    if (!(await portOpen(service.port))) return;
    // A service started by the repack's manager is stopped the way the manager wants: all together, in order.
    if (service.start && !service.stop && this.commands.stopAll) { await this.stopAll(); return; }
    this.states.set(id, 'stopping');
    await this.emit();
    const child = this.children.get(id);
    try {
      if (service.stop) {
        await this.run(service.stop, id);
      } else if (child && service.console && service.stopCommand) {
        child.stdin.write(`${service.stopCommand}\r\n`);
      } else if (service.stopExe) {
        await exec(this.resolve(service.stopExe), service.stopArgs, { cwd: this.root, windowsHide: true, timeout: 60000 });
      } else if (child) {
        await exec('taskkill.exe', ['/PID', String(child.pid), '/T'], { windowsHide: true }).catch(() => {});
      } else {
        const owner = await this.ownedProcess(service.port);
        if (!owner) throw new Error(`${service.name} was not started from this repack; stop it where it was started.`);
        await exec('taskkill.exe', ['/PID', String(owner.pid), '/T'], { windowsHide: true }).catch(() => {});
      }
      const deadline = Date.now() + 90 * 1000;
      while (Date.now() < deadline && await portOpen(service.port)) await new Promise(resolve => setTimeout(resolve, 1000));
      if (await portOpen(service.port)) {
        const owner = child ? { pid: child.pid } : await this.ownedProcess(service.port);
        if (owner) await exec('taskkill.exe', ['/PID', String(owner.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      }
    } finally {
      this.states.delete(id);
      await this.emit();
    }
  }

  async stopAll() {
    if (this.commands.stopAll) {
      for (const service of this.services) this.states.set(service.id, 'stopping');
      await this.emit();
      try {
        // A worldserver that has only just started may refuse the graceful-shutdown connection:
        // one more try a few seconds later, before reporting a failure.
        try { await this.run(this.commands.stopAll, 'stop-all'); }
        catch {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay ?? 15000));
          await this.run(this.commands.stopAll, 'stop-all');
        }
      } finally { this.states.clear(); await this.emit(); }
      return;
    }
    for (const service of [...this.services].reverse()) await this.stop(service.id);
  }

  // Creates a game account through the repack console command, or the worldserver we started.
  async createAccount(name, password, gm) {
    if (!ACCOUNT.test(name) || !PASSWORD.test(password)) throw new Error('Account names use 3-17 letters or digits; passwords 6-16 characters without spaces.');
    if (this.commands.console) {
      const lines = [`account create ${name} ${password}`, ...(gm ? [`account set gmlevel ${name} 3 -1`] : []), 'exit'];
      const output = await this.run(this.commands.console, 'console', lines, [password]);
      // The password went through stdin only; strip it from anything we keep or show.
      // The console echoes its "AC>" prompt around each answer: keep the answers only.
      return output.split(password).join('********').split(/\r?\n/).map(line => line.replace(/AC>\s*/g, '').trim())
        .filter(line => line && !/^World console/i.test(line)).slice(-6).join('\n');
    }
    const world = this.services.find(service => service.console);
    const child = world && this.children.get(world.id);
    if (!child?.stdin?.writable) throw new Error('Start the worldserver from the launcher first.');
    child.stdin.write(`account create ${name} ${password}\r\n`);
    if (gm) child.stdin.write(`account set gmlevel ${name} 3 -1\r\n`);
  }

  async tail(id, lines = 200) {
    if (!this.services.some(service => service.id === id)) throw new Error('Unknown service.');
    const file = this.logFile(id);
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat) return '';
    const size = Math.min(stat.size, 256 * 1024);
    const handle = await fsp.open(file, 'r');
    try {
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, stat.size - size);
      return buffer.toString('utf8').split(/\r?\n/).slice(-lines).join('\n');
    } finally { await handle.close(); }
  }

  shutdownOnExit() {
    for (const child of this.children.values()) child.stdin?.writable && child.stdin.write('server shutdown 1\r\n');
  }
}

module.exports = { ServerControl, validateServices, validateCommand, portOpen };
