'use strict';
// Extra realms of a local server: Wildcard (Darkmoon) and Warcraft Reborn (Bronzebeard) beside the CoA realm (id 1).
// A realm is a folder Royaumes/<key> with its own configs\ (on Windows the worldserver reads the configs of its
// modules in configs\ of its working folder), the same bot-enabled worldserver, its own databases
// acore_characters_<key> and acore_playerbots_<key>, and one line of acore_auth.realmlist. The CoA realm keeps
// running through the repack's own scripts; MySQL and the authserver are shared.
//
// The settings of a realm are built again before every start, in three layers (each one wins over the previous):
//   1. the CoA bot server's settings of the moment (CoA-Bots\Core\configs), never changed by a realm;
//   2. the realm's own values, only the keys the player changed for it (Royaumes\<key>\settings.json);
//   3. what the mode and the realm impose (classes of the mode, ports, databases, bot account prefix).
// A realm never writes a file or a database of the CoA realm.
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { portOpen } = require('./server-control.cjs');
const { validate } = require('./server-config.cjs');
const CATALOG = require('./data/server-settings.json');
const live = require('./live.cjs');

// Keys by settings file (the file names of the Server settings page).
const MODES = {
  wildcard: {
    id: 2, name: 'Darkmoon (Wildcard)', prefix: 'rndwc', step: 1,
    keys: {
      'mod-coa-challenges.conf': { 'CoAChallenges.GameModes.Realm': 'WildCard' },
      'coa.conf': { 'CoA.GameModeMask': '64', 'CoA.ClassModel': '"hero"', 'CoA.RealmType': '"live seasonal"', 'CoA.MapClass10ToWarrior': '0', 'CoA.ClientBooleanConfigs': '"CONFIG_LEGACY_CHARACTER_ADVANCEMENT_ENABLED=0"' },
      // Only the Hero class (10) can be created.
      'worldserver.conf': { 'PlayerStart.CustomSpells': '1', 'AlwaysMaxSkillForLevel': '1', 'CharacterCreating.Disabled.ClassMask': '4294966783' },
    },
  },
  reborn: {
    id: 3, name: 'Bronzebeard (Reborn)', prefix: 'rndwr', step: 2,
    keys: {
      'coa.conf': { 'CoA.ClassModel': '"wcr"' },
      'playerbots.conf': { 'AiPlayerbot.CoaClassesOnly': '0' },
      // The ten classes of the original game only: 0xFFFFFA00 closes class 10 (bit 9) and classes 12 and up.
      'worldserver.conf': { 'CharacterCreating.Disabled.ClassMask': '4294965760' },
    },
  },
};
// Tables the new characters database needs filled (the world fails or misbehaves without them).
const SEED_TABLES = ['updates', 'updates_include', 'worldstates', 'active_arena_season', 'playerbots_names', 'playerbots_guild_names',
  'playerbots_arena_team_names', 'coa_build_creator', 'coa_build_creator_enchant', 'coa_build_creator_item_type', 'coa_build_creator_spell',
  'instance_reset', 'pool_quest_save'];
const DEFAULT_BOTS = 150;
const KEY = /^[a-z]{3,12}$/;
const CONF_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const FILE_ID = /^[A-Za-z0-9_.-]{1,60}\.conf$/;
const BOT_COUNT = ['AiPlayerbot.MinRandomBots', 'AiPlayerbot.MaxRandomBots'];

const dirOf = (root, key) => path.join(root, 'Royaumes', key);
const BOTS_CONFIGS = root => path.join(root, 'CoA-Bots', 'Core', 'configs');
const worldExe = root => path.join(root, 'CoA-Bots', 'Core', 'worldserver.exe');
// Where a settings file of the page is, inside configs\ of a realm.
const relOf = fileId => (/^(worldserver|authserver)\.conf$/.test(fileId) ? fileId : `modules/${fileId}`);

function mode(key) {
  if (!KEY.test(String(key)) || !MODES[key]) throw new Error('Unknown realm.');
  return MODES[key];
}

const confValue = (text, key) => new RegExp(`^\\s*${key.replace(/\./g, '\\.')}\\s*=\\s*"?([^"\\r\\n#]*)"?`, 'm').exec(text || '')?.[1]?.trim();

