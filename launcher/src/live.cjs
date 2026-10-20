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
function processStats(pid) {
  return new Promise(resolve => {
    const script = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { '{0}|{1}' -f [int64]$p.TotalProcessorTime.TotalMilliseconds, $p.WorkingSet64 }`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000 }, (error, out) => {
      const [cpuMs, bytes] = String(out || '').trim().split('|').map(Number);
      if (error || !Number.isFinite(bytes)) return resolve(null);
      const now = Date.now();
      let cpu = null;
      if (lastCpu?.pid === pid && now > lastCpu.at) cpu = Math.max(0, Math.min(100, ((cpuMs - lastCpu.ms) / (now - lastCpu.at) / os.cpus().length) * 100));
      lastCpu = { pid, ms: cpuMs, at: now };
      resolve({ memory: bytes, cpu });
    });
  });
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
  const fresh = !status.at || Date.now() / 1000 - Number(status.at) < 300;
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

module.exports = { raCommand, parseInfo, stats, forceStopWorld };
