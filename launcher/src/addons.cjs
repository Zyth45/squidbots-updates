'use strict';
// Addon manager fed by a signed catalog published next to the client (tools/publish-addons.mjs).
// The launcher only ever deletes files it installed itself and that are still unmodified.
const fs = require('node:fs/promises');
const path = require('node:path');
const { checkPath, safePath, statOrNull, hashFile, atomicJson, readJson, removeEmptyParents, SHA256 } = require('./release-format.cjs');
const { Journal } = require('./journal.cjs');
const { downloadObject } = require('./downloader.cjs');
const { fetchSigned } = require('./signing.cjs');

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FOLDER = /^[A-Za-z0-9_.!+ -]{1,80}$/;
const STATE = 'state.json';

function validateCatalog(data) {
  if (!data || data.schema !== 1 || !Array.isArray(data.packages)) throw new Error('The addon catalog is invalid.');
  const ids = new Set();
  const owners = new Map();
  const packages = data.packages.map(pkg => {
    if (!ID.test(pkg.id) || ids.has(pkg.id)) throw new Error(`Invalid addon id: ${pkg.id}`);
    ids.add(pkg.id);
    if (!Array.isArray(pkg.folders) || !pkg.folders.length || pkg.folders.some(folder => !FOLDER.test(folder))) throw new Error(`Invalid folders for ${pkg.id}`);
    const folders = new Set(pkg.folders.map(folder => folder.toLowerCase()));
    for (const folder of folders) {
      if (owners.has(folder)) throw new Error(`Addon folder ${folder} belongs to two packages.`);
      owners.set(folder, pkg.id);
    }
    const files = (pkg.files || []).map(file => {
      checkPath(file.path);
      const parts = file.path.split('/');
      if (parts.length < 4 || parts[0] !== 'Interface' || parts[1] !== 'AddOns' || !folders.has(parts[2].toLowerCase())) throw new Error(`File outside its addon folders: ${file.path}`);
      if (!Number.isSafeInteger(file.size) || file.size < 0 || !SHA256.test(file.sha256)) throw new Error(`Invalid addon file: ${file.path}`);
      return { path: file.path, size: file.size, sha256: file.sha256 };
    });
    if (!files.length) throw new Error(`Addon ${pkg.id} has no files.`);
    const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
    return {
      id: pkg.id, name: text(pkg.name, 80) || pkg.id, description: text(pkg.description, 400), version: text(pkg.version, 40),
      category: text(pkg.category, 40) || 'Utility', author: text(pkg.author, 80), website: text(pkg.website, 300), recommended: pkg.recommended === true,
      folders: pkg.folders, dependencies: (pkg.dependencies || []).filter(dep => typeof dep === 'string'), files,
      bytes: files.reduce((sum, file) => sum + file.size, 0),
    };
  });
  for (const pkg of packages) for (const dep of pkg.dependencies) if (!ids.has(dep)) throw new Error(`${pkg.id} depends on unknown addon ${dep}.`);
  return { generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : '', packages, byId: new Map(packages.map(pkg => [pkg.id, pkg])), owners };
}

async function readToc(folder, name) {
  const entries = await fs.readdir(folder).catch(() => []);
  const toc = entries.find(entry => entry.toLowerCase() === `${name.toLowerCase()}.toc`) || entries.find(entry => entry.toLowerCase().endsWith('.toc'));
  if (!toc) return null;
  const text = await fs.readFile(path.join(folder, toc), 'utf8').catch(() => '');
  const meta = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^##\s*([^:]+):\s*(.*)$/.exec(line);
    if (match) meta[match[1].trim().toLowerCase()] = match[2].replace(/\|c[0-9a-f]{8}|\|r/gi, '').trim();
  }
  const deps = [meta.dependencies, meta.requireddeps, meta.dependancies].filter(Boolean).join(',').split(/[\s,;]+/).filter(Boolean);
  return { title: meta.title || name, version: meta.version || '', notes: meta.notes || '', dependencies: deps };
}

class AddonManager {
  constructor({ catalogUrl, publicKey, fetchImpl = fetch }) {
    this.url = catalogUrl ? new URL(catalogUrl) : null;
    this.key = publicKey;
    this.fetch = fetchImpl;
    this.cached = null;
  }

  async catalog(force = false) {
    if (!this.url) throw new Error('This realm does not publish an addon catalog.');
    if (!force && this.cached && Date.now() - this.cached.at < 5 * 60 * 1000) return this.cached.value;
    const { data, signed } = await fetchSigned(this.url, { key: this.key, fetchImpl: this.fetch, signal: AbortSignal.timeout(30000), maxBytes: 32 * 1024 * 1024 });
    const value = { ...validateCatalog(data), signed };
    this.cached = { at: Date.now(), value };
    return value;
  }