// Sets every line of the key, or adds it at the end.
function setKey(text, key, value) {
  const pattern = new RegExp(`^\\s*${key.replace(/\./g, '\\.')}\\s*=.*$`, 'gm');
  return pattern.test(text) ? text.replace(pattern, `${key} = ${value}`) : `${text.replace(/\s*$/, '')}\n${key} = ${value}\n`;
}

async function readJson(file) { try { return JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^﻿/, '')); } catch { return null; } }
async function repackSettings(root) { return (await readJson(path.join(root, 'Settings', 'repack.json'))) || {}; }

// ---------------------------------------------------------------- MySQL of the repack
function mysqlArgs(root) { return [`--defaults-file=${path.join(root, 'mysql', 'admin-client.ini')}`]; }
function sql(root, query) {
  return new Promise((resolve, reject) => execFile(path.join(root, 'mysql', 'bin', 'mysql.exe'), [...mysqlArgs(root), '-N', '-B', '-e', query],
    { windowsHide: true, timeout: 120000, maxBuffer: 16 << 20 }, (error, stdout, stderr) => error ? reject(new Error(String(stderr || error.message).trim().split(/\r?\n/).pop())) : resolve(String(stdout).trim())));
}
// mysqldump of a database (or some of its tables) poured straight into another database.
function copyDump(root, args, target) {
  return new Promise((resolve, reject) => {
    const dump = spawn(path.join(root, 'mysql', 'bin', 'mysqldump.exe'), [...mysqlArgs(root), ...args], { windowsHide: true });
    const load = spawn(path.join(root, 'mysql', 'bin', 'mysql.exe'), [...mysqlArgs(root), target], { windowsHide: true });
    let errors = '';
    dump.stderr.on('data', chunk => { errors += chunk; });
    load.stderr.on('data', chunk => { errors += chunk; });
    dump.stdout.pipe(load.stdin);
    let left = 2;
    const codes = [];
    const end = code => { codes.push(code); if (--left === 0) codes.some(Boolean) ? reject(new Error(`Copy into ${target} failed: ${errors.trim().split(/\r?\n/).pop() || codes.join(',')}`)) : resolve(); };
    dump.once('exit', end);
    load.once('exit', end);
    dump.once('error', reject);
    load.once('error', reject);
  });
}
const hasDatabase = async (root, name) => (await sql(root, `SHOW DATABASES LIKE '${name}'`)) === name;

// ---------------------------------------------------------------- realm files
async function realmFile(root, key) { return readJson(path.join(dirOf(root, key), 'realm.json')); }
async function ownSettings(root, key) {
  const own = (await readJson(path.join(dirOf(root, key), 'settings.json'))) || {};
  // Realms made by the first beta kept their number of bots in realm.json.
  const saved = await realmFile(root, key);
  if (saved?.bots !== undefined && !own['playerbots.conf']?.[BOT_COUNT[1]]) own['playerbots.conf'] = { ...own['playerbots.conf'], [BOT_COUNT[0]]: String(saved.bots), [BOT_COUNT[1]]: String(saved.bots) };
  return own;
}
async function writeOwn(root, key, own) {
  for (const file of Object.keys(own)) if (!Object.keys(own[file]).length) delete own[file];
  await fsp.writeFile(path.join(dirOf(root, key), 'settings.json'), JSON.stringify(own, null, 2));
  const saved = await realmFile(root, key);
  if (saved && saved.bots !== undefined) { delete saved.bots; await fsp.writeFile(path.join(dirOf(root, key), 'realm.json'), JSON.stringify(saved, null, 2)); }
}

// World and RA ports of a realm: kept from its creation; new ones are those of the CoA realm + 100 per step
// (side-by-side servers of the launcher take +1, +2…, so they never meet).
async function ports(root, key) {
  const saved = await realmFile(root, key);
  if (saved?.worldPort && saved?.raPort) return { worldPort: saved.worldPort, raPort: saved.raPort };
  const s = await repackSettings(root);
  const step = mode(key).step * 100;
  return { worldPort: (Number(s.worldPort) || 8085) + step, raPort: (Number(s.raPort) || 3443) + step };
}

function pidAlive(pid) { try { process.kill(Number(pid), 0); return true; } catch { return false; } }

async function processOf(root, key) {
  const state = await readJson(path.join(dirOf(root, key), '.state.json'));
  return state?.pid && pidAlive(state.pid) ? Number(state.pid) : 0;
}

