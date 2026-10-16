'use strict';
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const { safePath, statOrNull } = require('./release-format.cjs');

const exec = promisify(execFile);
const REALMLIST = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/;

const PROCESS_NAME = /^[\w .-]{1,60}\.exe$/i;

// Game processes with their executable path. A path we cannot read (another user's process)
// comes back empty and is treated as "maybe ours", to stay on the safe side.
async function runningGames(processNames) {
  if (process.platform !== 'win32') return [];
  const names = processNames.filter(name => PROCESS_NAME.test(name));
  if (!names.length) return [];
  const filter = names.map(name => `Name='${name}'`).join(' OR ');
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { $_.Name + '|' + $_.ExecutablePath }`], { windowsHide: true, timeout: 15000 });
  return stdout.split(/\r?\n/).filter(Boolean).map(line => { const [name, file] = line.split('|'); return { name, path: file || '' }; });
}

// Only a game started from this folder blocks changes to it; other clients may keep running.
async function requireGameClosed(processNames, root) {
  const inside = folder => !root || !folder || path.resolve(folder).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep);
  if ((await runningGames(processNames)).some(game => inside(game.path))) throw new Error('Close the game before changing its files.');
}

// Points every realmlist the client may read at our realm; originals are kept once.
async function configureRealmlist(root, realmlist) {
  if (!REALMLIST.test(realmlist)) throw new Error('Invalid realmlist address.');
  const desired = `set realmlist ${realmlist}\r\n`;
  const targets = [];
  if (await statOrNull(await safePath(root, 'realmlist.wtf', { internal: true }))) targets.push('realmlist.wtf');
  const data = path.join(root, 'Data');
  for (const entry of await fs.readdir(data, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && /^[a-z]{2}[A-Z]{2}$/.test(entry.name)) targets.push(`Data/${entry.name}/realmlist.wtf`);
  }
  if (!targets.length) targets.push('realmlist.wtf');
  const backup = async (relative, content) => {
    const file = await safePath(root, `.coa-launcher/realmlist-backup/${relative}`, { internal: true });
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  };
  for (const relative of targets) {
    const file = await safePath(root, relative, { internal: true });
    const current = await fs.readFile(file, 'utf8').catch(() => '');
    if (current === desired) continue;
    if (current) await backup(relative, current);
    await fs.writeFile(file, desired);
  }
  // Config.wtf can also carry a realmlist that overrides the files above.
  const configFile = await safePath(root, 'WTF/Config.wtf', { internal: true });
  const config = await fs.readFile(configFile, 'utf8').catch(() => null);
  if (config && /^SET realmlist /im.test(config)) {
    const updated = config.replace(/^SET realmlist .*$/gim, `SET realmList "${realmlist}"`);
    if (updated !== config) { await backup('WTF/Config.wtf', config); await fs.writeFile(configFile, updated); }
  }
}

// What the client reads today: Config.wtf (it wins when it has one) and every realmlist.wtf.
async function readRealmlist(root) {
  const found = [];
  const read = async relative => {
    const content = await fs.readFile(path.join(root, ...relative.split('/')), 'utf8').catch(() => null);
    const value = content && /^\s*set\s+realmlist\s+"?([^"\r\n]*?)"?\s*$/im.exec(content)?.[1].trim();
    if (value) found.push({ file: relative, value });
  };
  await read('WTF/Config.wtf');
  for (const entry of await fs.readdir(path.join(root, 'Data'), { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && /^[a-z]{2}[A-Z]{2}$/.test(entry.name)) await read(`Data/${entry.name}/realmlist.wtf`);
  }
  await read('realmlist.wtf');
  return found;
}

// The client points at this server when every realmlist it holds names one of our hosts with our login port.
async function realmlistStatus(root, { hosts, port }) {
  const files = await readRealmlist(root);
  const expected = `127.0.0.1${port !== 3724 ? `:${port}` : ''}`;
  const good = value => {
    const [host, given] = value.toLowerCase().split(':');
    return hosts.includes(host) && Number(given || 3724) === port;
  };
  return { state: !files.length ? 'missing' : files.every(item => good(item.value)) ? 'ok' : 'wrong', files, expected };
}

function launch(root, executable, onExit) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, path.basename(executable)), [], { cwd: root, detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => resolve(child));
    child.once('exit', code => onExit(code));
  });
}

module.exports = { runningGames, requireGameClosed, configureRealmlist, readRealmlist, realmlistStatus, launch, REALMLIST };
