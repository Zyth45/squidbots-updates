'use strict';
// Shared rules for every file the launcher writes into a game folder.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const SHA256 = /^[a-f0-9]{64}$/;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

// Areas a release may never write into. Client: the player's settings, screenshots and addons
// (addons have their own manager). Server repack: the MySQL data folder and the logs.
const RULES = {
  client: [/^wtf(\/|$)/i, /^cache(\/|$)/i, /^logs(\/|$)/i, /^errors(\/|$)/i, /^screenshots(\/|$)/i, /^interface\/addons(\/|$)/i, /^\.coa-launcher(\/|$)/i, /(^|\/)realmlist\.wtf$/i],
  // Only mysql/data: "Data/" at the root holds the server maps and must stay patchable.
  server: [/^mysql\/data(\/|$)/i, /^logs(\/|$)/i, /^\.coa-launcher(\/|$)/i, /(^|\/)[^/]+\.(pid|err|log)$/i],
};

function checkPath(value) {
  if (typeof value !== 'string' || !value || value.length > 260 || value.includes('\\') || value.startsWith('/')) throw new Error(`Invalid path: ${value}`);
  for (const part of value.split('/')) {
    if (!part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /~\d/.test(part) || RESERVED.test(part)) throw new Error(`Unsafe path: ${value}`);
  }
  return value;
}

// Seeds: protected areas a release may fill once, on a fresh install (the repack's starting
// database). Only files flagged preserve may go there, so an update can never overwrite them.
// A seed is all or nothing: once its folder exists, the database lives its own life (MySQL renames
// and rotates its files) and no file of the seed is ever compared or installed again.
const SEEDS = { client: [], server: [/^mysql\/data(\/|$)/i] };
const SEED_ROOTS = { client: [], server: ['mysql/data'] };
const isSeed = (value, rules = 'client') => SEEDS[rules].some(rule => rule.test(value));
const seedRoot = (value, rules = 'client') => SEED_ROOTS[rules].find(root => value.toLowerCase() === root || value.toLowerCase().startsWith(`${root}/`)) || null;
const isProtected = (value, rules = 'client', { allowSeed = false } = {}) => RULES[rules].some(rule => rule.test(value)) && !(allowSeed && isSeed(value, rules));

function checkComponents(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 64) throw new Error('Invalid component list.');
  const ids = new Set();
  return list.map(component => {
    if (!component || !/^[a-z0-9-]{1,40}$/.test(component.id) || ids.has(component.id)) throw new Error('Invalid component id.');
    ids.add(component.id);
    return {
      id: component.id,
      name: String(component.name || component.id).slice(0, 80),
      description: String(component.description || '').slice(0, 300),
      group: String(component.group || '').slice(0, 40),
      default: component.default === true,
    };
  });
}

