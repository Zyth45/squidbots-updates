'use strict';
// The player's choices, kept in <user data>/settings.json and cleaned at every read and write.
const fs = require('node:fs/promises');
const path = require('node:path');
const { REALMLIST } = require('./game.cjs');

const LANGUAGES = new Set(['en', 'fr', 'ru']);
const PAGES = new Set(['play', 'server']);
const THEMES = new Set(['classic', 'abyss']);
const CHANNELS = new Set(['stable', 'test']);
const defaults = Object.freeze({
  language: 'fr', theme: 'abyss', channel: 'stable', startPage: 'play', realmlist: '', minimizeOnLaunch: true, reduceMotion: false,
  autoCheckAddons: true, installPaths: {}, components: {}, instances: [], modules: { squidbots: true },
});

function sanitize(value) {
  const out = structuredClone(defaults);
  if (!value || typeof value !== 'object') return out;
  if (LANGUAGES.has(value.language)) out.language = value.language;
  if (PAGES.has(value.startPage)) out.startPage = value.startPage;
  if (THEMES.has(value.theme)) out.theme = value.theme;
  if (CHANNELS.has(value.channel)) out.channel = value.channel;
  if (typeof value.realmlist === 'string' && REALMLIST.test(value.realmlist)) out.realmlist = value.realmlist;
  for (const key of ['minimizeOnLaunch', 'reduceMotion', 'autoCheckAddons']) if (typeof value[key] === 'boolean') out[key] = value[key];
  if (value.installPaths && typeof value.installPaths === 'object') {
    for (const [area, folder] of Object.entries(value.installPaths)) if (/^[a-z]{1,20}$/.test(area) && typeof folder === 'string' && path.isAbsolute(folder)) out.installPaths[area] = path.normalize(folder);
  }
  if (value.modules && typeof value.modules.squidbots === 'boolean') out.modules.squidbots = value.modules.squidbots;
  if (Array.isArray(value.instances)) out.instances = [...new Set(value.instances.filter(folder => typeof folder === 'string' && path.isAbsolute(folder)).map(folder => path.normalize(folder)))].slice(0, 12);
  if (value.components && typeof value.components === 'object') {
    for (const [area, choice] of Object.entries(value.components)) {
      if (!/^[a-z]{1,20}$/.test(area) || !choice || typeof choice !== 'object') continue;
      out.components[area] = Object.fromEntries(Object.entries(choice).filter(([id, on]) => /^[a-z0-9-]{1,40}$/.test(id) && typeof on === 'boolean'));
    }
  }
  return out;
}

async function readSettings(file) {
  try { return sanitize(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch { return sanitize(null); }
}

async function writeSettings(file, value) {
  const clean = sanitize(value);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + '.tmp', JSON.stringify(clean, null, 2));
  await fs.rename(file + '.tmp', file);
  return clean;
}

module.exports = { readSettings, writeSettings, sanitize, defaults };
