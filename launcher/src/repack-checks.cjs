'use strict';
// The known problems of CoA repacks, as checks.
// Each one looks at files, settings, processes or the database, never changes anything, and names the
// safe fix when there is one. The fixes themselves are below, each limited to what the list calls safe.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const exec = promisify(execFile);
const read = file => fsp.readFile(file, 'utf8').catch(() => null);
const confValue = (text, key) => {
  const match = text?.match(new RegExp(`^\\s*${key.replace(/\./g, '\\.')}\\s*=\\s*"?([^"\\r\\n]*)"?\\s*$`, 'mi'));
  return match ? match[1].trim() : null;
};
// The last 2 MB of a log (logs can be gigabytes).
async function tailText(file, bytes = 2 * 1024 * 1024) {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) return null;
  const handle = await fsp.open(file, 'r');
  try {
    const size = Math.min(stat.size, bytes);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, stat.size - size);
    return buffer.toString('utf8');
  } finally { await handle.close(); }
}
const EXPECTED_DATA =new Set(['acore_auth', 'acore_characters', 'acore_world', 'acore_playerbots', 'mysql', 'performance_schema', 'sys']);
const OLD_LFG_UPDATE = 'CoA-Bots/Database/world/updates/rev_20260925_50_lfg_wing_final_bosses.sql';

// The worldserver process that runs, and when each of our exes started (Windows).
async function processes() {
  if (process.platform !== 'win32') return [];
  const script = "Get-CimInstance Win32_Process -Filter \"Name='worldserver.exe' OR Name='authserver.exe' OR Name='mysqld.exe'\" | ForEach-Object { '{0}|{1}|{2}' -f $_.Name, $_.ExecutablePath, ([Management.ManagementDateTimeConverter]::ToDateTime($_.CreationDate)).ToString('o') }";
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 15000 }).catch(() => ({ stdout: '' }));
  return stdout.split(/\r?\n/).filter(Boolean).map(line => { const [name, file, started] = line.split('|'); return { name, file: file || '', started: Date.parse(started) || 0 }; });
}