const RETIRE = /^Interface\/AddOns\/[A-Za-z0-9_.' -]{1,64}$/;
const RETIRED_FOLDER = 'Retired addons';

function validateManifest(data, requiredExecutable, rules = 'client') {
  if (!data || data.schema !== 1 || typeof data.version !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(data.version)) throw new Error('Invalid client release manifest.');
  if (!Array.isArray(data.files) || !data.files.length || data.files.length > 200000) throw new Error('The client release manifest has no files.');
  const components = checkComponents(data.components);
  const componentIds = new Set(components.map(component => component.id));
  const seen = new Set();
  const files = data.files.map(file => {
    checkPath(file.path);
    if (isProtected(file.path, rules, { allowSeed: file.preserve === true })) throw new Error(`Release tries to overwrite a protected file: ${file.path}`);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !SHA256.test(file.sha256)) throw new Error(`Invalid release entry: ${file.path}`);
    if (file.gz !== undefined && (!Number.isSafeInteger(file.gz) || file.gz <= 0)) throw new Error(`Invalid compressed size: ${file.path}`);
    if (file.component !== undefined && !componentIds.has(file.component)) throw new Error(`Unknown component for ${file.path}`);
    const key = file.path.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate release path: ${file.path}`);
    if (file.alt !== undefined && (!Array.isArray(file.alt) || file.alt.length > 4 || file.alt.some(alt => typeof alt !== 'string' || alt.toLowerCase() === key))) throw new Error(`Invalid local copies for ${file.path}`);
    for (const alt of file.alt || []) checkPath(alt);
    seen.add(key);
    // preserve: installed when missing, never replaced or removed afterwards (configuration files).
    return { path: file.path, size: file.size, sha256: file.sha256, ...(file.component ? { component: file.component } : {}), ...(file.preserve === true ? { preserve: true } : {}), ...(file.alt?.length ? { alt: file.alt } : {}), ...(file.gz ? { gz: file.gz } : {}) };
  });
  for (const key of seen) {
    const parts = key.split('/');
    while (parts.length > 1) { parts.pop(); if (seen.has(parts.join('/'))) throw new Error('A release file conflicts with a folder of the same name.'); }
  }
  if (requiredExecutable && !seen.has(requiredExecutable.toLowerCase())) throw new Error(`The release does not contain ${requiredExecutable}.`);
  // retire: addon folders of the base game this release replaces or drops. They are moved, once, to
  // "Retired addons" next to the game (never deleted), and only ever addon folders.
  if (data.retire !== undefined && (!Array.isArray(data.retire) || data.retire.length > 500)) throw new Error('Invalid list of retired addons.');
  const retire = (data.retire || []).map(entry => {
    if (typeof entry !== 'string' || !RETIRE.test(entry)) throw new Error(`Only addon folders can be retired: ${entry}`);
    checkPath(entry);
    if (seen.has(entry.toLowerCase()) || [...seen].some(key => key.startsWith(entry.toLowerCase() + '/'))) throw new Error(`A retired addon is also in the release: ${entry}`);
    return entry;
  });
  return {
    schema: 1,
    version: data.version,
    publishedAt: typeof data.publishedAt === 'string' ? data.publishedAt : '',
    notes: Array.isArray(data.notes) ? data.notes.filter(n => typeof n === 'string').map(n => n.slice(0, 500)).slice(0, 40) : [],
    components,
    files,
    retire,
  };
}

async function statOrNull(file) {
  try { return await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Resolves root/relative and refuses links or junctions anywhere on the way, so a crafted
// folder can never redirect writes outside the game directory.
async function safePath(root, relative, { internal = false, rules = 'client', allowSeed = false } = {}) {
  checkPath(relative);
  if (!internal && isProtected(relative, rules, { allowSeed })) throw new Error(`Protected files are never patched: ${relative}`);
  const base = path.resolve(root);
  const target = path.join(base, ...relative.split('/'));
  const parsed = path.parse(target);
  const segments = target.slice(parsed.root.length).split(path.sep);
  let current = parsed.root;
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]);
    const stat = await statOrNull(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) throw new Error(`Linked folders are not supported: ${current}`);
    if (i < segments.length - 1 && !stat.isDirectory()) throw new Error(`Expected a folder: ${current}`);
  }
  return target;
}

async function hashFile(file, signal, onBytes) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024 })) {
    signal?.throwIfAborted();
    hash.update(chunk);
    onBytes?.(chunk.length);
  }
  return hash.digest('hex');
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, 'wx');
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  try { await fs.rename(temp, file); } catch (error) { await fs.unlink(temp).catch(() => {}); throw error; }
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

async function removeEmptyParents(file, boundary) {
  const stop = path.resolve(boundary);
  let folder = path.dirname(file);
  while (folder.startsWith(stop + path.sep)) {
    try { await fs.rmdir(folder); } catch { return; }
    folder = path.dirname(folder);
  }
}

module.exports = {
  RETIRED_FOLDER, SHA256, checkPath, isProtected, isSeed, seedRoot, validateManifest, statOrNull, safePath, hashFile, atomicJson, readJson, removeEmptyParents };
