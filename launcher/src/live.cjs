'use strict';
// The live state of a running server, for the home page and the Console tab:
// - commands go to the worldserver's remote console (RA, 127.0.0.1 only, the repack's own account);
// - "server info" gives the players online and the update time (tick);
// - the worldserver's memory and CPU come from Windows; the bots in game from CoA-Bots' bot-status.json.
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

function raSettings(root) {
  const settings = readJson(path.join(root, 'Settings', 'repack.json')) || {};
  return { port: Number(settings.raPort) || 3443, user: String(settings.raUsername || 'local'), password: String(settings.raPassword || 'local') };
}

// One command on the remote console: log in, send it, read until the next prompt.
// The socket is never closed while the world may still write its answer: cores before CoA Bots 2.4 crash when
// they write to a closed RA connection (RASession::Send throws). After the timeout the caller gets its error,
// but the connection stays open until the answer and the next prompt came (10 minutes at most).
const LINGER = 10 * 60 * 1000;
const openOn = new Map();
const raOpen = root => (openOn.get(root) || 0) > 0;
// The remote console of a realm (same server, its own RA port) still busy with an earlier question.
const raBusy = (root, port) => raOpen(port ? `${root}|${Number(port)}` : root);
// portOverride: the RA port of another realm of the same server (same RA account, shared auth database).
function raCommand(root, command, timeout = 15000, portOverride = 0) {
  const { port: own, user, password } = raSettings(root);
  const port = Number(portOverride) || own;
  if (portOverride) root = `${root}|${port}`;
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    openOn.set(root, (openOn.get(root) || 0) + 1);
    let counted = true;
    const uncount = () => { if (counted) { counted = false; openOn.set(root, openOn.get(root) - 1); } };
    let data = '';
    let step = 0;
    let settled = false;
    const settle = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const close = () => { clearTimeout(timer); clearTimeout(linger); socket.destroy(); uncount(); };
    const done = (error, value) => { settle(error, value); close(); };
    // Logged in and the command sent: the world will answer, so the connection waits for it.
    const timer = setTimeout(() => { if (step < 3) done(new Error('The world console did not answer in time.')); else settle(new Error('The world console did not answer in time.')); }, timeout);
    const linger = setTimeout(close, Math.max(timeout, LINGER));
    socket.on('error', () => done(new Error('The world console is not reachable: start the worldserver first.')));
    socket.on('close', () => { settle(new Error('The world console closed the connection.')); clearTimeout(linger); uncount(); });
    socket.on('data', chunk => {
      data += chunk.toString('utf8');
      if (data.length > 262144) data = data.slice(-4096);
      if (step === 0 && data.includes('Username:')) { step = 1; data = ''; socket.write(`${user}\r\n`); }
      else if (step === 1 && data.includes('Password:')) { step = 2; data = ''; socket.write(`${password}\r\n`); }
      else if (step === 2 && /AC>\s*$/.test(data)) { step = 3; data = ''; socket.write(`${command}\r\n`); if (/^\.?server (shutdown|restart)/i.test(command)) settle(null, 'Requested.'); }
      else if (step === 2 && /(failed|denied|wrong)/i.test(data)) done(new Error('The world console refused the repack account (Settings\\repack.json).'));
      else if (step === 3 && /AC>\s*$/.test(data)) done(null, data.replace(/AC>\s*$/, '').trim());
    });
  });
}

// "server info": players and update time. The wording differs between cores: numbers are read loosely.
function parseInfo(text) {
  const num = pattern => { const m = pattern.exec(text); return m ? Number(m[1]) : null; };
  return {
    players: num(/Connected players:\s*(\d+)/i) ?? num(/players online:\s*(\d+)/i),
    characters: num(/Characters in world:\s*(\d+)/i),
    tick: num(/Update time diff:\s*(\d+)/i),
    tickMean: num(/(?:Mean|average)[^\d]{0,12}(\d+)\s*ms/i),
    uptime: /uptime:\s*([^\r\n.]+)/i.exec(text)?.[1]?.trim() || '',
  };
}

// The worldserver process of this repack (its pid is in .state\world.json, written by manage.py).
function worldPid(root) {
  const record = readJson(path.join(root, '.state', 'world.json'));
  return record?.pid && String(record.exe || '').toLowerCase().startsWith(root.toLowerCase()) ? Number(record.pid) : null;
}

