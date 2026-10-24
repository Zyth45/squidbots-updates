'use strict';
// Client patcher. The cycle is always: read the signed manifest -> compare with the folder
// -> report what is out of date -> (player clicks) download in parallel -> verify -> apply atomically.
const fs = require('node:fs/promises');
const path = require('node:path');
const { validateManifest, statOrNull, safePath, hashFile, atomicJson, readJson, seedRoot, RETIRED_FOLDER } = require('./release-format.cjs');
const { Journal } = require('./journal.cjs');
const { downloadObject } = require('./downloader.cjs');
const { fetchSigned } = require('./signing.cjs');

const PARALLEL = 4;
const STATE = 'state.json';

class ClientUpdater {
  constructor({ manifestUrl, requiredExecutable, publicKey, rules = 'client', area = 'client', fetchImpl = fetch, notify = () => {}, beforeApply = async () => {}, updatesOnly = false }) {
    this.rules = rules;
    this.area = area;
    this.url = new URL(manifestUrl);
    this.requiredExecutable = requiredExecutable;
    // A release of changed files only does not carry the executable: the folder must already have it.
    this.updatesOnly = updatesOnly;
    this.key = publicKey;
    this.fetch = fetchImpl;
    this.notify = notify;
    this.beforeApply = beforeApply;
    this.busy = false;
    this.status = { phase: 'idle', message: '' };
    this.lastEmit = 0;
  }

  emit(phase, message, extra = {}, force = true) {
    this.status = { phase, message, ...extra };
    const now = Date.now();
    if (force || now - this.lastEmit > 100) { this.lastEmit = now; this.notify(this.status); }
  }

  cancel() {
    if (this.status.phase !== 'applying') this.controller?.abort(new Error('Download paused. Click Update to resume where you stopped.'));
  }

  async exclusive(action, mode = 'update') {
    if (this.busy) throw new Error('A client operation is already running.');
    this.busy = true;
    this.mode = mode;
    this.controller = new AbortController();
    try { return await action(this.controller.signal); }
    catch (error) { this.emit(this.controller.signal.aborted ? 'paused' : 'error', error.message); throw error; }
    finally { this.busy = false; this.mode = ''; }
  }

  // Makes way for another operation: a running check is stopped (it can be run again at any time),
  // a running update is never interrupted.
  async idle(timeoutMs = 20000) {
    if (!this.busy) return;
    if (this.mode !== 'check') throw new Error('Wait for the current update to finish.');
    this.controller?.abort(new Error('Check interrupted.'));
    const deadline = Date.now() + timeoutMs;
    while (this.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    if (this.busy) throw new Error('Wait for the current operation to finish.');
  }

  // The latest release, read and verified without touching any folder or waiting for the lock.
  async peek() {
    const manifest = await this.manifest(AbortSignal.timeout(30000));
    const bytes = manifest.files.filter(file => !file.component).reduce((sum, file) => sum + (file.gz || file.size), 0);
    return { version: manifest.version, publishedAt: manifest.publishedAt, notes: manifest.notes, signed: manifest.signed, files: manifest.files.length, bytes };
  }

  meta(root, relative) { return safePath(root, `.coa-launcher/${this.area}/${relative}`, { internal: true }); }

  async manifest(signal) {
    const { data, signed } = await fetchSigned(this.url, { key: this.key, fetchImpl: this.fetch, signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), maxBytes: 64 * 1024 * 1024 });
    return { ...validateManifest(data, this.updatesOnly ? null : this.requiredExecutable, this.rules), signed };
  }

  // Which optional components the player wants; required files have no component.
  static selection(manifest, chosen) {
    const selected = new Set();
    for (const component of manifest.components) {
      const choice = chosen && Object.hasOwn(chosen, component.id) ? chosen[component.id] : component.default;
      if (choice) selected.add(component.id);
    }
    return selected;
  }

