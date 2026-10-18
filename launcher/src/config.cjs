'use strict';
// Launcher Lite configuration: one game (client + addons, published as signed static files) and one
// local server (a repack, and optionally the CoA Bots package on top of it).
//
// launcher.config.json next to the app, or <user data>/launcher.config.json to point it elsewhere.
// Everything is validated here: a broken or hostile file cannot make the launcher run programs
// outside the repack folder or download from a plain-HTTP host on the Internet.
const fs = require('node:fs');
const path = require('node:path');
const { publicKey } = require('./signing.cjs');
const { REALMLIST } = require('./game.cjs');
const { validateServices, validateCommand } = require('./server-control.cjs');

function serviceUrl(value, label, trustedHosts, { optional = false } = {}) {
  if (!value) {
    if (optional) return '';
    throw new Error(`${label} is missing.`);
  }
  const url = new URL(value);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials.`);
  if (url.protocol === 'https:') return url.href;
  if (url.protocol === 'http:' && trustedHosts.has(url.hostname)) return url.href;
  throw new Error(`${label} must use HTTPS (plain HTTP is only allowed for ${[...trustedHosts].join(', ')}).`);
}

// A text of the configuration: one string, or one per language ({ "en": …, "fr": …, "ru": … }).
function label(value, max) {
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([lang]) => /^[a-z]{2}$/.test(lang)).map(([lang, text]) => [lang, String(text).slice(0, max)]));
  return String(value || '').slice(0, max);
}

const relativeFile = (value, pattern) => typeof value === 'string' && pattern.test(value) && !value.split('/').includes('..') && !path.isAbsolute(value);

// The bot package: its own signed release, unpacked in a folder of the repack, then its installer.
function validateBots(source, trusted) {
  if (!source) return null;
  if (!relativeFile(source.folder, /^[\w.-]+$/)) throw new Error('server.bots.folder must be a folder name.');
  const install = source.install || {};
  if (!relativeFile(install.script, /^[\w./-]+\.ps1$/)) throw new Error('server.bots.install.script must be a .ps1 file of the package.');
  const args = (install.args || []).map(String);
  if (args.some(arg => arg.includes('..') || /[\r\n"]/.test(arg))) throw new Error('server.bots.install.args cannot leave the repack folder.');
  return {
    name: String(source.name || 'Bots').slice(0, 40),
    description: label(source.description, 300),
    folder: source.folder,
    manifestUrl: serviceUrl(source.manifestUrl, 'server.bots.manifestUrl', trusted, { optional: true }),
    testManifestUrl: serviceUrl(source.testManifestUrl, 'server.bots.testManifestUrl', trusted, { optional: true }),
    releaseKey: source.releaseKey ? String(source.releaseKey) : '',
    requiredExecutable: relativeFile(source.requiredExecutable, /^[\w./-]+\.exe$/i) ? source.requiredExecutable : 'Core/worldserver.exe',
    install: { script: install.script, args, timeout: Math.min(3600, Math.max(60, Number(install.timeout) || 900)) },
    // The in-game addon that goes with the bots (an id of the addon catalog), installed once with them.
    addon: typeof source.addon === 'string' && /^[a-z0-9-]{1,40}$/.test(source.addon) ? source.addon : '',
  };
}

function validate(raw) {
  if (!raw?.game) throw new Error('The launcher configuration needs a "game" section.');
  const trusted = new Set((raw.trustedLocalHosts || ['127.0.0.1', 'localhost']).filter(host => typeof host === 'string'));
  const game = raw.game;
  const executable = String(game.clientExecutable || 'Wow.exe');
  if (executable !== path.basename(executable) || !/\.exe$/i.test(executable)) throw new Error('game.clientExecutable must be a file name.');
  const realmlists = (game.realmlists || []).slice(0, 10).map(item => {
    if (!REALMLIST.test(item?.address || '')) throw new Error(`game.realmlists: invalid address ${item?.address}.`);
    return { name: String(item.name || item.address).slice(0, 40), address: item.address };
  });
  if (!realmlists.length) realmlists.push({ name: 'Local', address: '127.0.0.1' });
  const source = raw.server;
  const server = source ? {
    description: label(source.description, 300),
    manifestUrl: serviceUrl(source.manifestUrl, 'server.manifestUrl', trusted, { optional: true }),
    // The repack is not hosted: players download it themselves (where: repackSource) and import the zip.
    // knownRepacksUrl: a signed list of the sha256 of the known releases, to tell them theirs is genuine.
    knownRepacksUrl: serviceUrl(source.knownRepacksUrl, 'server.knownRepacksUrl', trusted, { optional: true }),
    // updatesUrl: the signed list of the latest repack update (update.json of the squidbots-updates releases).
    updatesUrl: serviceUrl(source.updatesUrl, 'server.updatesUrl', trusted, { optional: true }),
    // betaUpdatesUrl: the same list for the beta channel (a pre-release), read only by testers who ask for it.
    betaUpdatesUrl: serviceUrl(source.betaUpdatesUrl, 'server.betaUpdatesUrl', trusted, { optional: true }),
    // The Multirace module (added races) is shown only by an edition that ships the races core.
    multirace: source.multirace === true,
    repackSource: label(source.repackSource, 300),
    repackSourceUrl: source.repackSourceUrl && /^https:\/\/[\w.-]+(\/[\w\-./?=&#%~+]*)?$/.test(source.repackSourceUrl) ? source.repackSourceUrl : '',
    testManifestUrl: serviceUrl(source.testManifestUrl, 'server.testManifestUrl', trusted, { optional: true }),
    releaseKey: source.releaseKey ? String(source.releaseKey) : '',
    requiredExecutable: relativeFile(source.requiredExecutable, /^[\w./-]+\.exe$/i) ? source.requiredExecutable : 'worldserver.exe',
    services: validateServices(source.services),
    commands: { stopAll: validateCommand(source.stopAll, 'server.stopAll'), console: validateCommand(source.console, 'server.console'), purgeBots: validateCommand(source.purgeBots, 'server.purgeBots') },
    bots: validateBots(source.bots, trusted),
  } : null;
  return {
    appName: String(raw.appName || 'CoA Launcher Lite').slice(0, 60),
    edition: raw.edition === 'server' && raw.server ? 'server' : 'full',
    launcherUpdateUrl: serviceUrl(raw.launcherUpdateUrl, 'launcherUpdateUrl', trusted, { optional: true }),
    // The signed news feed: download links (repack, client), known repack releases, news. Read every 30 min.
    feedUrl: serviceUrl(raw.feedUrl, 'feedUrl', trusted, { optional: true }),
    launcherUpdateKey: raw.launcherUpdateKey ? (publicKey(raw.launcherUpdateKey), String(raw.launcherUpdateKey)) : '',
    discordUrl: raw.discordUrl && /^https:\/\/(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9-]{2,32}$/.test(raw.discordUrl) ? raw.discordUrl : '',
    trustedLocalHosts: [...trusted],
    game: {
      id: 'game',
      name: String(game.name || 'World of Warcraft').slice(0, 60),
      clientExecutable: executable,
      processNames: (game.processNames || [executable]).map(String).filter(name => /^[\w.-]+\.exe$/i.test(name)).slice(0, 5),
      manifestUrl: serviceUrl(game.manifestUrl, 'game.manifestUrl', trusted, { optional: true }),
      testManifestUrl: serviceUrl(game.testManifestUrl, 'game.testManifestUrl', trusted, { optional: true }),
      addonCatalogUrl: serviceUrl(game.addonCatalogUrl, 'game.addonCatalogUrl', trusted, { optional: true }),
      releaseKey: game.releaseKey ? String(game.releaseKey) : '',
      realmlists,
      // "Updates only": the launcher never ships the base game. Players get it from baseClient.url,
      // then show its folder; the releases hold only the files that changed.
      updatesOnly: game.updatesOnly === true,
      baseClient: game.baseClient?.url ? { url: serviceUrl(game.baseClient.url, 'game.baseClient.url', new Set()), note: label(game.baseClient.note, 400) } : null,
    },
    server,
  };
}

function loadConfig(bundledFile, userFile) {
  let source = 'bundled';
  let raw = JSON.parse(fs.readFileSync(bundledFile, 'utf8'));
  const override = process.env.COA_LAUNCHER_CONFIG || userFile;
  if (override && fs.existsSync(override)) { raw = JSON.parse(fs.readFileSync(override, 'utf8')); source = override; }
  const config = validate(raw);
  config.source = source;
  // Keys are parsed once so a bad key fails at start, not in the middle of an update.
  config.keys = {
    game: config.game.releaseKey ? publicKey(config.game.releaseKey) : null,
    server: config.server?.releaseKey ? publicKey(config.server.releaseKey) : null,
    bots: config.server?.bots?.releaseKey ? publicKey(config.server.bots.releaseKey) : null,
  };
  return config;
}

module.exports = { loadConfig, validate, serviceUrl };
