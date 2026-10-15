'use strict';
// The SquidBots dashboard (CoA-Bots/Dashboard/squidbots.py): started with the repack's own Python,
// local only (it listens on localhost), shown inside the launcher, stopped with it.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const portOpen = port => new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port });
  socket.setTimeout(800);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
  socket.once('error', () => resolve(false));
});

class Dashboard {
  constructor({ botsFolder = 'CoA-Bots' } = {}) {
    this.botsFolder = botsFolder;
    this.child = null;
    this.root = '';
  }

  paths(root) {
    // CoA Bots 2.x keeps it in Tools\Dashboard, older ones in Dashboard.
    const tools = path.join(root, this.botsFolder, 'Tools', 'Dashboard');
    const folder = fs.existsSync(path.join(tools, 'squidbots.py')) ? tools : path.join(root, this.botsFolder, 'Dashboard');
    return { folder, script: path.join(folder, 'squidbots.py'), python: path.join(root, 'Runtime', 'python', 'python.exe'), settings: path.join(folder, 'dashboard.json') };
  }

  async port(root) {
    try { return Number(JSON.parse(await fsp.readFile(this.paths(root).settings, 'utf8')).port) || 8088; } catch { return 8088; }
  }

  async status(root) {
    if (!root) return { available: false };
    const { script, python } = this.paths(root);
    const available = fs.existsSync(script) && fs.existsSync(python);
    const port = await this.port(root);
    const running = available && await portOpen(port);
    let version = '';
    try { version = /^##\s*([\d.]+)/m.exec(fs.readFileSync(path.join(this.paths(root).folder, 'CHANGELOG.md'), 'utf8'))?.[1] || ''; } catch {}
    return { available, running, managed: !!this.child && this.root === root, port, url: `http://localhost:${port}/`, version };
  }

  async start(root) {
    const { folder, script, python } = this.paths(root);
    if (!fs.existsSync(script)) throw new Error('The bots dashboard is not installed with this server (install the bots).');
    if (!fs.existsSync(python)) throw new Error('This repack has no Python (Runtime/python).');
    const port = await this.port(root);
    if (await portOpen(port)) return this.status(root);
    if (this.child) this.stop();
    await fsp.mkdir(path.join(root, 'logs'), { recursive: true });
    const log = fs.createWriteStream(path.join(root, 'logs', 'launcher-dashboard.log'), { flags: 'a' });
    log.write(`\n==== ${new Date().toISOString()} squidbots.py ====\n`);
    const child = spawn(python, ['-B', script], { cwd: folder, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    this.child = child;
    this.root = root;
    let exited = null;
    child.once('exit', code => { exited = code; if (this.child === child) this.child = null; });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await portOpen(port)) return this.status(root);
      if (exited !== null) throw new Error(`The dashboard stopped at once (code ${exited}). See logs/launcher-dashboard.log.`);
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    throw new Error('The dashboard did not answer in 30 seconds. See logs/launcher-dashboard.log.');
  }

  stop() {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;
    // The dashboard runs a few threads: end the whole process tree.
    if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill();
  }
}

module.exports = { Dashboard, portOpen };
