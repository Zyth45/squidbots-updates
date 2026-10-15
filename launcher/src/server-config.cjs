'use strict';
// Settings of a local repack (.conf files), edited in place.
//
// A value is changed on its own line and nothing else moves: comments, order, spacing and line
// endings stay as they were. Every write keeps a copy of the file first, and every change made
// here is recorded so an upgrade can carry it to the next version of the repack.
//
// Where the files are (Jealous-Sound repack, optionally with CoA Bots next to it):
//   Settings/<name>.conf.template   worldserver, authserver and coa.conf are generated from these at
//                                   every start, so the template is what gets edited;
//   Core/configs/modules/*.conf     module settings;
//   CoA-Bots/Core/configs/modules/  the bot server's own module settings (playerbots.conf...).
// Values that hold database passwords are never sent to the page and cannot be edited here.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { atomicJson, readJson } = require('./release-format.cjs');
const CATALOG = require('./data/server-settings.json');

const KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const LINE = /^([ \t]*)([A-Za-z][A-Za-z0-9_.-]*)([ \t]*=[ \t]*)([^\r\n]*?)([ \t]*)$/;
const SECRET = /(DatabaseInfo|Password|Secret|Token|ApiKey)$/i;
const TEMPLATED = new Set(['worldserver.conf', 'authserver.conf', 'coa.conf']);
const GENERATED = new Set(['coa_bugreport.conf']);
const MAX_FILE = 4 * 1024 * 1024;
const BACKUPS = '.coa-launcher/config-backups';
const CHANGES = '.coa-launcher/config-changes.json';

// 20260929-103512-123: sortable, and two saves in the same second never share a folder.
let lastStamp = '';
function stamp() {
  let value = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.(\d{3})Z$/, '-$1');
  if (value <= lastStamp) value = lastStamp.replace(/(\d{3})$/, n => String(Number(n) + 1).padStart(3, '0'));
  lastStamp = value;
  return value;
}
const STAMP = /^\d{8}-\d{6}-\d{3}$/;

// "1", "0.5", "-3" -> a number; 0/1 are also offered as a switch when the documentation says so.
function inferKind(value) {
  const text = String(value).trim();
  if (/^".*"$/.test(text)) return 'quoted';
  if (/^-?\d+$/.test(text)) return 'int';
  if (/^-?\d*\.\d+$/.test(text)) return 'float';
  return 'text';
}

function validate(kind, value, choices) {
  const text = String(value ?? '').trim();
  if (/[\r\n]/.test(text)) return 'A value cannot span several lines.';
  if (text.length > 400) return 'This value is too long.';
  switch (kind) {
    case 'bool': return ['0', '1'].includes(text) ? null : 'Expected 0 or 1.';
    case 'int': return /^-?\d{1,12}$/.test(text) ? null : 'Expected a whole number.';
    case 'float': return /^-?\d{1,12}(\.\d{1,6})?$/.test(text) ? null : 'Expected a number.';
    case 'ids': return /^(\d+(\s*,\s*\d+)*)?$/.test(text) ? null : 'Expected numbers separated by commas.';
    case 'quoted': return text.includes('"') ? 'Quotes are added for you: type the text alone.' : null;
    case 'choice': return (choices || []).some(choice => String(choice.value) === text) ? null : 'Pick one of the listed values.';
    default: return text.includes('"') && !/^".*"$/.test(text) ? 'Unbalanced quotes.' : null;
  }
}

