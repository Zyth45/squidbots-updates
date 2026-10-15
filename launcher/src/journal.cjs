'use strict';
// Crash-safe file replacement used by the client patcher and the addon manager.
// Every new file is staged and verified first; the journal records what is about to change,
// originals are kept as backups until the new state is committed, and an interrupted run
// (power loss, crash, kill) is rolled back the next time the launcher touches the folder.
const fs = require('node:fs/promises');
const path = require('node:path');
const { safePath, statOrNull, hashFile, atomicJson, readJson } = require('./release-format.cjs');

const ignoreMissing = error => { if (error.code !== 'ENOENT') throw error; };

class Journal {
  constructor(root, area, { internalTargets = false, rules = 'client' } = {}) {
    this.root = root;
    this.area = area;
    this.internalTargets = internalTargets;
    this.rules = rules;
  }

  meta(relative) { return safePath(this.root, `.coa-launcher/${this.area}/${relative}`, { internal: true }); }
  target(relative) { return safePath(this.root, relative, { internal: this.internalTargets, rules: this.rules, allowSeed: true }); }

  async recover() {
    const journalFile = await this.meta('journal.json');
    const journal = await readJson(journalFile);
    if (!journal) return;
    if (!Array.isArray(journal.entries) || !['applying', 'committed'].includes(journal.phase)) {
      throw new Error('The launcher recovery record is damaged. Do not modify this folder and ask for help on Discord.');
    }
    if (journal.phase === 'applying') {
      for (let i = journal.entries.length - 1; i >= 0; i--) {
        const entry = journal.entries[i];
        const target = await this.target(entry.path);
        const backup = await this.meta(`backup/${i}`);
        if (await statOrNull(backup)) {
          await fs.unlink(target).catch(ignoreMissing);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.rename(backup, target);
        } else if (!entry.existed && !entry.remove && !(await statOrNull(await this.meta(`stage/${i}`)))) {
          await fs.unlink(target).catch(ignoreMissing);
        }
      }
      if (journal.stateFile) {
        const stateFile = await this.meta(journal.stateFile);
        if (journal.previous === null) await fs.unlink(stateFile).catch(ignoreMissing);
        else await atomicJson(stateFile, journal.previous);
      }
    }
    for (let i = 0; i < journal.entries.length; i++) {
      for (const kind of ['backup', 'stage']) await fs.unlink(await this.meta(`${kind}/${i}`)).catch(ignoreMissing);
    }
    await fs.unlink(journalFile);
  }

  // changes: [{ path, source?, sha256?, move? }] - without source the target is removed.
  async apply(changes, { stateFile, previous, commit, signal, onProgress }) {
    await this.recover();
    const entries = [];
    for (let i = 0; i < changes.length; i++) {
      signal?.throwIfAborted();
      const change = changes[i];
      const target = await this.target(change.path);
      if (change.source) {
        const stage = await this.meta(`stage/${i}`);
        await fs.mkdir(path.dirname(stage), { recursive: true });
        await fs.unlink(stage).catch(ignoreMissing);
        if (change.move) {
          try { await fs.rename(change.source, stage); }
          catch (error) { if (error.code !== 'EXDEV') throw error; await fs.copyFile(change.source, stage); }
        } else {
          await fs.copyFile(change.source, stage);
        }
        if (change.sha256 && await hashFile(stage, signal) !== change.sha256) throw new Error(`Staged file failed verification: ${change.path}`);
      }
      entries.push({ path: change.path, existed: !!(await statOrNull(target)), remove: !change.source });
      onProgress?.('staging', i + 1, changes.length);
    }
    const journalFile = await this.meta('journal.json');
    await atomicJson(journalFile, { phase: 'applying', stateFile, previous: previous ?? null, entries });
    try {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const target = await this.target(entry.path);
        if (entry.existed) {
          const backup = await this.meta(`backup/${i}`);
          await fs.mkdir(path.dirname(backup), { recursive: true });
          await fs.rename(target, backup);
        }
        if (!entry.remove) {
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.rename(await this.meta(`stage/${i}`), target);
        }
        onProgress?.('applying', i + 1, entries.length);
      }
      await commit();
      await atomicJson(journalFile, { phase: 'committed', stateFile, previous: previous ?? null, entries });
    } catch (error) {
      await this.recover();
      throw error;
    }
    await this.recover();
    return entries;
  }
}

module.exports = { Journal };