async function repackChecks({ root, add, mysqlQuery, services }) {
  const inside = file => path.resolve(file).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep);

  // ---- where the repack lives
  const lower = root.toLowerCase();
  if (/\\program files|\\windows\\/.test(lower + '\\')) add('setup', 'path.protected', 'warn', { path: root });
  else if (/[^\x20-\x7e]/.test(root)) add('setup', 'path.ascii', 'warn', { path: root });
  else add('setup', 'path.ok', 'ok', { path: root });
  // ---- what the server needs on disk
  const missingData = [];
  for (const folder of ['maps', 'vmaps', 'mmaps', 'dbc']) {
    const entries = await fsp.readdir(path.join(root, 'Data', folder)).catch(() => []);
    if (!entries.length) missingData.push(folder);
  }
  add('setup', 'data.maps', missingData.length ? 'bad' : 'ok', { missing: missingData.join(', ') });
  add('setup', 'runtime.python', fs.existsSync(path.join(root, 'Runtime/python/python.exe')) ? 'ok' : 'bad');

  // ---- settings (the templates are the source; the .conf files are written from them at every start)
  const worldTemplate = await read(path.join(root, 'Settings/worldserver.conf.template'));
  const manage = await read(path.join(root, 'Scripts/manage.py'));
  if (worldTemplate && fs.existsSync(path.join(root, 'Source/sql-tree'))) {
    const enable = confValue(worldTemplate, 'Updates.EnableDatabases');
    const source = confValue(worldTemplate, 'SourceDirectory');
    const ok = enable === '7' && source === '@SOURCE@';
    add('settings', 'conf.updates', ok ? 'ok' : 'bad', { value: enable ?? '?' }, !ok && manage?.includes('@SOURCE@') ? 'fix:updates' : '');
  }
  const confDist = [];
  for (const folder of ['Core/configs/modules', 'CoA-Bots/Core/configs/modules']) {
    const entries = await fsp.readdir(path.join(root, folder)).catch(() => []);
    for (const name of entries) if (name.endsWith('.conf.dist') && !entries.includes(name.slice(0, -5))) confDist.push(`${folder}/${name.slice(0, -5)}`);
  }
  add('settings', 'conf.dist', confDist.length ? 'bad' : 'ok', { files: confDist.slice(0, 6).join(', '), count: confDist.length }, confDist.length ? 'fix:conf-dist' : '');

  const botsConf = await read(path.join(root, 'CoA-Bots/Core/configs/modules/playerbots.conf'));
  if (botsConf) {
    const updates = confValue(botsConf, 'Playerbots.Updates.EnableDatabases');
    add('settings', 'bots.dbupdates', updates && updates !== '0' ? 'bad' : 'ok', { value: updates ?? '0' }, updates && updates !== '0' ? 'fix:bots-updates' : '');
    const placeholders = /<MYSQL_PORT>|<APP_PASSWORD>/.test(botsConf);
    add('settings', 'bots.conf', placeholders ? 'bad' : 'ok', {}, placeholders ? 'bots-install' : '');
    const whisper = confValue(botsConf, 'AiPlayerbot.BotsWhisperPublic');
    if (whisper === '1') add('settings', 'bots.whisper', 'warn', {}, 'fix:whisper');
    // Memory: about 1.8 MB per bot on top of ~3 GB for the world (5 000 bots ≈ 9 GB).
    const maxBots = Number(confValue(botsConf, 'AiPlayerbot.MaxRandomBots')) || 0;
    if (maxBots) {
      const needed = 3 * 1024 ** 3 + maxBots * 1.8 * 1024 ** 2;
      const total = os.totalmem();
      add('health', 'bots.ram', needed > total * 0.7 ? 'warn' : 'ok', { bots: maxBots, needed, total });
    }
  }
  // S13: with the bots, the worldserver reads CoA-Bots\Core\configs\modules\playerbots.conf, never the repack's.
  const repackBotsConf = await read(path.join(root, 'Core/configs/modules/playerbots.conf'));
  if (botsConf && repackBotsConf && repackBotsConf !== botsConf) add('settings', 'bots.which', 'warn', {});
  // S14: the installer keeps the old playerbots.conf, so the keys of a newer version stay at their defaults.
  const botsDist = await read(path.join(root, 'CoA-Bots/Core/configs/modules/playerbots.conf.dist'));
  if (botsConf && botsDist) {
    const keys = text => new Set([...text.matchAll(/^\s*([A-Za-z][\w.]*)\s*=/gm)].map(match => match[1]));
    const have = keys(botsConf);
    const missing = [...keys(botsDist)].filter(key => !have.has(key));
    add('settings', 'bots.missingkeys', missing.length ? 'warn' : 'ok', { count: missing.length, keys: missing.slice(0, 5).join(', ') }, missing.length ? 'fix:bots-keys' : '');
  }
  // S6: the Ascension filter lets only this PC in.
  const coaConf = await read(path.join(root, 'Core/configs/modules/coa.conf'));
  if (confValue(coaConf, 'CoA.AllowRemoteClients') === '0') add('settings', 'coa.remote', 'info', {});
  // S7: giant logs, and the verbosity that makes them.
  const big = [];
  for (const folder of ['Core/Logs', 'CoA-Bots/Core/Logs']) {
    for (const name of await fsp.readdir(path.join(root, folder)).catch(() => [])) {
      const stat = await fsp.stat(path.join(root, folder, name)).catch(() => null);
      // An old log set aside by the start (world-console.log.1) is named as such: it can simply be deleted.
      if (stat?.isFile() && stat.size > 500 * 1024 ** 2) big.push(`${name} (${Math.round(stat.size / 1024 ** 2)} MB${/\.\d+$/.test(name) ? ', old' : ''})`);
    }
  }
  const playerbotsLogger = confValue(worldTemplate, 'Logger.playerbots');
  add('health', 'logs.size', big.length ? 'warn' : 'ok', { files: big.join(', '), level: playerbotsLogger || '' });
  // S7 / entry 12: "Missing property" lines at the last start, the known harmless ones named as such.
  // Server.log keeps every start: only what follows the last one counts (an older core's lines are history).
  const sinceLastStart = text => { const at = text.lastIndexOf('AzerothCore rev.'); return at < 0 ? text : text.slice(at); };
  const logText = sinceLastStart((await tailText(path.join(root, 'Core/Logs/world-console.log'))) || '') + sinceLastStart((await tailText(path.join(root, 'Core/Logs/Server.log'))) || '');
  const missingProps = [...new Set([...logText.matchAll(/Missing property ([\w.]+)/g)].map(match => match[1]))];
  if (missingProps.length) {
    const harmless = missingProps.filter(key => /^(Spellbook\.Enable|DestinyWeaver\.|EtherealBazaar\.Enable|Dynamic\.XP\.)/.test(key));
    // A key the core reads again and again (every boss cast...) fills the log: warn, with the fix that writes
    // the defaults the server itself suggests.
    const repeats = Math.max(...missingProps.map(key => logText.split(`Missing property ${key} `).length - 1));
    // The fix applies when module .conf.dist files of the repack are not where the server reads them.
    const shipped = (await fsp.readdir(path.join(root, 'CoA-Bots/Core/configs/modules')).catch(() => [])).filter(name => name.endsWith('.conf.dist') && !name.startsWith('playerbots'));
    const copyable = shipped.filter(name => !fs.existsSync(path.join(root, 'Core/configs/modules', name.slice(0, -5))));
    add('settings', 'conf.missing', repeats > 500 ? 'warn' : 'info', { count: missingProps.length, keys: missingProps.slice(0, 5).join(', '), harmless: harmless.length, repeats, copyable: copyable.length }, copyable.length ? 'fix:missing-props' : '');
  }
  // A 1.6 extracted over a 1.5 leaves a world update the installer then trips over ("Replace ... oldValue").
  // Only a problem for a 1.6 (or later) package whose installer still has the faulty Replace('', ...);
  // for a 1.5 install the file is its own.
  if (fs.existsSync(path.join(root, OLD_LFG_UPDATE))) {
    const release = JSON.parse(((await read(path.join(root, 'CoA-Bots/release.json'))) || '{}').replace(/^﻿/, ''));
    const [major, minor] = String(release.version || '0.0').split(/[.-]/).map(Number);
    const installer = await read(path.join(root, 'CoA-Bots/Installer-Bots.ps1'));
    if ((major > 1 || (major === 1 && minor >= 6)) && installer?.includes("Replace(''")) add('bots', 'bots.leftover', 'bad', {}, 'fix:bots-leftover');
  }

  // ---- MySQL's own files
  const dataEntries = await fsp.readdir(path.join(root, 'mysql/data'), { withFileTypes: true }).catch(() => []);
  const strangers = dataEntries.filter(entry => entry.isDirectory() && !entry.name.startsWith('#') && !EXPECTED_DATA.has(entry.name.toLowerCase())).map(entry => entry.name);
  add('database', 'mysql.folders', strangers.length ? 'bad' : 'ok', { folders: strangers.slice(0, 5).join(', ') });
  let tablespace = false;
  for (const name of await fsp.readdir(path.join(root, 'mysql/logs')).catch(() => [])) {
    if (!/\.(err|log)$/i.test(name)) continue;
    const text = await read(path.join(root, 'mysql/logs', name));
    if (text?.includes('Multiple files found for the same tablespace ID')) tablespace = true;
  }
  if (tablespace) add('database', 'mysql.tablespace', 'bad');

  // ---- what runs
  const running = await processes();
  // S3: a MySQL of another folder running at the same time (same port, or the X plugin port 33060).
  const foreignMysql = running.find(item => item.name.toLowerCase() === 'mysqld.exe' && item.file && !inside(item.file));
  if (foreignMysql) add('services', 'mysql.foreign', 'warn', { file: foreignMysql.file });
  const world = running.find(item => item.name.toLowerCase() === 'worldserver.exe' && inside(item.file));
  if (world && fs.existsSync(path.join(root, 'CoA-Bots/Core/worldserver.exe'))) {
    const withBots = world.file.toLowerCase().includes('\\coa-bots\\core\\');
    add('services', 'world.bots', withBots ? 'ok' : 'info', {});
  }
  for (const item of running.filter(entry => inside(entry.file) && entry.name.toLowerCase() !== 'mysqld.exe')) {
    const stat = await fsp.stat(item.file).catch(() => null);
    // An exe replaced by an update while the old one still runs: the old program answers players.
    if (stat && item.started && stat.mtimeMs > item.started + 60000) add('services', 'process.old', 'bad', { name: item.name }, item.name.toLowerCase() === 'authserver.exe' ? 'fix:restart-auth' : 'restart');
  }
  const settings = JSON.parse((await read(path.join(root, 'Settings/repack.json'))) || '{}');
  const worldUp = services.find(service => service.id === 'world')?.state === 'running';
  if (worldUp && settings.raPort) {
    const ra = await require('./dashboard.cjs').portOpen(Number(settings.raPort));
    add('services', 'ra', ra ? 'ok' : 'warn', { port: settings.raPort });
  }

  // ---- the database itself, when MySQL runs
  if (mysqlQuery) {
    try {
      const [flag] = await mysqlQuery('SELECT flag FROM acore_auth.realmlist WHERE id = 1');
      const value = Number(flag);
      add('database', 'realm.flag', value === 2 || value === 3 ? 'bad' : 'ok', { flag: value }, value === 2 || value === 3 ? 'fix:realm-flag' : '');
      const [address] = await mysqlQuery('SELECT address FROM acore_auth.realmlist WHERE id = 1');
      add('database', 'realm.address', 'info', { address: address || '?' });
    } catch {}
    if (botsConf) {
      // Support case 01/10: acore_playerbots there but its playerbots_* tables missing; the world stops at
      // "Could not prepare statements of the Playerbots database".
      try {
        const [tables] = await mysqlQuery("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'acore_playerbots' AND table_name LIKE 'playerbots%'");
        add('database', 'bots.tables', Number(tables) > 0 ? 'ok' : 'bad', { count: Number(tables) }, Number(tables) > 0 ? '' : 'bots-install');
      } catch {}
      try {
        const [accounts] = await mysqlQuery("SELECT COUNT(*) FROM acore_auth.account WHERE username LIKE 'RNDBOT%'");
        const expected = Number(confValue(botsConf, 'AiPlayerbot.RandomBotAccountCount')) || 0;
        if (expected && Number(accounts) > 0) add('bots', 'bots.accounts', Number(accounts) === expected ? 'ok' : 'warn', { accounts: Number(accounts), expected });
        const maxLevel = Number(confValue(botsConf, 'AiPlayerbot.RandomBotMaxLevel')) || 80;
        if (maxLevel <= 60) {
          const [outland] = await mysqlQuery("SELECT COUNT(*) FROM acore_characters.characters c JOIN acore_auth.account a ON a.id = c.account WHERE a.username LIKE 'RNDBOT%' AND c.map = 530 AND c.level <= 60 AND c.zone NOT IN (3430, 3433, 3487, 3524, 3525, 3557)");
          add('bots', 'bots.outland', Number(outland) > 0 ? 'warn' : 'ok', { count: Number(outland) });
        }
      } catch {}
    }
  }
}