  async plan(root, manifest, { force = false, components }, signal) {
    await new Journal(root, this.area, { rules: this.rules }).recover();
    const previous = await readJson(await this.meta(root, STATE));
    // A download host replaying an older signed release must not roll the game back.
    if (previous?.publishedAt && (!manifest.publishedAt || manifest.publishedAt < previous.publishedAt)) {
      return { manifest, ahead: { version: previous.version, publishedAt: previous.publishedAt }, selected: [], changes: [], removals: [], kept: [], current: [], bytes: 0 };
    }
    const known = new Map((previous?.files || []).map(file => [file.path.toLowerCase(), file]));
    const retired = previous?.retired || [];
    const retire = [];
    for (const entry of manifest.retire || []) {
      if (retired.includes(entry.toLowerCase())) continue;
      const target = await safePath(root, entry, { internal: true }).catch(() => null);
      if (target && (await statOrNull(target))?.isDirectory()) retire.push(entry);
    }
    const selected = ClientUpdater.selection(manifest, components);
    const wanted = manifest.files.filter(file => !file.component || selected.has(file.component));
    const wantedKeys = new Set(wanted.map(file => file.path.toLowerCase()));
    const totalBytes = wanted.reduce((sum, file) => sum + file.size, 0);
    const changes = [];
    const current = [];
    let scanned = 0;
    let hashedBytes = 0;
    // A seed (the repack's starting database) is installed only into an install that has none yet.
    const seeded = new Map();
    const seedPresent = async folder => {
      if (!seeded.has(folder)) seeded.set(folder, await fs.readdir(folder).catch(() => null));
      return seeded.get(folder);
    };
    for (const file of wanted) {
      signal.throwIfAborted();
      const seed = file.preserve ? seedRoot(file.path, this.rules) : null;
      if (seed) {
        const entries = await seedPresent(path.join(root, ...seed.split('/')));
        if (entries && entries.length) { current.push({ ...file, mtimeMs: 0 }); scanned++; continue; }
      }
      const target = await safePath(root, file.path, { rules: this.rules, allowSeed: !!file.preserve });
      const stat = await statOrNull(target);
      const cached = known.get(file.path.toLowerCase());
      // Fast path: same size and timestamps as when we last verified this exact file.
      // A preserved file (configuration) that already exists belongs to the owner now.
      if (file.preserve && stat?.isFile()) { current.push({ ...file, mtimeMs: stat.mtimeMs }); scanned++; continue; }
      let ok = !force && stat?.isFile() && cached?.sha256 === file.sha256 && stat.size === file.size && cached.mtimeMs === stat.mtimeMs;
      if (!ok && stat?.isFile() && stat.size === file.size) {
        ok = await hashFile(target, signal, bytes => {
          hashedBytes += bytes;
          this.emit('checking', `Verifying ${file.path}`, { file: file.path, completed: scanned, total: wanted.length, bytes: hashedBytes, totalBytes }, false);
        }) === file.sha256;
      }
      if (!ok) changes.push(file);
      current.push({ ...file, mtimeMs: ok ? stat.mtimeMs : 0 });
      scanned++;
      this.emit('checking', `Checking ${file.path}`, { file: file.path, completed: scanned, total: wanted.length }, false);
    }
    // Files we installed before that the new release (or selection) no longer needs.
    const removals = [];
    const kept = [];
    for (const [key, file] of known) {
      if (wantedKeys.has(key) || file.preserve) continue;
      const target = await safePath(root, file.path, { rules: this.rules }).catch(() => null);
      const stat = target && await statOrNull(target);
      if (!stat) continue;
      if (stat.size === file.size && await hashFile(target, signal) === file.sha256) removals.push(file);
      else kept.push(file.path);
    }
    const local = new Map();
    for (const file of changes) {
      if (!file.alt || local.has(file.sha256)) continue;
      for (const alt of file.alt) {
        const candidate = await safePath(root, alt, { internal: true }).catch(() => null);
        const stat = candidate && await statOrNull(candidate);
        if (!stat?.isFile() || stat.size !== file.size) continue;
        this.emit('checking', `Verifying ${alt}`, { file: alt, completed: scanned, total: wanted.length }, false);
        if (await hashFile(candidate, signal) === file.sha256) { local.set(file.sha256, candidate); break; }
      }
    }
    // What travels: the compressed size when the release has one.
    const bytes = changes.filter(file => !local.has(file.sha256)).reduce((sum, file) => sum + (file.gz || file.size), 0);
    return { manifest, selected: [...selected], changes, removals, kept, current, retire, retired, local, bytes };
  }

