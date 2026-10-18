'use strict';
// The SquidBots addon in the player's game: the repack carries it (CoA-Bots\Client\Interface\AddOns), the
// launcher copies it into the game client chosen once, and again whenever the repack brings a newer version.
// What the addon saved (WTF\...\SavedVariables) is never touched; the replaced copy is kept in the launcher's data.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { compareVersions } = require('./repack-update.cjs');

const EXES = ['Ascension.exe', 'Wow.exe', 'WoW.exe'];
const isClient = folder => !!folder && EXES.some(name => fsSync.existsSync(path.join(folder, name)));

function tocVersion(folder, name) {
  try {
    const toc = fsSync.readFileSync(path.join(folder, `${name}.toc`), 'utf8');
    return /^##\s*Version:\s*(.+)$/m.exec(toc)?.[1].trim() || '';
  } catch { return ''; }
}

// Version strings like 2.3, 2.10.1 or 2.5-beta: number by number, a stable version before its betas.
const newer = (a, b) => compareVersions(a, b) > 0;

// The client the bots installer used last time (CoA-Bots\client.json), offered when none was chosen here.
function suggestedClient(repack) {
  try {
    const client = JSON.parse(fsSync.readFileSync(path.join(repack, 'CoA-Bots', 'client.json'), 'utf8').replace(/^﻿/, '')).client;
    return isClient(client) ? client : '';
  } catch { return ''; }
}

function status(repack, client) {
  const source = path.join(repack || '', 'CoA-Bots', 'Client', 'Interface', 'AddOns');
  const names = repack && fsSync.existsSync(source) ? fsSync.readdirSync(source, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name) : [];
  if (!names.length) return { state: 'none', addons: [] };
  const addons = names.map(name => ({
    name,
    available: tocVersion(path.join(source, name), name),
    installed: isClient(client) ? tocVersion(path.join(client, 'Interface', 'AddOns', name), name) : '',
  }));
  const main = addons[0];
  let state = 'current';
  if (!isClient(client)) state = 'noclient';
  else if (addons.some(addon => !addon.installed)) state = 'missing';
  else if (addons.some(addon => newer(addon.available, addon.installed))) state = 'outdated';
  return { state, client: isClient(client) ? client : '', suggested: isClient(client) ? '' : suggestedClient(repack), addons, version: main.available, installedVersion: main.installed };
}

// The game reads its addons at login: copying while it runs is refused, so a half-copied addon is never loaded.
function gameRunning() {
  return new Promise(resolve => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 4 << 20 }, (error, out) => {
    if (error) return resolve(false);
    const lower = out.toLowerCase();
    resolve(EXES.some(name => lower.includes(`"${name.toLowerCase()}"`)));
  }));
}

async function install(repack, client, backupRoot) {
  if (!isClient(client)) throw new Error('This folder has no Ascension.exe or Wow.exe: choose the folder of your game client.');
  if (await gameRunning()) throw new Error('Close the game first: it reads its addons when you log in.');
  const source = path.join(repack, 'CoA-Bots', 'Client', 'Interface', 'AddOns');
  const target = path.join(client, 'Interface', 'AddOns');
  await fs.mkdir(target, { recursive: true });
  const done = [];
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const into = path.join(target, entry.name);
    if (fsSync.existsSync(into)) {
      const saved = path.join(backupRoot, `${entry.name}-${tocVersion(into, entry.name) || 'old'}`);
      await fs.rm(saved, { recursive: true, force: true });
      await fs.cp(into, saved, { recursive: true });
    }
    // Copied next to it first, then swapped: the game never sees half an addon.
    const fresh = `${into}.new`;
    await fs.rm(fresh, { recursive: true, force: true });
    await fs.cp(path.join(source, entry.name), fresh, { recursive: true });
    await fs.rm(into, { recursive: true, force: true });
    await fs.rename(fresh, into);
    done.push(entry.name);
  }
  return done;
}

module.exports = { status, install, isClient, newer, gameRunning };
