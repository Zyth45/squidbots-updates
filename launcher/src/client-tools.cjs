'use strict';
// Small care tools for the game folder, as players know them from other launchers:
// - copies of WTF/ (settings, key bindings, macros and the addons' SavedVariables), made by hand or
//   automatically before every update and addon install, and put back in one click;
// - emptying Cache/ (the client's local copy of items and creatures, the usual cure for "ghost" items).
const fs = require('node:fs/promises');
const path = require('node:path');

const FOLDER = '.coa-launcher/wtf-backups';
const STAMP = /^\d{8}-\d{6}(-auto)?$/;
const KEEP = 10;

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');

async function realDirectory(target) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${path.basename(target)} is not a normal folder; it was left alone.`);
  return true;
}

async function size(folder) {
  let total = 0;
  for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const target = path.join(folder, entry.name);
    total += entry.isDirectory() ? await size(target) : (await fs.stat(target)).size;
  }
  return total;
}

async function backupSettings(root, { automatic = false } = {}) {
  const source = path.join(root, 'WTF');
  if (!(await realDirectory(source))) return null;
  const name = `${stamp()}${automatic ? '-auto' : ''}`;
  const target = path.join(root, FOLDER, name);
  await fs.cp(source, path.join(target, 'WTF'), { recursive: true, errorOnExist: false, force: true, verbatimSymlinks: true });
  // Only the most recent copies are kept, manual ones before automatic ones.
  const list = await listSettingsBackups(root);
  const extra = list.filter(item => item.automatic).slice(KEEP);
  for (const item of extra) await fs.rm(path.join(root, FOLDER, item.id), { recursive: true, force: true });
  return { id: name, size: await size(target) };
}

async function listSettingsBackups(root) {
  const names = (await fs.readdir(path.join(root, FOLDER)).catch(() => [])).filter(name => STAMP.test(name)).sort().reverse();
  const list = [];
  for (const id of names) list.push({ id, automatic: id.endsWith('-auto'), size: await size(path.join(root, FOLDER, id)) });
  return list;
}

async function restoreSettings(root, id) {
  if (!STAMP.test(String(id))) throw new Error('Unknown backup.');
  const source = path.join(root, FOLDER, id, 'WTF');
  if (!(await realDirectory(source))) throw new Error('This backup no longer exists.');
  const current = await backupSettings(root);
  const target = path.join(root, 'WTF');
  if (await realDirectory(target)) await fs.rm(target, { recursive: true, force: true });
  await fs.cp(source, target, { recursive: true, verbatimSymlinks: true });
  return { restored: id, previous: current?.id || null };
}

async function clearCache(root) {
  const target = path.join(root, 'Cache');
  if (!(await realDirectory(target))) return { freed: 0 };
  const freed = await size(target);
  await fs.rm(target, { recursive: true, force: true });
  return { freed };
}

module.exports = { backupSettings, listSettingsBackups, restoreSettings, clearCache };