  meta(root, relative) { return safePath(root, `.coa-launcher/addons/${relative}`, { internal: true }); }
  addonsRoot(root) { return path.join(root, 'Interface', 'AddOns'); }
  async state(root) {
    const data = await readJson(await this.meta(root, STATE));
    return data?.schema === 1 && data.packages && typeof data.packages === 'object' ? data : { schema: 1, packages: {} };
  }

  async folderExists(root, folder) {
    const stat = await statOrNull(await safePath(root, `Interface/AddOns/${folder}`, { internal: true }));
    return !!stat?.isDirectory();
  }

  async packageStatus(root, pkg, owned) {
    const present = [];
    for (const folder of pkg.folders) if (await this.folderExists(root, folder)) present.push(folder);
    if (!owned) return present.length ? 'manual' : 'available';
    const ownedByPath = new Map(owned.files.map(file => [file.path.toLowerCase(), file]));
    let status = 'installed';
    for (const file of pkg.files) {
      const mine = ownedByPath.get(file.path.toLowerCase());
      const stat = await statOrNull(await safePath(root, file.path, { internal: true }));
      if (!stat) return 'repair';
      if (!mine || mine.sha256 !== file.sha256) status = 'update';
      else if (stat.size !== mine.size) return 'repair';
    }
    // A file the new version dropped is still on disk: the update will remove it.
    const current = new Set(pkg.files.map(file => file.path.toLowerCase()));
    if (owned.files.some(file => !current.has(file.path.toLowerCase()))) status = 'update';
    return status;
  }

  async list(root, force = false) {
    const catalog = await this.catalog(force);
    const state = root ? await this.state(root) : { packages: {} };
    const packages = [];
    for (const pkg of catalog.packages) {
      const owned = state.packages[pkg.id];
      const status = root ? await this.packageStatus(root, pkg, owned) : 'available';
      const { files, ...rest } = pkg;
      packages.push({ ...rest, fileCount: files.length, status, installedVersion: owned?.version || '' });
    }
    // Addons found in the folder that the catalog does not know.
    const others = [];
    if (root) {
      const entries = await fs.readdir(this.addonsRoot(root), { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() || /^Blizzard_/i.test(entry.name) || catalog.owners.has(entry.name.toLowerCase())) continue;
        const toc = await readToc(path.join(this.addonsRoot(root), entry.name), entry.name);
        if (toc) others.push({ folder: entry.name, title: toc.title, version: toc.version, notes: toc.notes });
      }
    }
    return { packages, others, signed: catalog.signed, generatedAt: catalog.generatedAt };
  }

  // Requested packages plus every missing dependency, dependencies first.
  async plan(root, ids) {
    const catalog = await this.catalog();
    const state = await this.state(root);
    const ordered = [];
    const seen = new Set();
    const visiting = new Set();
    const visit = async (id, requested) => {
      if (seen.has(id)) {
        // Met first as someone's dependency, then asked for explicitly: it must still be (re)installed.
        if (requested && !ordered.some(entry => entry.pkg.id === id)) ordered.push({ pkg: catalog.byId.get(id), status: 'installed' });
        return;
      }
      if (visiting.has(id)) throw new Error(`Addon dependency loop around ${id}.`);
      visiting.add(id);
      const pkg = catalog.byId.get(id);
      if (!pkg) throw new Error(`Unknown addon ${id}.`);
      for (const dep of pkg.dependencies) await visit(dep, false);
      visiting.delete(id);
      seen.add(id);
      const status = await this.packageStatus(root, pkg, state.packages[id]);
      if (requested || status !== 'installed') ordered.push({ pkg, status });
    };
    for (const id of ids) await visit(id, true);
    return ordered;
  }

