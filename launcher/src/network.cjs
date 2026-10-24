'use strict';
// Who can join the server: this PC only, or other PCs (LAN or Internet).
// The choice is kept in Settings/network.json (a file of ours, which repack updates never ship nor replace)
// and applied to what the repack rewrites at each update: Scripts/manage.py (the realmlist row it resets at
// every start) and the BindIP of both config templates. The launcher applies it again after every update and
// before every start, so the edits are never lost.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const FILE = 'Settings/network.json';
const ADDRESS = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const NAME = /^[\w '().-]{1,32}$/;
const DEFAULT = { mode: 'local', address: '127.0.0.1', name: 'AzerothCore' };

// The choice made in the launcher; without one (chosen: false), what the repack's own files say today, so
// a server opened by hand is shown as it is and never rewritten.
async function readNetwork(root) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(root, FILE), 'utf8'));
    return { mode: value.mode === 'open' ? 'open' : 'local', address: ADDRESS.test(value.address || '') ? value.address : DEFAULT.address, name: NAME.test(value.name || '') ? value.name : DEFAULT.name, chosen: true };
  } catch { return { ...(await currentNetwork(root)), chosen: false }; }
}

async function currentNetwork(root) {
  const read = relative => fs.readFile(path.join(root, relative), 'utf8').catch(() => '');
  const bind = /^\s*BindIP\s*=\s*"([^"]*)"/m.exec(await read('Settings/worldserver.conf.template'))?.[1];
  const row = /UPDATE acore_auth\.realmlist SET name='([^']*)',address='([^']*)'/.exec(await read('Scripts/manage.py'));
  const address = ADDRESS.test(row?.[2] || '') ? row[2] : DEFAULT.address;
  const name = NAME.test(row?.[1] || '') ? row[1] : DEFAULT.name;
  return { mode: bind && bind !== '127.0.0.1' ? 'open' : 'local', address, name };
}

// The IPv4 addresses of this PC on its local networks (what other PCs of the house use).
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.')).map(item => item.address);
}

// Rewrites the realmlist row of manage.py and the BindIP lines; returns the files it changed.
async function applyNetwork(root, wanted) {
  const network = wanted || await readNetwork(root);
  // Nothing chosen in the launcher: the files stay as the player (or the repack) left them.
  if (!wanted && !network.chosen) return [];
  const open = network.mode === 'open';
  const address = open ? network.address : '127.0.0.1';
  const changed = [];
  const edit = async (relative, change) => {
    const file = path.join(root, relative);
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text === null) return;
    const next = change(text);
    if (next === text) return;
    // Written beside, then renamed: a power cut never leaves half a manage.py or template.
    const temp = `${file}.tmp-${process.pid}`;
    await fs.writeFile(temp, next);
    await fs.rename(temp, file);
    changed.push(relative);
  };
  await edit('Scripts/manage.py', text => text.replace(/(UPDATE acore_auth\.realmlist SET name=')[^']*(',address=')[^']*(')/, (_m, a, b, c) => `${a}${network.name.replace(/'/g, '')}${b}${address}${c}`));
  for (const template of ['Settings/authserver.conf.template', 'Settings/worldserver.conf.template']) {
    await edit(template, text => text.replace(/^(\s*BindIP\s*=\s*)"[^"]*"/m, `$1"${open ? '0.0.0.0' : '127.0.0.1'}"`));
  }
  // The remote console (RA, with the repack account) answers this PC only, even on an open server.
  await edit('Settings/worldserver.conf.template', text => text.replace(/^(\s*Ra\.IP\s*=\s*)"[^"]*"/m, '$1"127.0.0.1"'));
  return changed;
}

async function saveNetwork(root, value) {
  const network = { mode: value?.mode === 'open' ? 'open' : 'local', address: String(value?.address || '').trim() || DEFAULT.address, name: String(value?.name || '').trim() || DEFAULT.name };
  if (!ADDRESS.test(network.address)) throw new Error('This is not a valid address (an IP like 192.168.1.50, or a name like play.example.org).');
  if (!NAME.test(network.name)) throw new Error('The realm name uses letters, digits, spaces and . - ( ) only (32 at most).');
  await fs.mkdir(path.join(root, 'Settings'), { recursive: true });
  await fs.writeFile(path.join(root, FILE), JSON.stringify(network, null, 2));
  return { network, changed: await applyNetwork(root, network) };
}

// Windows Firewall: one inbound rule for the login and world ports (the realms' too), never a whole program:
// the remote console port stays closed. Needs the
// administrator: Windows asks the player (UAC); nothing is done without that consent.
function openFirewall(root, ports) {
  const name = `SquidBots ${path.basename(root)}`.replace(/[^\w .-]/g, '');
  const list = [...new Set([ports.auth, ports.world, ...(ports.extra || [])].map(Number).filter(port => port > 0 && port < 65536))];
  const lines = [
    `netsh advfirewall firewall delete rule name="${name} ports" | Out-Null`,
    `netsh advfirewall firewall add rule name="${name} ports" dir=in action=allow protocol=TCP localport=${list.join(',')}`,
    // The program rules of older launchers (every port of the worldservers) are removed.
    ...[0, 1, 2].map(index => `netsh advfirewall firewall delete rule name="${name} program ${index}" | Out-Null`),
  ];
  // The commands go in a script file run elevated: no quoting through two shells.
  const script = path.join(os.tmpdir(), `squidbots-firewall-${process.pid}.ps1`);
  return fs.writeFile(script, lines.join('\r\n') + '\r\n').then(() => new Promise((resolve, reject) => {
    const elevate = `try { Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${script.replace(/'/g, "''")}'; exit 0 } catch { exit 1 }`;
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', elevate], { windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => {
      fs.unlink(script).catch(() => {});
      if (code === 0) resolve(true); else reject(new Error('The firewall was not changed (administrator refused or cancelled).'));
    });
  }));
}

module.exports = { readNetwork, saveNetwork, applyNetwork, lanAddresses, openFirewall };