  summary(plan) {
    const byFolder = new Map();
    for (const file of plan.changes) {
      const folder = file.path.includes('/') ? file.path.split('/')[0] : '(game folder)';
      const entry = byFolder.get(folder) || { folder, files: 0, bytes: 0 };
      entry.files++; entry.bytes += file.size;
      byFolder.set(folder, entry);
    }
    return {
      version: plan.manifest.version,
      publishedAt: plan.manifest.publishedAt,
      notes: plan.manifest.notes,
      signed: plan.manifest.signed,
      components: plan.manifest.components.map(component => ({ ...component, selected: plan.selected.includes(component.id) })),
      needsUpdate: plan.changes.length > 0 || plan.removals.length > 0 || (plan.retire || []).length > 0,
      retire: (plan.retire || []).map(entry => entry.split('/').pop()),
      // Files taken from the player's own folder instead of being downloaded.
      reused: plan.local ? plan.local.size : 0,
      // The installed release is newer than the one offered (left the test channel, or an old release replayed).
      ahead: plan.ahead ? plan.ahead.version : '',
      files: plan.changes.length,
      bytes: plan.bytes,
      removed: plan.removals.length,
      kept: plan.kept,
      folders: [...byFolder.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 12),
    };
  }

  check(root, options = {}) {
    return this.exclusive(async signal => {
      this.emit('checking', 'Looking for a client release…');
      const manifest = await this.manifest(signal);
      if (!root) {
        const bytes = manifest.files.filter(file => !file.component).reduce((sum, file) => sum + (file.gz || file.size), 0);
        this.emit('available', 'The game is ready to install.', { version: manifest.version });
        return { version: manifest.version, notes: manifest.notes, signed: manifest.signed, components: manifest.components, needsUpdate: true, files: manifest.files.length, bytes, removed: 0, kept: [], folders: [], fresh: true };
      }
      const plan = await this.plan(root, manifest, options, signal);
      const result = this.summary(plan);
      if (plan.ahead) {
        this.emit('ready', `Release ${plan.ahead.version} stays installed: it is newer than ${manifest.version}.`, { version: plan.ahead.version });
      } else if (!result.needsUpdate) {
        await atomicJson(await this.meta(root, STATE), { version: manifest.version, publishedAt: manifest.publishedAt, selected: plan.selected, files: plan.current, retired: plan.retired });
        this.emit('ready', 'Your game is up to date.', { version: manifest.version });
      } else {
        this.emit('available', `Update ${manifest.version} is available.`, { version: manifest.version, files: result.files, totalBytes: result.bytes });
      }
      return result;
    }, 'check');
  }