// What the realm imposes (layer 3), by settings file: the keys of its mode and those that make it a realm of its own.
function imposed(key, saved) {
  const m = mode(key);
  const out = {};
  for (const [file, keys] of Object.entries(m.keys)) out[file] = { ...keys };
  // Its own world and console ports; SOAP and the bots' command server (8888) off: a realm never takes a port of CoA.
  out['worldserver.conf'] = { ...out['worldserver.conf'], RealmID: String(saved?.id ?? m.id), WorldServerPort: String(saved?.worldPort ?? ''), 'Ra.Port': String(saved?.raPort ?? ''), 'SOAP.Enabled': '0' };
  // What a mode does not have (checked in the core 2.6): the rotation assistant only knows the CoA specializations;
  // Manastorm has rules for Wildcard but nothing for Reborn; the added races are not made for these class models.
  // The auction house bot works everywhere: it makes its seller in each realm's characters database (AHBOT account).
  out['coa.conf'] = { ...out['coa.conf'], 'CoA.RotationAssist.Enable': '0' };
  if (key === 'reborn') {
    out['coa.conf']['Ascension.Manastorm.Enable'] = '0';
    out['manastorm-endless.conf'] = { 'Manastorm.Enable': '0' };
  }
  out['coa_custom_races.conf'] = { 'CoACustomRaces.Enable': '0', 'CoACustomRaces.BotsEnable': '0' };
  // CoA tells its random bots from alts by this prefix: it must be the realm's bot prefix (else its bots count as alts).
  out['coa.conf'] = { ...out['coa.conf'], 'CoA.RandomBotAccountPrefix': `"${m.prefix}"` };
  out['playerbots.conf'] = { ...out['playerbots.conf'], 'AiPlayerbot.RandomBotAccountPrefix': `"${m.prefix}"`, 'AiPlayerbot.CoaStatusFile': '"Logs/bot-status.json"', 'AiPlayerbot.CommandServerPort': '0' };
  return out;
}

// The repack's update tool refuses a mysql\data with databases it does not know (code 15): a realm is only offered when
// the installed CoA Bots tools list the realm databases, so a realm can never block an update of CoA.
function updaterKnows(root, key) {
  try { return fs.readFileSync(path.join(root, 'CoA-Bots', 'coa_common.py'), 'utf8').includes(`acore_characters_${key}`); } catch { return false; }
}

// The realms come with CoA Bots 2.6: before it the launcher shows nothing of them (the tab is hidden), so nobody gets
// the realm options on a server we have not validated for them.
const REALMS_FROM = [2, 6];
function botsVersion(root) {
  try { return String(JSON.parse(fs.readFileSync(path.join(root, 'CoA-Bots', 'release.json'), 'utf8').replace(/^﻿/, '')).version || ''); } catch { return ''; }
}
function versionReady(version) {
  const [major, minor] = (/^(\d+)\.(\d+)/.exec(String(version)) || []).slice(1).map(Number);
  return Number.isFinite(major) && (major > REALMS_FROM[0] || (major === REALMS_FROM[0] && minor >= REALMS_FROM[1]));
}

async function status(root, { live: withLive = true } = {}) {
  const version = botsVersion(root);
  const supported = fs.existsSync(worldExe(root)) && versionReady(version);
  const list = [];
  for (const [key, m] of Object.entries(MODES)) {
    const saved = await realmFile(root, key);
    const created = !!saved && fs.existsSync(path.join(dirOf(root, key), 'configs', 'worldserver.conf'));
    if (!created) { list.push({ key, id: m.id, name: m.name, state: 'absent', autostart: false, ready: updaterKnows(root, key) }); continue; }
    const p = await ports(root, key);
    const open = await portOpen(p.worldPort);
    const pid = await processOf(root, key);
    const own = await ownSettings(root, key);
    const changed = Object.values(own).reduce((sum, keys) => sum + Object.keys(keys).length, 0);
    let bots = Number(own['playerbots.conf']?.[BOT_COUNT[1]]);
    if (!Number.isFinite(bots)) bots = Number(confValue(await fsp.readFile(path.join(BOTS_CONFIGS(root), 'modules', 'playerbots.conf'), 'utf8').catch(() => ''), BOT_COUNT[1])) || null;
    let info = null;
    if (open && withLive) info = await live.raCommand(root, 'server info', 6000, p.raPort).then(live.parseInfo).catch(() => null);
    list.push({ key, id: saved.id, name: saved.name || m.name, state: open ? 'running' : pid ? 'starting' : saved.disabled ? 'disabled' : 'stopped', worldPort: p.worldPort, raPort: p.raPort, bots, changed, autostart: saved.autostart === true, players: info?.players ?? null, characters: info?.characters ?? null, uptime: info?.uptime || '' });
  }
  // Realms made before (a beta) stay reachable even on an older CoA Bots, to stop or remove them.
  return { supported, available: supported || list.some(realm => realm.state !== 'absent'), version, realms: list };
}

