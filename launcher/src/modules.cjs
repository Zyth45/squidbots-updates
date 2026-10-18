'use strict';
// Server modules the player can switch: SquidBots (start with or without the bots) and Multirace (the added
// playable races). A switch only writes the two keys of the module's .conf (a .bak is kept) and says what must
// follow (purge of the random bots); the server must be stopped. The game client is only looked at, except on an
// explicit click that renames its race patch files to .disabled (and back).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const RACES_CONF = 'CoA-Bots/Core/configs/modules/coa_custom_races.conf';
const RACES_DBC = 'Data/dbc_races';
const RACES_DBC_COUNT = 23;
const CORE_MARK = 'CoACustomRaces.Enable';
// The race patch files of the client, by exact name. patch-T.MPQ and patch-Z.MPQ are NOT in the list: the
// official CoA client has its own files under those names, renaming them would break the game. dinput8.dll is
// left alone too (other tools use the same hook).
const RACE_MPQS = ['ZE1', 'ZE2', 'ZE3', 'ZE5', 'ZE6', 'ZE7', 'ZE8', 'ZE9', 'ZEA', 'ZG', 'ZH', 'ZHA', 'ZHM', 'ZM', 'ZVU', 'ZES', 'ZJ', 'ZZE', 'ZZR', 'ZZS', 'ZZT', 'ZZU', 'ZZV', 'ZZW'].map(id => `Data/patch-${id}.MPQ`);
const CLIENT_FILES = [...RACE_MPQS, 'EsteriaAppearance.dll'];
const DEFAULT_CONF = '[worldserver]\n\n# Added playable races (DBC data, character creation, appearances). 0 = off, 1 = on.\nCoACustomRaces.Enable = 0\n\n# Random bots may also be of the added races. 0 = off, 1 = on.\nCoACustomRaces.BotsEnable = 0\n';

const confValue = (text, key) => new RegExp(`^\\s*${key.replace(/\./g, '\\.')}\\s*=\\s*"?([^"\\r\\n#]*)"?`, 'm').exec(text || '')?.[1]?.trim();

// Does this worldserver know the switch? Its own config keys are plain text inside the executable.
const coreCache = new Map();
async function coreSupports(exe, mark = CORE_MARK) {
  const stat = await fsp.stat(exe).catch(() => null);
  if (!stat) return false;
  const key = `${exe}|${stat.size}|${stat.mtimeMs}|${mark}`;
  if (coreCache.has(key)) return coreCache.get(key);
  const needle = Buffer.from(mark, 'latin1');
  let found = false;
  let tail = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(exe, { highWaterMark: 4 << 20 })) {
    const block = Buffer.concat([tail, chunk]);
    if (block.includes(needle)) { found = true; break; }
    tail = block.subarray(Math.max(0, block.length - needle.length));
  }
  coreCache.set(key, found);
  return found;
}

function clientPatch(client) {
  if (!client || !fs.existsSync(client)) return { state: 'unknown', active: [], disabled: [] };
  const active = CLIENT_FILES.filter(rel => fs.existsSync(path.join(client, rel)));
  const disabled = CLIENT_FILES.filter(rel => !fs.existsSync(path.join(client, rel)) && fs.existsSync(path.join(client, `${rel}.disabled`)));
  const mpqs = active.filter(rel => rel.endsWith('.MPQ')).length;
  const state = mpqs === 0 ? (disabled.length ? 'disabled' : 'no') : mpqs === RACE_MPQS.length && active.includes('EsteriaAppearance.dll') ? 'yes' : 'partial';
  return { state, active, disabled };
}

async function status(root, { squidbots = true, client = '' } = {}) {
  const conf = await fsp.readFile(path.join(root, RACES_CONF), 'utf8').catch(() => null);
  const dist = fs.existsSync(path.join(root, `${RACES_CONF}.dist`));
  const dbc = (await fsp.readdir(path.join(root, RACES_DBC)).catch(() => [])).filter(name => /\.dbc$/i.test(name)).length;
  return {
    squidbots: { installed: fs.existsSync(path.join(root, 'CoA-Bots', 'coa_bots.py')), enabled: squidbots !== false },
    ahbot: await ahbotStatus(root),
    manastorm: await manastormStatus(root),
    rotation: await rotationStatus(root),
    multirace: {
      enabled: confValue(conf, 'CoACustomRaces.Enable') === '1',
      bots: confValue(conf, 'CoACustomRaces.BotsEnable') === '1',
      conf: conf !== null, dist, dbc, dbcNeeded: RACES_DBC_COUNT,
      core: await coreSupports(path.join(root, 'CoA-Bots', 'Core', 'worldserver.exe')),
      client: clientPatch(client),
    },
  };
}

