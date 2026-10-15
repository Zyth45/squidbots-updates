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
function raCommand(root, command, timeout = 15000) {
  const { port, user, password } = raSettings(root);
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let data = '';
    let step = 0;
    const done = (error, value) => { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => done(new Error('The world console did not answer in time.')), timeout);
    socket.on('error', () => done(new Error('The world console is not reachable: start the worldserver first.')));
    socket.on('data', chunk => {
      data += chunk.toString('utf8');
      if (data.length > 262144) return done(new Error('The world console answer is too long.'));
      if (step === 0 && data.includes('Username:')) { step = 1; data = ''; socket.write(`${user}\r\n`); }
      else if (step === 1 && data.includes('Password:')) { step = 2; data = ''; socket.write(`${password}\r\n`); }
      else if (step === 2 && /AC>\s*$/.test(data)) { step = 3; data = ''; socket.write(`${command}\r\n`); if (/^\.?server (shutdown|restart)/i.test(command)) done(null, 'Requested.'); }
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

function botsInGame(root) {
  const status = readJson(path.join(root, 'Core', 'Logs', 'bot-status.json'));
  if (!status || !Array.isArray(status.bots)) return null;
  const fresh = !status.at || Date.now() / 1000 - Number(status.at) < 300;
  return fresh ? { count: status.bots.length, inCombat: status.bots.filter(bot => bot.combat).length } : null;
}

async function stats(root) {
  const pid = worldPid(root);
  if (!pid) return { running: false };
  try { process.kill(pid, 0); } catch { return { running: false }; }
  const [info, proc] = await Promise.all([raCommand(root, 'server info', 8000).then(parseInfo).catch(() => null), processStats(pid)]);
  return { running: true, ...(info || {}), memory: proc?.memory ?? null, cpu: proc?.cpu ?? null, bots: botsInGame(root), at: Date.now() };
}

module.exports = { raCommand, parseInfo, stats };