// ---------------------------------------------------------------- safe fixes
// Changes one value in place in a text file, keeping a copy of the file first.
async function setConf(file, key, value) {
  const text = await fsp.readFile(file, 'utf8');
  const pattern = new RegExp(`^(\\s*${key.replace(/\./g, '\\.')}\\s*=\\s*).*$`, 'm');
  if (!pattern.test(text)) throw new Error(`${key} is not in ${path.basename(file)}.`);
  await fsp.copyFile(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.writeFile(file, text.replace(pattern, `$1${value}`));
}

const FIXES = {
  // 7: the database updates of the core are applied by the worldserver itself.
  updates: async ({ root }) => {
    const file = path.join(root, 'Settings/worldserver.conf.template');
    await setConf(file, 'Updates.EnableDatabases', '7');
    await setConf(file, 'SourceDirectory', '"@SOURCE@"');
  },
  // 11: a module without its .conf: the .conf.dist is copied (nothing overwritten).
  'conf-dist': async ({ root }) => {
    for (const folder of ['Core/configs/modules', 'CoA-Bots/Core/configs/modules']) {
      const entries = await fsp.readdir(path.join(root, folder)).catch(() => []);
      for (const name of entries) {
        if (!name.endsWith('.conf.dist') || entries.includes(name.slice(0, -5))) continue;
        await fsp.copyFile(path.join(root, folder, name), path.join(root, folder, name.slice(0, -5)), fs.constants.COPYFILE_EXCL);
      }
    }
  },
  // 8: the bots database is updated by the installer, never by the worldserver.
  'bots-updates': ({ root }) => setConf(path.join(root, 'CoA-Bots/Core/configs/modules/playerbots.conf'), 'Playerbots.Updates.EnableDatabases', '0'),
  // 10: bots no longer whisper every quest step.
  whisper: ({ root }) => setConf(path.join(root, 'CoA-Bots/Core/configs/modules/playerbots.conf'), 'AiPlayerbot.BotsWhisperPublic', '0'),
  // S14: the keys a newer bots version added, with their .dist defaults, appended to playerbots.conf.
  'bots-keys': async ({ root }) => {
    const file = path.join(root, 'CoA-Bots/Core/configs/modules/playerbots.conf');
    const conf = await fsp.readFile(file, 'utf8');
    const dist = await fsp.readFile(`${file}.dist`, 'utf8');
    const have = new Set([...conf.matchAll(/^\s*([A-Za-z][\w.]*)\s*=/gm)].map(match => match[1]));
    const lines = [...dist.matchAll(/^\s*([A-Za-z][\w.]*)\s*=.*$/gm)].filter(match => !have.has(match[1])).map(match => match[0].trim());
    if (!lines.length) return;
    await fsp.copyFile(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    const eol = conf.includes('\r\n') ? '\r\n' : '\n';
    await fsp.writeFile(file, `${conf.replace(/\s*$/, '')}${eol}${eol}# Added by the launcher: keys of the newer version, with their default values.${eol}${lines.join(eol)}${eol}`);
  },
  // S7: the module settings the server looks for in Core\configs\modules ("Failed open file
  // configs/modules/X.conf"): the .conf.dist shipped in CoA-Bots\Core\configs\modules is copied there and its
  // .conf made from it. Nothing is overwritten; playerbots.conf stays where the bots read it.
  'missing-props': async ({ root }) => {
    const from = path.join(root, 'CoA-Bots/Core/configs/modules');
    const to = path.join(root, 'Core/configs/modules');
    await fsp.mkdir(to, { recursive: true });
    for (const name of await fsp.readdir(from).catch(() => [])) {
      if (!name.endsWith('.conf.dist') || name.startsWith('playerbots')) continue;
      const conf = name.slice(0, -5);
      if (!fs.existsSync(path.join(to, name))) await fsp.copyFile(path.join(from, name), path.join(to, name), fs.constants.COPYFILE_EXCL);
      if (!fs.existsSync(path.join(to, conf))) await fsp.copyFile(path.join(to, name), path.join(to, conf), fs.constants.COPYFILE_EXCL);
    }
  },
  // 25: the 1.5 world update left behind (already applied by the core).
  'bots-leftover': async ({ root }) => fsp.rm(path.join(root, 'CoA-Bots/Database/world/updates'), { recursive: true, force: true }),
  // 15: the realm shows offline.
  'realm-flag': ({ mysqlQuery }) => mysqlQuery('UPDATE acore_auth.realmlist SET flag = 0 WHERE id = 1 AND flag IN (2, 3)'),
  // 19: the old authserver still runs after an update: stop it and start the new one.
  'restart-auth': async ({ control }) => { await control.stop('auth'); await control.start('auth'); },
};

module.exports = { repackChecks, FIXES, confValue };