// What stops the switch to ON (nothing is written then).
async function multiraceBlockers(root) {
  const s = (await status(root)).multirace;
  const out = [];
  if (!s.core) out.push('core');
  if (s.dbc < RACES_DBC_COUNT) out.push('dbc');
  return out;
}

async function setKey(text, key, value) {
  const pattern = new RegExp(`^(\\s*${key.replace(/\./g, '\\.')}\\s*=\\s*).*$`, 'm');
  return pattern.test(text) ? text.replace(pattern, `$1${value}`) : `${text.replace(/\s*$/, '')}\n${key} = ${value}\n`;
}

// Writes Enable / BotsEnable. The caller purges the random bots afterwards (both ways).
async function setMultirace(root, on, { bots = true } = {}) {
  if (on) {
    const blockers = await multiraceBlockers(root);
    if (blockers.length) throw Object.assign(new Error(`Multirace cannot be switched on: ${blockers.join(', ')}.`), { blockers });
  }
  const file = path.join(root, RACES_CONF);
  let text = await fsp.readFile(file, 'utf8').catch(() => null);
  if (text === null) {
    text = await fsp.readFile(`${file}.dist`, 'utf8').catch(() => DEFAULT_CONF);
  } else {
    await fsp.copyFile(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  }
  text = await setKey(text, 'CoACustomRaces.Enable', on ? '1' : '0');
  text = await setKey(text, 'CoACustomRaces.BotsEnable', on && bots ? '1' : '0');
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text);
  return (await status(root)).multirace;
}

// The client's race patch files renamed to .disabled (off) or back (on). Nothing else in the game is touched.
async function setClientPatch(client, on) {
  const current = clientPatch(client);
  const list = on ? current.disabled : current.active;
  for (const rel of list) {
    const active = path.join(client, rel);
    if (on) await fsp.rename(`${active}.disabled`, active);
    else await fsp.rename(active, `${active}.disabled`);
  }
  return clientPatch(client);
}