// Documentation of every key, from the .conf.dist next to the file:
//   AzerothCore style:  #    Rate.XP.Kill / #        Description: ... / #        Default: 1
//   short style:        # Enable randombot system  (the comment lines right above the key)
function parseDocs(text) {
  const docs = new Map();
  const lines = text.split(/\r?\n/);
  let block = [];
  const flush = () => {
    if (!block.length) return;
    const keys = [];
    let description = [];
    let defaults = [];
    let mode = '';
    for (const raw of block) {
      const line = raw.replace(/^#/, '');
      const header = /^\s{3,5}([A-Za-z][A-Za-z0-9_.-]+)\s*$/.exec(line);
      if (header && !mode) { keys.push(header[1]); continue; }
      const field = /^\s+(Description|Default|Example|Important|Note):\s*(.*)$/.exec(line);
      if (field) { mode = field[1]; (mode === 'Default' ? defaults : description).push(mode === 'Description' || mode === 'Default' ? field[2] : `${field[1]}: ${field[2]}`); continue; }
      if (mode) (mode === 'Default' ? defaults : description).push(line.trim());
    }
    const entry = { description: description.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(), defaults: defaults.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() };
    for (const key of keys) if (entry.description) docs.set(key, entry);
  };
  let pending = [];
  for (const line of lines) {
    if (/^\s*#/.test(line)) { block.push(line.trim()); pending.push(line.replace(/^\s*#+\s?/, '').trim()); continue; }
    flush();
    block = [];
    const match = LINE.exec(line);
    if (match && !docs.has(match[2])) {
      const text = pending.filter(item => item && !/^[#=\-*]+$/.test(item)).join(' ').trim();
      if (text && text.length < 600) docs.set(match[2], { description: text, defaults: '' });
    }
    if (line.trim()) pending = [];
  }
  flush();
  return docs;
}

function parseValues(text) {
  const values = new Map();
  let section = '';
  let banner = -10;
  text.split(/\r?\n/).forEach((line, index) => {
    // A section title sits right under a line of #: "####...", "# SUMMON OPTIONS" (the index at the top
    // of a file lists the same names, but not under a banner).
    if (/^\s*#{10,}\s*$/.test(line)) { banner = index; return; }
    const header = index - banner <= 2 ? /^\s*#\s{0,6}([A-Z][A-Z0-9 &/()-]{2,}?)\s*#*\s*$/.exec(line) : null;
    if (header && header[1].trim() !== 'SECTION INDEX') section = header[1].trim();
    const match = LINE.exec(line);
    if (match && !values.has(match[2])) values.set(match[2], { value: match[4], line: index, section });
  });
  return values;
}

class ServerConfig {
  constructor(root) {
    this.root = path.resolve(root);
  }

  resolve(relative) {
    const file = path.resolve(this.root, relative);
    if (!file.startsWith(this.root + path.sep)) throw new Error('Path outside the repack folder.');
    return file;
  }

  exists(relative) { return fs.existsSync(this.resolve(relative)); }

  // Every editable .conf, with the file its defaults and documentation come from.
  async files() {
    const found = [];
    const add = (id, relative, dist, scope) => {
      if (!this.exists(relative) || found.some(file => file.id === id)) return;
      found.push({ id, name: id, path: relative, dist: dist && this.exists(dist) ? dist : '', scope, template: relative.startsWith('Settings/') });
    };
    for (const name of TEMPLATED) add(name, `Settings/${name}.template`, `Core/configs/${name === 'coa.conf' ? 'modules/' : ''}${name}.dist`, 'server');
    for (const [folder, scope] of [['Core/configs/modules', 'server'], ['CoA-Bots/Core/configs/modules', 'bots']]) {
      const entries = await fsp.readdir(this.resolve(folder)).catch(() => []);
      for (const name of entries.filter(item => /\.conf$/i.test(item)).sort()) {
        if (GENERATED.has(name) || TEMPLATED.has(name)) continue;
        // The bot server copies the repack's module files over its own at every start: those are edited at the source.
        if (scope === 'bots' && this.exists(`Core/configs/modules/${name}`) && name !== 'playerbots.conf') continue;
        add(name, `${folder}/${name}`, `${folder}/${name}.dist`, scope);
      }
    }
    for (const name of TEMPLATED) add(name, `Core/configs/${name === 'coa.conf' ? 'modules/' : ''}${name}`, `Core/configs/${name === 'coa.conf' ? 'modules/' : ''}${name}.dist`, 'server');
    return found;
  }

  async file(id) {
    const file = (await this.files()).find(item => item.id === id);
    if (!file) throw new Error('This settings file is not part of the repack.');
    return file;
  }

  async read(relative) {
    const target = this.resolve(relative);
    const stat = await fsp.stat(target);
    if (stat.size > MAX_FILE) throw new Error('This settings file is too large to edit here.');
    return fsp.readFile(target, 'utf8');
  }

  // Keys another part of the repack writes at every start: shown, but changing them would be lost.
  managed(fileId) {
    return (CATALOG.managed || []).filter(rule => rule.file === fileId && this.exists(rule.when));
  }

  // The curated settings with their current values, for the files this repack has.
  async overview() {
    const files = await this.files();
    const cache = new Map();
    const valuesOf = async fileId => {
      if (!cache.has(fileId)) {
        const file = files.find(item => item.id === fileId);
        cache.set(fileId, file ? parseValues(await this.read(file.path)) : null);
      }
      return cache.get(fileId);
    };
    const settings = [];
    for (const setting of CATALOG.settings) {
      const values = await valuesOf(setting.file);
      const current = values?.get(setting.key);
      if (!current) continue;
      settings.push({ ...setting, value: setting.kind === 'quoted' ? current.value.replace(/^"|"$/g, '') : current.value });
    }
    const changes = (await readJson(this.resolve(CHANGES))) || {};
    return {
      files: files.map(({ id, name, path: relative, scope, template }) => ({ id, name, path: relative, scope, template })),
      groups: CATALOG.groups,
      when: CATALOG.when,
      settings,
      recipes: CATALOG.recipes.filter(recipe => Object.keys(recipe.changes).every(key => settings.some(setting => setting.key === key))),
      overrides: CATALOG.overrides,
      changed: Object.keys(changes).length,
      bots: this.exists('CoA-Bots/coa_bots.py'),
    };
  }

  // Every key of one file, documented from its .dist; secrets are listed but never sent.
  async details(fileId) {
    const file = await this.file(fileId);
    const values = parseValues(await this.read(file.path));
    const docs = file.dist ? parseDocs(await this.read(file.dist)) : new Map();
    const defaults = file.dist ? parseValues(await this.read(file.dist)) : new Map();
    const locked = new Map(this.managed(fileId).flatMap(rule => rule.keys.map(key => [key, rule.reason])));
    const curated = new Map(CATALOG.settings.filter(setting => setting.file === fileId).map(setting => [setting.key, setting]));
    const entries = [];
    for (const [key, entry] of values) {
      const secret = SECRET.test(key);
      const doc = docs.get(key);
      const fallback = defaults.get(key)?.value;
      const kind = curated.get(key)?.kind || (['0', '1'].includes(entry.value.trim()) && (fallback === undefined || ['0', '1'].includes(fallback.trim())) && /enable|allow|disable|use|show|only|ignore|auto/i.test(`${key} ${doc?.description || ''}`) ? 'bool' : inferKind(entry.value));
      entries.push({
        key,
        value: secret ? '' : kind === 'quoted' ? entry.value.replace(/^"|"$/g, '') : entry.value,
        default: secret || fallback === undefined ? null : kind === 'quoted' ? fallback.replace(/^"|"$/g, '') : fallback,
        kind,
        section: entry.section,
        description: doc?.description || '',
        defaults: doc?.defaults || '',
        locked: secret ? 'secret' : locked.get(key) || '',
        curated: curated.has(key),
      });
    }
    return { file: { id: file.id, path: file.path, template: file.template, scope: file.scope }, entries };
  }

  // changes: [{ file, key, value }]. Nothing is written unless every value is valid.
  async save(changes, { record = true } = {}) {
    if (!Array.isArray(changes) || !changes.length || changes.length > 500) throw new Error('Nothing to save.');
    const files = await this.files();
    const byFile = new Map();
    const errors = {};
    for (const change of changes) {
      const file = files.find(item => item.id === change?.file);
      if (!file || !KEY.test(change.key || '')) { errors[change?.key || '?'] = 'Unknown setting.'; continue; }
      if (SECRET.test(change.key)) { errors[change.key] = 'Database credentials are managed by the repack.'; continue; }
      if (this.managed(file.id).some(rule => rule.keys.includes(change.key))) { errors[change.key] = 'This value is rewritten by the repack at every start.'; continue; }
      const curated = CATALOG.settings.find(setting => setting.file === file.id && setting.key === change.key);
      const text = String(change.value ?? '').trim();
      const kind = curated?.kind || change.kind || inferKind(text);
      const problem = validate(['bool', 'int', 'float', 'ids', 'quoted', 'choice', 'text'].includes(kind) ? kind : 'text', text, curated?.choices);
      if (problem) { errors[change.key] = problem; continue; }
      if (!byFile.has(file.id)) byFile.set(file.id, { file, pairs: new Map() });
      byFile.get(file.id).pairs.set(change.key, kind === 'quoted' ? `"${text}"` : text);
    }
    if (Object.keys(errors).length) {
      const error = new Error(`Some values were refused: ${Object.entries(errors).map(([key, message]) => `${key}: ${message}`).join(' ')}`);
      error.fields = errors;
      throw error;
    }
    const when = stamp();
    const written = [];
    const recorded = (await readJson(this.resolve(CHANGES))) || {};
    for (const { file, pairs } of byFile.values()) {
      const original = await this.read(file.path);
      const newline = original.includes('\r\n') ? '\r\n' : '\n';
      const lines = original.split(/\r?\n/);
      const missing = new Set(pairs.keys());
      for (let i = 0; i < lines.length; i++) {
        const match = LINE.exec(lines[i]);
        if (!match || !missing.has(match[2])) continue;
        lines[i] = `${match[1]}${match[2]}${match[3]}${pairs.get(match[2])}${match[5]}`;
        missing.delete(match[2]);
      }
      if (missing.size) throw new Error(`Not found in ${file.name}: ${[...missing].join(', ')}.`);
      const updated = lines.join(newline);
      if (updated === original) continue;
      const backup = this.resolve(`${BACKUPS}/${when}/${file.path}`);
      await fsp.mkdir(path.dirname(backup), { recursive: true });
      await fsp.copyFile(this.resolve(file.path), backup);
      const target = this.resolve(file.path);
      await fsp.writeFile(`${target}.coa-tmp`, updated, 'utf8');
      await fsp.rename(`${target}.coa-tmp`, target);
      written.push(file.name);
      if (record) for (const [key, value] of pairs) recorded[`${file.id}|${key}`] = value;
    }
    if (record && written.length) await atomicJson(this.resolve(CHANGES), recorded);
    return { written, backup: written.length ? when : null };
  }

  // Copies of the files as they were before each save.
  async backups() {
    const folder = this.resolve(BACKUPS);
    const stamps = (await fsp.readdir(folder).catch(() => [])).filter(name => STAMP.test(name)).sort().reverse();
    const list = [];
    for (const name of stamps.slice(0, 50)) {
      const files = [];
      const walk = async (dir, prefix) => {
        for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
          else files.push(`${prefix}${entry.name}`);
        }
      };
      await walk(path.join(folder, name), '');
      list.push({ id: name, files });
    }
    return list;
  }

  async restore(id) {
    if (!STAMP.test(String(id))) throw new Error('Unknown backup.');
    const backup = (await this.backups()).find(item => item.id === id);
    if (!backup) throw new Error('Unknown backup.');
    const known = new Set((await this.files()).map(file => file.path));
    const when = stamp();
    for (const relative of backup.files) {
      if (!known.has(relative)) continue;
      const current = this.resolve(`${BACKUPS}/${when}/${relative}`);
      await fsp.mkdir(path.dirname(current), { recursive: true });
      await fsp.copyFile(this.resolve(relative), current);
      await fsp.copyFile(this.resolve(`${BACKUPS}/${id}/${relative}`), this.resolve(relative));
    }
    return { restored: backup.files.length, backup: when };
  }

  // The changes made through the launcher, applied again to another install (an upgraded repack).
  async carryTo(target) {
    const recorded = (await readJson(this.resolve(CHANGES))) || {};
    const other = new ServerConfig(target);
    const files = new Set((await other.files()).map(file => file.id));
    const changes = [];
    const skipped = [];
    for (const [id, value] of Object.entries(recorded)) {
      const [file, key] = id.split('|');
      if (!files.has(file)) { skipped.push(key); continue; }
      const setting = CATALOG.settings.find(item => item.file === file && item.key === key);
      changes.push({ file, key, value: setting?.kind === 'quoted' ? value.replace(/^"|"$/g, '') : value, kind: setting?.kind || (/^".*"$/.test(value) ? 'quoted' : undefined) });
    }
    const applied = [];
    for (const change of changes) {
      try { await other.save([{ ...change, value: change.kind === 'quoted' ? change.value.replace(/^"|"$/g, '') : change.value }]); applied.push(change.key); }
      catch { skipped.push(change.key); }
    }
    return { applied, skipped };
  }
}

module.exports = { ServerConfig, parseDocs, parseValues, validate, SECRET };