let lastCpu = null;
// tasklist (much lighter than starting PowerShell): memory in KB, CPU time in h:mm:ss with /V.
function tasklistRow(pid, verbose) {
  return new Promise(resolve => {
    execFile('tasklist.exe', ['/FI', `PID eq ${Number(pid)}`, '/FO', 'CSV', '/NH', ...(verbose ? ['/V'] : [])], { windowsHide: true, timeout: 8000 }, (error, out) => {
      const cells = (String(out || '').match(/"[^"]*"/g) || []).map(cell => cell.slice(1, -1));
      if (error || Number(cells[1]) !== Number(pid)) return resolve(null);
      const bytes = Number(String(cells[4] || '').replace(/\D/g, '')) * 1024;
      const [h, m, s] = String(cells[7] || '').split(':').map(Number);
      resolve({ bytes: bytes > 0 ? bytes : null, cpuMs: [h, m, s].every(Number.isFinite) ? ((h * 60 + m) * 60 + s) * 1000 : null });
    });
  });
}

function processStats(pid) {
  return tasklistRow(pid, true).then(row => {
    if (!row?.bytes) return null;
    const now = Date.now();
    let cpu = null;
    if (row.cpuMs !== null && lastCpu?.pid === pid && now > lastCpu.at) cpu = Math.max(0, Math.min(100, ((row.cpuMs - lastCpu.ms) / (now - lastCpu.at) / os.cpus().length) * 100));
    if (row.cpuMs !== null) lastCpu = { pid, ms: row.cpuMs, at: now };
    return { memory: row.bytes, cpu };
  });
}

// Memory of one process (the world of a realm), without touching the CPU reading of the CoA world.
function processMemory(pid) {
  return tasklistRow(pid, false).then(row => row?.bytes || null);
}

// The home page figures with the extra realms that run (list from realms.status, with .memory): players, bots and
// memory of every world added up, the tick of the CoA world; CoA stopped, the figures of the realms alone.
function withRealms(stats, list) {
  const others = (list || []).filter(realm => realm.state === 'running');
  if (!others.length) return stats;
  const sum = field => others.reduce((total, realm) => total + (realm[field] || 0), 0);
  const memory = sum('memory') + (stats.running ? stats.memory || 0 : 0);
  if (stats.running) {
    // Players, bots and memory of every world added up; the tick stays the CoA one (each world has its own).
    stats.realms = { count: others.length + 1, players: sum('players') + (stats.players || 0), bots: sum('online') + (stats.bots?.count || 0) };
    stats.memory = memory || stats.memory;
    return stats;
  }
  // CoA stopped, realms running: the figures are theirs, the tick that of the first one running.
  const main = others[0];
  return {
    running: true, realmOnly: main.key, consoleBusy: false, at: Date.now(),
    players: sum('players'), characters: sum('characters'), tick: main.tick, tickMean: main.tickMean, uptime: main.uptime,
    memory: memory || null, cpu: null,
    bots: { count: sum('online'), inCombat: null, target: sum('bots') || null },
    realms: others.length > 1 ? { count: others.length, players: sum('players'), bots: sum('online') } : null,
  };
}

function botsTarget(root) {
  try {
    const conf = fs.readFileSync(path.join(root, 'CoA-Bots', 'Core', 'configs', 'modules', 'playerbots.conf'), 'utf8');
    return Number(/^\s*AiPlayerbot\.MaxRandomBots\s*=\s*(\d+)/m.exec(conf)?.[1]) || null;
  } catch { return null; }
}

function botsInGame(root) {
  const status = readJson(path.join(root, 'Core', 'Logs', 'bot-status.json'));
  if (!status || !Array.isArray(status.bots)) return null;
  // The world writes it every 5 s: older than a minute, it is the one of a world that stopped (not shown).
  const fresh = !status.at || Date.now() / 1000 - Number(status.at) < 60;
  return fresh ? { count: status.bots.length, inCombat: status.bots.filter(bot => bot.combat).length, target: botsTarget(root) } : null;
}

async function stats(root) {
  const pid = worldPid(root);
  if (!pid) return { running: false };
  try { process.kill(pid, 0); } catch { return { running: false }; }
  // A world still busy with the previous question is not asked again (its answer is awaited, see raCommand).
  const asking = raOpen(root) ? Promise.resolve(null) : raCommand(root, 'server info', 8000).then(parseInfo).catch(() => null);
  const [info, proc] = await Promise.all([asking, processStats(pid)]);
  // The world runs but its console does not answer: busy (bots created at a first start) or stuck (a shutdown
  // that never ends). How long it has been so tells them apart for the page.
  if (info) busySince.delete(root); else if (!busySince.has(root)) busySince.set(root, Date.now());
  return { running: true, consoleBusy: !info, busyFor: info ? 0 : Date.now() - busySince.get(root), ...(info || {}), memory: proc?.memory ?? null, cpu: proc?.cpu ?? null, bots: botsInGame(root), at: Date.now() };
}

const busySince = new Map();

// Last resort when the world no longer answers: its own process (and only it) is ended. MySQL keeps the data;
// what players did since the last save is lost.
function forceStopWorld(root) {
  const pid = worldPid(root);
  if (!pid) throw new Error('The worldserver of this server is not running.');
  return new Promise((resolve, reject) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 20000 }, error => {
    if (error) reject(new Error(`The worldserver could not be stopped: ${error.message}`)); else { busySince.delete(root); resolve(true); }
  }));
}

module.exports = { raBusy, raCommand, parseInfo, stats, forceStopWorld, processMemory, withRealms };