// A module switch kept in a .conf of the server's modules (with or without bots). Without a .conf the server reads
// the .dist, so its value is the one in force; the first switch creates the .conf from the .dist.
const MODULE_DIRS = ['CoA-Bots/Core/configs/modules', 'Core/configs/modules'];
async function moduleConf(root, name) {
  for (const dir of MODULE_DIRS) {
    const file = path.join(root, dir, name);
    const conf = await fsp.readFile(file, 'utf8').catch(() => null);
    if (conf !== null) return conf;
    const dist = await fsp.readFile(`${file}.dist`, 'utf8').catch(() => null);
    if (dist !== null) return dist;
  }
  return null;
}
async function setModuleKeys(root, name, keys, missing) {
  let written = 0;
  for (const dir of MODULE_DIRS) {
    const file = path.join(root, dir, name);
    let text = await fsp.readFile(file, 'utf8').catch(() => null);
    if (text === null) {
      text = await fsp.readFile(`${file}.dist`, 'utf8').catch(() => null);
      if (text === null) continue;
    } else await fsp.copyFile(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    for (const [key, value] of Object.entries(keys)) text = await setKey(text, key, value);
    await fsp.writeFile(file, text);
    written++;
  }
  if (!written) throw new Error(missing);
}
const isOn = value => /^(1|true)$/i.test(value || '');

// The auction house bot (from CoA Bots 2.5, on by default): one key, a restart, nothing to purge. Its own account
// (AHBOT) is not a random bot account, so purges never touch it.
const AHBOT = 'mod_ahbot.conf';
async function ahbotStatus(root) {
  const conf = await moduleConf(root, AHBOT);
  return { available: conf !== null, enabled: isOn(confValue(conf, 'AuctionHouseBot.Enable')) };
}
async function setAhbot(root, on) {
  await setModuleKeys(root, AHBOT, { 'AuctionHouseBot.Enable': on ? 'true' : 'false' }, 'The auction house bot comes with CoA Bots 2.5.');
  return ahbotStatus(root);
}

// Manastorm Endless (core of CoA, from CoA Bots 2.5): off by default. Its tables are always there (the server needs
// them to start); the switch only sets Enable, with ClientMode 2 (the native window of the patched client).
const MANASTORM = 'manastorm-endless.conf';
async function manastormStatus(root) {
  const conf = await moduleConf(root, MANASTORM);
  return { available: conf !== null, enabled: isOn(confValue(conf, 'Manastorm.Enable')) };
}
async function setManastorm(root, on) {
  await setModuleKeys(root, MANASTORM, { 'Manastorm.Enable': on ? '1' : '0', 'Manastorm.ClientMode': '2' }, 'Manastorm comes with CoA Bots 2.5.');
  return manastormStatus(root);
}

// The one-button rotation assistant (core of CoA): off in CoA Bots. The core turns it ON when its key is missing,
// so the key is always written (0 when absent, see keepRotationOff). manage.py writes Core\configs\modules\coa.conf
// from Settings\coa.conf.template at every start: the template is the setting, the copies follow it.
const ROTATION_KEY = 'CoA.RotationAssist.Enable';
const ROTATION_FILES = ['Settings/coa.conf.template', 'CoA-Bots/Core/configs/modules/coa.conf', 'Core/configs/modules/coa.conf'];
async function rotationStatus(root) {
  const template = await fsp.readFile(path.join(root, ROTATION_FILES[0]), 'utf8').catch(() => null);
  const known = await coreSupports(path.join(root, 'CoA-Bots', 'Core', 'worldserver.exe'), ROTATION_KEY);
  const value = confValue(template, ROTATION_KEY);
  return { available: template !== null && known, enabled: value === undefined ? known : isOn(value), missing: value === undefined };
}
async function writeRotation(root, value, onlyWhenMissing) {
  let written = 0;
  for (const rel of ROTATION_FILES) {
    const file = path.join(root, rel);
    const text = await fsp.readFile(file, 'utf8').catch(() => null);
    if (text === null || (onlyWhenMissing && confValue(text, ROTATION_KEY) !== undefined)) continue;
    await fsp.writeFile(file, await setKey(text, ROTATION_KEY, value));
    written++;
  }
  return written;
}
async function setRotation(root, on) {
  if (!(await rotationStatus(root)).available) throw new Error('The rotation assistant comes with CoA Bots 2.5.');
  await writeRotation(root, on ? '1' : '0', false);
  return rotationStatus(root);
}
// Before every start: a missing key is written as 0 (never changes a value the player chose).
async function keepRotationOff(root) {
  if (!(await coreSupports(path.join(root, 'CoA-Bots', 'Core', 'worldserver.exe'), ROTATION_KEY).catch(() => false))) return 0;
  return writeRotation(root, '0', true).catch(() => 0);
}

// The repack's own switch (CoA-Bots\coa_multirace.py, from CoA Bots 2.4): it also moves the players' characters of
// an added race to a base race of their side (kept aside, given back at ON) and purges the random bots.
// Run first without --apply (what it would do), then with --apply, server stopped.
const SCRIPT = 'CoA-Bots/coa_multirace.py';
const hasScript = root => fs.existsSync(path.join(root, SCRIPT));

function runScript(root, command, apply) {
  const { execFile } = require('node:child_process');
  const python = path.join(root, 'Runtime', 'python', 'python.exe');
  const args = ['-B', '-X', 'utf8', path.join(root, SCRIPT), command, '--json', '--repack', root, ...(apply ? ['--apply'] : [])];
  return new Promise((resolve, reject) => execFile(python, args, { cwd: path.join(root, 'CoA-Bots'), windowsHide: true, timeout: 30 * 60 * 1000, maxBuffer: 16 << 20, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (error, stdout, stderr) => {
    const last = String(stdout || '').trim().split(/\r?\n/).reverse().find(line => line.startsWith('{'));
    let data = null;
    try { data = last ? JSON.parse(last) : null; } catch {}
    if (data && !data.error && !error) return resolve(data);
    reject(Object.assign(new Error(data?.error?.text || String(stderr || error?.message || 'The multirace switch failed.').trim().split(/\r?\n/).slice(-3).join(' ')), { data }));
  }));
}

module.exports = { ahbotStatus, setAhbot, manastormStatus, setManastorm, rotationStatus, setRotation, keepRotationOff, hasScript, runScript, status, setMultirace, setClientPatch, clientPatch, coreSupports, multiraceBlockers, RACES_CONF, RACES_DBC_COUNT };