  update(root, options = {}) {
    return this.exclusive(async signal => {
      if (!root) throw new Error('Choose a folder for the game first.');
      await fs.mkdir(root, { recursive: true });
      await this.beforeApply();
      this.emit('checking', 'Preparing the update…');
      const manifest = await this.manifest(signal);
      const plan = await this.plan(root, manifest, options, signal);
      // Never go back to an older release: the newer one stays, as installed and as recorded.
      if (plan.ahead) { this.emit('ready', `Release ${plan.ahead.version} stays installed: it is newer than ${manifest.version}.`, { version: plan.ahead.version }); return this.summary(plan); }
      // Identical files share one object: download each object once, whatever the number of paths.
      const objects = new Map();
      const downloaded = new Map();
      for (const file of plan.changes) if (!objects.has(file.sha256)) objects.set(file.sha256, file);
      // Already in the folder (verified above): linked, or copied, instead of downloaded.
      for (const [sha256, candidate] of plan.local) {
        const destination = await this.meta(root, `downloads/${sha256}`);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.rm(destination, { force: true });
        try { await fs.link(candidate, destination); } catch { await fs.copyFile(candidate, destination); }
        downloaded.set(sha256, destination);
        objects.delete(sha256);
      }
      const totalBytes = [...objects.values()].reduce((sum, file) => sum + (file.gz || file.size), 0);
      const disk = await fs.statfs(root);
      const needed = totalBytes * 2 + 512 * 1024 ** 2;
      if (disk.bavail * disk.bsize < needed) throw new Error(`Not enough free space: ${(needed / 1024 ** 3).toFixed(1)} GB needed on this drive.`);

      // Download: several objects at once, one shared progress counter, speed and ETA.
      const progress = new Map();
      const started = Date.now();
      const report = file => {
        const bytes = [...progress.values()].reduce((sum, value) => sum + value, 0);
        const elapsed = Math.max(1, (Date.now() - started) / 1000);
        const speed = bytes / elapsed;
        this.emit('downloading', `Downloading ${file.path}`, { file: file.path, bytes, totalBytes, speed, eta: speed > 0 ? Math.round((totalBytes - bytes) / speed) : null, version: manifest.version }, false);
      };
      const queue = [...objects.values()];
      const worker = async () => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          const destination = await this.meta(root, `downloads/${file.sha256}`);
          await downloadObject({
            url: new URL(`objects/${file.sha256}`, this.url), size: file.size, gz: file.gz, sha256: file.sha256, destination, signal, fetchImpl: this.fetch,
            onBytes: bytes => { progress.set(file.sha256, bytes); report(file); },
          });
          downloaded.set(file.sha256, destination);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
      signal.throwIfAborted();
      await this.beforeApply();

      // Apply: the same object may back several paths, so only the last user moves it.
      const uses = new Map();
      for (const file of plan.changes) uses.set(file.sha256, (uses.get(file.sha256) || 0) + 1);
      const changes = plan.changes.map(file => {
        const left = uses.get(file.sha256) - 1;
        uses.set(file.sha256, left);
        return { path: file.path, source: downloaded.get(file.sha256), sha256: file.sha256, move: left === 0 };
      });
      for (const file of plan.removals) changes.push({ path: file.path });
      const stateFile = await this.meta(root, STATE);
      const previous = await readJson(stateFile);
      this.emit('applying', 'Installing verified files. Keep the launcher open.', { completed: 0, total: changes.length });
      await new Journal(root, this.area, { rules: this.rules }).apply(changes, {
        stateFile: STATE,
        previous,
        signal: undefined,
        onProgress: (_stage, done, total) => this.emit('applying', 'Installing verified files. Keep the launcher open.', { completed: done, total }, false),
        commit: async () => {
          const files = [];
          for (const file of plan.current) {
            const stat = await statOrNull(await safePath(root, file.path, { rules: this.rules, allowSeed: !!file.preserve }));
            files.push({ path: file.path, size: file.size, sha256: file.sha256, ...(file.component ? { component: file.component } : {}), ...(file.preserve ? { preserve: true } : {}), mtimeMs: stat?.mtimeMs || 0 });
          }
          await atomicJson(stateFile, { version: manifest.version, publishedAt: manifest.publishedAt, selected: plan.selected, files, retired: plan.retired });
        },
      });
      await fs.rm(await this.meta(root, 'downloads'), { recursive: true, force: true });
      if (plan.retire.length) await this.retireAddons(root, plan, stateFile);
      this.emit('ready', 'Your game is up to date. Ready to play!', { version: manifest.version });
      return { version: manifest.version, kept: plan.kept };
    });
  }

  // Old addon folders the release replaces: moved to "Retired addons" (never deleted), and recorded so a
  // player who puts one back later keeps it.
  async retireAddons(root, plan, stateFile) {
    for (const entry of plan.retire) {
      const name = entry.split('/').pop();
      const from = await safePath(root, entry, { internal: true });
      let to = await safePath(root, `${RETIRED_FOLDER}/${name}`, { internal: true });
      for (let n = 2; await statOrNull(to); n++) to = await safePath(root, `${RETIRED_FOLDER}/${name} (${n})`, { internal: true });
      await fs.mkdir(path.dirname(to), { recursive: true });
      if (await statOrNull(from)) await fs.rename(from, to);
    }
    const state = await readJson(stateFile);
    const retired = [...new Set([...(state?.retired || []), ...plan.retire.map(entry => entry.toLowerCase())])];
    await atomicJson(stateFile, { ...state, retired });
  }

  async installedState(root) {
    if (!root) return null;
    const state = await readJson(await this.meta(root, STATE)).catch(() => null);
    return state ? { version: state.version || '', publishedAt: state.publishedAt || '' } : null;
  }

  async installedVersion(root) {
    if (!root) return '';
    const state = await readJson(await this.meta(root, STATE)).catch(() => null);
    return state?.version || '';
  }
}

module.exports = { ClientUpdater };