// ---------------------------------------------------------------- configs
// The bot server's configs written again from the repack's templates and Settings/repack.json (what CoA Bots does
// at each start of the CoA realm), so a realm never copies ports or paths older than the server's.
const REFRESH = "import importlib.util, sys\ns = importlib.util.spec_from_file_location('coa_bots', sys.argv[1])\nm = importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\nm.bots_configuration(m.manage.settings(0))\n";
function refreshBotConfigs(root) {
  const python = path.join(root, 'Runtime', 'python', 'python.exe');
  const script = path.join(root, 'CoA-Bots', 'coa_bots.py');
  if (!fs.existsSync(python) || !fs.existsSync(script)) return Promise.resolve(false);
  return new Promise(resolve => execFile(python, ['-B', '-X', 'utf8', '-c', REFRESH, script], { cwd: path.join(root, 'CoA-Bots'), windowsHide: true, timeout: 120000 }, error => resolve(!error)));
}

// configs\ of the realm = layer 1 (copy), then 2 (its own values), then 3 (imposed), written before every start.
async function writeConfigs(root, key, saved) {
  const dir = dirOf(root, key);
  const target = path.join(dir, 'configs');
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.cp(BOTS_CONFIGS(root), target, { recursive: true });
  const edits = new Map();
  const add = (fileId, keys) => edits.set(fileId, { ...edits.get(fileId), ...keys });
  for (const [fileId, keys] of Object.entries(await ownSettings(root, key))) add(fileId, keys);
  for (const [fileId, keys] of Object.entries(imposed(key, saved))) add(fileId, keys);
  const ws = await fsp.readFile(path.join(target, 'worldserver.conf'), 'utf8');
  const chars = confValue(ws, 'CharacterDatabaseInfo') || '';
  if (chars.split(';').length < 5) throw new Error('CharacterDatabaseInfo cannot be read in worldserver.conf.');
  const prefix = chars.split(';').slice(0, 4).join(';');
  add('worldserver.conf', { CharacterDatabaseInfo: `"${prefix};acore_characters_${key}"`, LogsDir: `"${path.join(dir, 'Logs').replace(/\\/g, '/')}"` });
  add('playerbots.conf', { PlayerbotsDatabaseInfo: `"${prefix};acore_playerbots_${key}"` });
  for (const [fileId, keys] of edits) {
    if (!FILE_ID.test(fileId)) continue;
    const file = path.join(target, relOf(fileId));
    let text = await fsp.readFile(file, 'utf8').catch(() => null);
    if (text === null) text = await fsp.readFile(`${file}.dist`, 'utf8').catch(() => null);
    // A module without its .conf runs with its defaults (Manastorm: on): the realm's keys are written in a new one.
    if (text === null) { await fsp.mkdir(path.dirname(file), { recursive: true }); text = ''; }
    for (const [k, v] of Object.entries(keys)) if (CONF_KEY.test(k)) text = setKey(text, k, v);
    await fsp.writeFile(file, text);
  }
}

// ---------------------------------------------------------------- settings page
// The CoA settings (overview of the Server settings page) seen from a realm: each value is inherited from CoA, the
// realm's own, or imposed by its mode.
async function settingsOf(root, key, overview) {
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  const own = await ownSettings(root, key);
  const lock = imposed(key, saved);
  const unquote = (setting, value) => (setting.kind === 'quoted' ? String(value).replace(/^"|"$/g, '') : String(value));
  const settings = overview.settings.map(setting => {
    const locked = lock[setting.file]?.[setting.key];
    const mine = own[setting.file]?.[setting.key];
    if (locked !== undefined) return { ...setting, coaValue: setting.value, value: unquote(setting, locked), origin: 'mode' };
    if (mine !== undefined) return { ...setting, coaValue: setting.value, value: unquote(setting, mine), origin: 'own' };
    return { ...setting, coaValue: setting.value, origin: 'coa' };
  });
  return { ...overview, settings, realm: { key, id: saved.id, name: saved.name } };
}