  async install(root, ids, { replaceManual = false, signal = new AbortController().signal, onProgress = () => {} } = {}) {
    if (!root) throw new Error('Choose your game folder first.');
    const journal = new Journal(root, 'addons', { internalTargets: true });
    await journal.recover();
    const plan = await this.plan(root, ids);
    const manual = plan.filter(entry => entry.status === 'manual');
    if (manual.length && !replaceManual) {
      const error = new Error('Some addons are already installed by hand.');
      error.code = 'ADDON_MANUAL';
      error.folders = manual.flatMap(entry => entry.pkg.folders);
      throw error;
    }
    // Hand-installed copies are moved aside (never deleted) before the managed install.
    if (manual.length) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      for (const { pkg } of manual) {
        for (const folder of pkg.folders) {
          const source = await safePath(root, `Interface/AddOns/${folder}`, { internal: true });
          if (!(await statOrNull(source))) continue;
          const target = await this.meta(root, `replaced/${stamp}/${folder}`);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.rename(source, target);
        }
      }
    }
    const previous = await this.state(root);
    const next = structuredClone(previous);
    const changes = [];
    const cache = new Map();
    const needed = [];
    for (const { pkg } of plan) {
      const owned = new Map((previous.packages[pkg.id]?.files || []).map(file => [file.path.toLowerCase(), file]));
      for (const file of pkg.files) {
        const stat = await statOrNull(await safePath(root, file.path, { internal: true }));
        const mine = owned.get(file.path.toLowerCase());
        if (stat && mine && mine.sha256 === file.sha256 && stat.size === file.size) continue;
        needed.push(file);
        changes.push({ path: file.path, sha256: file.sha256 });
      }
      const names = new Set(pkg.files.map(file => file.path.toLowerCase()));
      for (const old of owned.values()) {
        if (names.has(old.path.toLowerCase())) continue;
        const target = await safePath(root, old.path, { internal: true });
        if ((await statOrNull(target)) && await hashFile(target) === old.sha256) changes.push({ path: old.path });
      }
      next.packages[pkg.id] = { version: pkg.version, files: pkg.files.map(({ path: p, size, sha256 }) => ({ path: p, size, sha256 })) };
    }
    const total = needed.reduce((sum, file) => sum + file.size, 0);
    let done = 0;
    for (const file of needed) {
      if (!cache.has(file.sha256)) {
        const destination = await this.meta(root, `cache/${file.sha256}`);
        await downloadObject({ url: new URL(`objects/${file.sha256}`, this.url), size: file.size, sha256: file.sha256, destination, signal, fetchImpl: this.fetch, onBytes: bytes => onProgress(done + bytes, total) });
        cache.set(file.sha256, destination);
      }
      done += file.size;
    }
    for (const change of changes) if (change.sha256) change.source = cache.get(change.sha256);
    const stateFile = await this.meta(root, STATE);
    await journal.apply(changes, { stateFile: STATE, previous, commit: () => atomicJson(stateFile, next) });
    for (const change of changes.filter(item => !item.source)) await removeEmptyParents(await safePath(root, change.path, { internal: true }), this.addonsRoot(root));
    await fs.rm(await this.meta(root, 'cache'), { recursive: true, force: true });
    return { installed: plan.map(entry => entry.pkg.id), replaced: manual.map(entry => entry.pkg.id) };
  }

  async uninstall(root, id) {
    const journal = new Journal(root, 'addons', { internalTargets: true });
    await journal.recover();
    const catalog = await this.catalog();
    const pkg = catalog.byId.get(id);
    const previous = await this.state(root);
    if (!pkg || !previous.packages[id]) throw new Error('This addon was not installed by the launcher; remove it by hand if you wish.');
    const blockers = [];
    for (const [otherId, owned] of Object.entries(previous.packages)) {
      if (otherId !== id && catalog.byId.get(otherId)?.dependencies.includes(id) && owned) blockers.push(catalog.byId.get(otherId).name);
    }
    const provided = new Set(pkg.folders.map(folder => folder.toLowerCase()));
    const entries = await fs.readdir(this.addonsRoot(root), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || provided.has(entry.name.toLowerCase()) || catalog.owners.has(entry.name.toLowerCase())) continue;
      const toc = await readToc(path.join(this.addonsRoot(root), entry.name), entry.name);
      if (toc?.dependencies.some(dep => provided.has(dep.toLowerCase()))) blockers.push(toc.title);
    }
    if (blockers.length) throw new Error(`${pkg.name} is required by ${[...new Set(blockers)].join(', ')}. Remove those first.`);
    const changes = [];
    let kept = 0;
    for (const file of previous.packages[id].files) {
      const target = await safePath(root, file.path, { internal: true });
      if (!(await statOrNull(target))) continue;
      if (await hashFile(target) !== file.sha256) { kept++; continue; }
      changes.push({ path: file.path });
    }
    const next = structuredClone(previous);
    delete next.packages[id];
    const stateFile = await this.meta(root, STATE);
    await journal.apply(changes, { stateFile: STATE, previous, commit: () => atomicJson(stateFile, next) });
    for (const change of changes) await removeEmptyParents(await safePath(root, change.path, { internal: true }), this.addonsRoot(root));
    return { removed: id, kept };
  }
}

module.exports = { AddonManager, validateCatalog, readToc };