// changes: [{ file, key, value }] or { file, key, reset: true } to follow CoA again. Saved only if all are valid.
async function saveSettings(root, key, changes) {
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  if (!Array.isArray(changes) || !changes.length || changes.length > 200) throw new Error('Nothing to save.');
  const own = await ownSettings(root, key);
  const lock = imposed(key, saved);
  const errors = {};
  for (const change of changes) {
    if (lock[change?.file]?.[change?.key] !== undefined) { errors[change.key] = 'Set by the game mode of this realm.'; continue; }
    const setting = CATALOG.settings.find(item => item.file === change?.file && item.key === change?.key);
    if (!setting) { errors[change?.key || '?'] = 'Unknown setting.'; continue; }
    if (change.reset) { if (own[setting.file]) delete own[setting.file][setting.key]; continue; }
    const text = String(change.value ?? '').trim();
    const problem = validate(setting.kind || 'text', text, setting.choices);
    if (problem) { errors[setting.key] = problem; continue; }
    own[setting.file] = { ...own[setting.file], [setting.key]: setting.kind === 'quoted' ? `"${text}"` : text };
  }
  if (Object.keys(errors).length) throw Object.assign(new Error(`Some values were refused: ${Object.entries(errors).map(([k, m]) => `${k}: ${m}`).join(' ')}`), { fields: errors });
  await writeOwn(root, key, own);
  return { written: [saved.name], backup: null };
}

// ---------------------------------------------------------------- modules of a realm
// A module of a realm is one or two keys of a module .conf, in the same three layers as the settings: as CoA (no own
// value), on or off for this realm (its own values), or set by the realm (imposed). Only the modules the CoA bot server
// has (its .conf or .conf.dist) are shown.
const isOn = value => /^(1|true)$/i.test(String(value ?? '').replace(/"/g, '').trim());
const MODULE_KEYS = {
  bots: { file: 'playerbots.conf', key: 'AiPlayerbot.Enabled', on: { 'AiPlayerbot.Enabled': '1' }, off: { 'AiPlayerbot.Enabled': '0' } },
  ahbot: { file: 'mod_ahbot.conf', key: 'AuctionHouseBot.Enable', on: { 'AuctionHouseBot.Enable': 'true' }, off: { 'AuctionHouseBot.Enable': 'false' } },
  manastorm: { file: 'manastorm-endless.conf', key: 'Manastorm.Enable', on: { 'Manastorm.Enable': '1', 'Manastorm.ClientMode': '2' }, off: { 'Manastorm.Enable': '0' } },
  rotation: { file: 'coa.conf', key: 'CoA.RotationAssist.Enable', on: { 'CoA.RotationAssist.Enable': '1' }, off: { 'CoA.RotationAssist.Enable': '0' } },
  multirace: { file: 'coa_custom_races.conf', key: 'CoACustomRaces.Enable', on: { 'CoACustomRaces.Enable': '1' }, off: { 'CoACustomRaces.Enable': '0', 'CoACustomRaces.BotsEnable': '0' } },
};

async function coaModuleText(root, fileId) {
  const file = path.join(BOTS_CONFIGS(root), relOf(fileId));
  return (await fsp.readFile(file, 'utf8').catch(() => null)) ?? fsp.readFile(`${file}.dist`, 'utf8').catch(() => null);
}

async function modulesOf(root, key) {
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  const own = await ownSettings(root, key);
  const lock = imposed(key, saved);
  const list = [];
  for (const [id, module] of Object.entries(MODULE_KEYS)) {
    const text = await coaModuleText(root, module.file);
    if (text === null) continue;
    const coaOn = isOn(confValue(text, module.key));
    const locked = lock[module.file]?.[module.key];
    const mine = own[module.file]?.[module.key];
    if (locked !== undefined) list.push({ id, origin: 'mode', on: isOn(locked), coaOn });
    else if (mine !== undefined) list.push({ id, origin: 'own', on: isOn(mine), coaOn });
    else list.push({ id, origin: 'coa', on: coaOn, coaOn });
  }
  return list;
}

// state: 'on', 'off', or 'coa' (follow Conquest of Azeroth again). The realm must be stopped: modules are read at start.
async function setModule(root, key, id, state) {
  const module = MODULE_KEYS[id];
  if (!module || !['on', 'off', 'coa'].includes(state)) throw new Error('Unknown module.');
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  if (imposed(key, saved)[module.file]?.[module.key] !== undefined) throw new Error('Set by the game mode of this realm.');
  if (await portOpen(saved.worldPort) || await processOf(root, key)) throw new Error('Stop this realm first: its modules are read when it starts.');
  const own = await ownSettings(root, key);
  const keys = { ...module.on, ...module.off };
  own[module.file] = { ...own[module.file] };
  for (const name of Object.keys(keys)) delete own[module.file][name];
  if (state !== 'coa') Object.assign(own[module.file], module[state]);
  await writeOwn(root, key, own);
  return modulesOf(root, key);
}

// Whether "Start all" starts the CoA world too (Royaumes\coa.json). Off only counts when a realm starts with the
// server: a server never starts with nothing.
async function coaAutostart(root) {
  const value = await readJson(path.join(root, 'Royaumes', 'coa.json'));
  return value?.autostart !== false;
}
async function setCoaAutostart(root, on) {
  await fsp.mkdir(path.join(root, 'Royaumes'), { recursive: true });
  await fsp.writeFile(path.join(root, 'Royaumes', 'coa.json'), JSON.stringify({ autostart: on === true }, null, 2));
}
async function skipCoaAtStart(root) {
  if (await coaAutostart(root)) return false;
  for (const key of Object.keys(MODES)) { const saved = await realmFile(root, key); if (saved?.autostart && !saved.disabled) return true; }
  return false;
}

// ---------------------------------------------------------------- create
// MySQL must run. Never touches a database that already exists (a realm removed by hand and created again keeps
// its characters).
async function create(root, key, { bots = DEFAULT_BOTS, notify = () => {} } = {}) {
  const m = mode(key);
  if (!fs.existsSync(worldExe(root))) throw new Error('The realms need CoA Bots installed in this server.');
  if (!versionReady(botsVersion(root)) || !updaterKnows(root, key)) throw new Error('This realm needs a newer CoA Bots: its update tool must know the realm databases.');
  await refreshBotConfigs(root);
  const dir = dirOf(root, key);
  await fsp.mkdir(path.join(dir, 'Logs'), { recursive: true });
  const p = await ports(root, key);
  for (const port of [p.worldPort, p.raPort]) if (await portOpen(port) && !(await processOf(root, key))) throw new Error(`Port ${port} is already used by another program.`);

  // The realm id: the usual one, unless another realm of this server already has it.
  const rows = (await sql(root, 'SELECT id, name FROM acore_auth.realmlist')).split(/\r?\n/).filter(Boolean).map(line => line.split('\t'));
  let id = m.id;
  const same = rows.find(([, name]) => name === m.name);
  if (same) id = Number(same[0]);
  else if (rows.some(([rid]) => Number(rid) === id)) id = Math.max(...rows.map(([rid]) => Number(rid))) + 1;

  const chars = `acore_characters_${key}`;
  const botsDb = `acore_playerbots_${key}`;
  if (!(await hasDatabase(root, chars))) {
    notify(`Creating ${chars}…`);
    await sql(root, `CREATE DATABASE ${chars} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await copyDump(root, ['--no-data', '--skip-triggers', 'acore_characters'], chars);
    const present = new Set((await sql(root, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'acore_characters'")).split(/\r?\n/));
    const seed = SEED_TABLES.filter(table => present.has(table));
    if (seed.length) await copyDump(root, ['--no-create-info', 'acore_characters', ...seed], chars);
  }
  if (!(await hasDatabase(root, botsDb))) {
    notify(`Creating ${botsDb}…`);
    await sql(root, `CREATE DATABASE ${botsDb} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await copyDump(root, ['acore_playerbots'], botsDb);
    // The bot state of the CoA realm is not this realm's: its bots are made again with their own prefix.
    const present = new Set((await sql(root, `SELECT table_name FROM information_schema.tables WHERE table_schema = '${botsDb}'`)).split(/\r?\n/));
    for (const table of ['playerbots_random_bots', 'playerbots_coa_brain_usage', 'playerbots_account_type']) if (present.has(table)) await sql(root, `TRUNCATE ${botsDb}.${table}`);
  }
  // The worldserver logs in as the user of its DatabaseInfo, which only has rights on the repack's own databases.
  const ws = await fsp.readFile(path.join(BOTS_CONFIGS(root), 'worldserver.conf'), 'utf8');
  const user = ((confValue(ws, 'CharacterDatabaseInfo') || '').split(';')[2] || 'acore').replace(/'/g, '');
  const hosts = (await sql(root, `SELECT host FROM mysql.user WHERE user = '${user}'`)).split(/\r?\n/).filter(Boolean);
  for (const host of hosts) for (const db of [chars, botsDb]) await sql(root, `GRANT ALL PRIVILEGES ON ${db}.* TO '${user}'@'${host.replace(/'/g, '')}'`);
  await listRealm(root, { id, name: m.name, worldPort: p.worldPort });

  const saved = { key, id, name: m.name, worldPort: p.worldPort, raPort: p.raPort, autostart: true, created: new Date().toISOString() };
  await fsp.writeFile(path.join(dir, 'realm.json'), JSON.stringify(saved, null, 2));
  // A new realm starts with fewer bots than most CoA realms: one more world costs memory.
  const own = await ownSettings(root, key);
  if (!own['playerbots.conf']?.[BOT_COUNT[1]]) {
    const count = String(Math.max(0, Math.min(2000, Number(bots) || DEFAULT_BOTS)));
    own['playerbots.conf'] = { ...own['playerbots.conf'], [BOT_COUNT[0]]: count, [BOT_COUNT[1]]: count };
    await writeOwn(root, key, own);
  }
  await writeConfigs(root, key, saved);
  return saved;
}

// Its line of the realm list, made from the CoA one (address, flags, build).
function listRealm(root, { id, name, worldPort }) {
  return sql(root, `REPLACE INTO acore_auth.realmlist (id,name,address,localAddress,localSubnetMask,port,icon,flag,timezone,allowedSecurityLevel,population,gamebuild) SELECT ${Number(id)},'${String(name).replace(/'/g, '')}',address,localAddress,localSubnetMask,${Number(worldPort)},icon,flag,timezone,allowedSecurityLevel,0,gamebuild FROM acore_auth.realmlist WHERE id=1`);
}

// Off: stopped and out of the realm list, everything else kept (characters, bots, settings). On: back as it was.
async function setDisabled(root, key, off) {
  mode(key);
  const file = path.join(dirOf(root, key), 'realm.json');
  const saved = await readJson(file);
  if (!saved) throw new Error('Create the realm first.');
  if (off) {
    await stop(root, key);
    if (await processOf(root, key)) throw new Error('The world of this realm is still running.');
    if (Number(saved.id) !== 1) await sql(root, `DELETE FROM acore_auth.realmlist WHERE id = ${Number(saved.id)}`);
  } else await listRealm(root, saved);
  saved.disabled = off === true;
  await fsp.writeFile(file, JSON.stringify(saved, null, 2));
  return saved;
}

// ---------------------------------------------------------------- start / stop
async function start(root, key, { timeout = 1200 } = {}) {
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  if (saved.disabled) throw new Error('This realm is switched off: switch it on first.');
  if (await portOpen(saved.worldPort)) return;
  if (await processOf(root, key)) throw new Error(`${saved.name} is still starting or stopping.`);
  if (await portOpen(saved.raPort)) throw new Error(`Port ${saved.raPort} is already used by another program.`);
  if (await anotherStarting(root, key)) throw new Error('Another realm is starting: wait until it runs (two worlds must never apply their updates at the same time).');
  await refreshBotConfigs(root);
  await writeConfigs(root, key, saved);
  // The realmlist follows the port (the address follows the CoA realm, set by the network choice).
  await sql(root, `UPDATE acore_auth.realmlist r JOIN acore_auth.realmlist c ON c.id = 1 SET r.port = ${saved.worldPort}, r.address = c.address, r.localAddress = c.localAddress WHERE r.id = ${saved.id}`).catch(() => {});
  const child = launch(root, key, 'started by the launcher');
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    if (await portOpen(saved.worldPort)) return;
    if (!pidAlive(child.pid)) throw new Error(`${saved.name} stopped while starting. Look at Royaumes\\${key}\\Logs.`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`${saved.name} did not open port ${saved.worldPort} in time.`);
}

function launch(root, key, why, env) {
  const dir = dirOf(root, key);
  fs.mkdirSync(path.join(dir, 'Logs'), { recursive: true });
  const log = fs.openSync(path.join(dir, 'Logs', 'world-console.log'), 'a');
  fs.writeSync(log, `\n==== ${new Date().toISOString()} ${why} ====\n`);
  const child = spawn(worldExe(root), ['-c', 'configs\\worldserver.conf'], { cwd: dir, windowsHide: true, detached: !env, stdio: ['ignore', log, log], env: env ? { ...process.env, ...env } : process.env });
  fs.closeSync(log);
  fs.writeFileSync(path.join(dir, '.state.json'), JSON.stringify({ pid: child.pid, exe: worldExe(root), started: new Date().toISOString() }));
  if (!env) child.unref();
  return child;
}

// A realm whose world process is there but not yet open: it may be applying its database updates (the core's SQL
// updater writes a temporary file with a fixed name, so two worlds must never start at the same time).
async function anotherStarting(root, except) {
  for (const key of Object.keys(MODES)) {
    if (key === except) continue;
    const saved = await realmFile(root, key);
    if (saved && await processOf(root, key) && !(await portOpen(saved.worldPort))) return key;
  }
  return '';
}

async function stop(root, key) {
  const saved = await realmFile(root, key);
  if (!saved) return;
  const pid = await processOf(root, key);
  if (!pid && !(await portOpen(saved.worldPort))) return;
  // The repack's RA account (Settings/repack.json) is an account of the shared auth database: valid on every realm.
  await live.raCommand(root, 'server shutdown 1s 0', 20000, saved.raPort).catch(() => {});
  const deadline = Date.now() + 120 * 1000;
  while (Date.now() < deadline && (pid ? pidAlive(pid) : await portOpen(saved.worldPort))) await new Promise(resolve => setTimeout(resolve, 1000));
  if (pid && pidAlive(pid)) await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
  await fsp.rm(path.join(dirOf(root, key), '.state.json'), { force: true });
}

async function stopAll(root) {
  if (!root || !fs.existsSync(path.join(root, 'Royaumes'))) return;
  for (const key of Object.keys(MODES)) await stop(root, key);
}

// Realms marked to start with the server.
async function startMarked(root) {
  const failed = [];
  for (const key of Object.keys(MODES)) {
    const saved = await realmFile(root, key);
    if (saved?.autostart && !saved.disabled) await start(root, key).catch(error => failed.push({ key, error: error.message }));
  }
  return failed;
}

// The random bots of this realm only (its own account prefix), the way CoA Bots purges those of CoA: the realm's
// worldserver runs once with the module's delete option given through the environment, deletes and stops.
async function purgeBots(root, key) {
  const saved = await realmFile(root, key);
  if (!saved) throw new Error('Create the realm first.');
  if (await portOpen(saved.worldPort) || await processOf(root, key)) throw new Error('Stop this realm first.');
  await refreshBotConfigs(root);
  await writeConfigs(root, key, saved);
  const child = launch(root, key, 'deleting the random bots of this realm', { AC_AI_PLAYERBOT_DELETE_RANDOM_BOT_ACCOUNTS: '1' });
  const code = await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve(-1); }, 3600 * 1000); child.once('exit', value => { clearTimeout(timer); resolve(value); }); });
  await fsp.rm(path.join(dirOf(root, key), '.state.json'), { force: true });
  const left = Number(await sql(root, `SELECT COUNT(*) FROM acore_auth.account WHERE username LIKE '${mode(key).prefix.toUpperCase()}%'`).catch(() => '-1'));
  if (left > 0) throw new Error(`${left} bot account(s) of this realm are still there (exit ${code}); see Royaumes\\${key}\\Logs.`);
  return { deleted: true };
}

async function setOptions(root, key, { autostart } = {}) {
  mode(key);
  const file = path.join(dirOf(root, key), 'realm.json');
  const saved = await readJson(file);
  if (!saved) throw new Error('Create the realm first.');
  if (autostart !== undefined) saved.autostart = autostart === true;
  await fsp.writeFile(file, JSON.stringify(saved, null, 2));
  return saved;
}

module.exports = { MODES, setDisabled, versionReady, modulesOf, setModule, coaAutostart, setCoaAutostart, skipCoaAtStart, anotherStarting, refreshBotConfigs, status, create, start, stop, stopAll, startMarked, setOptions, settingsOf, saveSettings, purgeBots, writeConfigs, setKey };
