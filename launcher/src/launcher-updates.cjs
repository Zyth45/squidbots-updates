'use strict';
// Self-update through electron-updater: latest.yml + installer published by the realm owner.
// electron-updater only checks the installer against the SHA-512 in latest.yml, which comes from
// the same host. The launcher therefore also reads launcher.json, signed with the owner's Ed25519
// key, and installs only an installer whose SHA-512 and version match that signed file.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { publicKey, fetchSigned } = require('./signing.cjs');

async function sha512(file) {
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('base64');
}

function createLauncherUpdates(app, { feedUrl, key, fetchImpl }, notify, canRestart) {
  const trustKey = key ? publicKey(key) : null;
  let status;
  if (!app.isPackaged) status = { phase: 'development', message: 'Launcher updates run in the installed version only.' };
  else if (!feedUrl) status = { phase: 'disabled', message: 'Launcher updates are not configured.' };
  else if (!trustKey) status = { phase: 'disabled', message: 'Launcher updates need launcherUpdateKey in launcher.config.json.' };
  else status = { phase: 'idle', message: '' };
  const set = (phase, message, extra = {}) => { status = { phase, message, ...extra }; notify(status); };
  let updater = null;
  let checking = false;
  let signed = null;
  let downloaded = null;

  async function matchesSignature(info) {
    if (!signed || !info?.downloadedFile || info.version !== signed.version) return false;
    return (await sha512(info.downloadedFile)) === signed.sha512;
  }

  if (status.phase === 'idle') {
    updater = require('electron-updater').autoUpdater;
    updater.setFeedURL({ provider: 'generic', url: feedUrl });
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.on('checking-for-update', () => set('checking', 'Checking for a new launcher…'));
    updater.on('update-available', info => set('downloading', `Downloading launcher ${info.version}…`, { version: info.version, percent: 0 }));
    updater.on('download-progress', progress => set('downloading', 'Downloading the new launcher…', { percent: Math.round(progress.percent) }));
    updater.on('update-not-available', () => set('ready', 'Your launcher is up to date.'));
    updater.on('update-downloaded', info => {
      matchesSignature(info).then(ok => {
        if (!ok) { downloaded = null; set('error', 'The new launcher does not match its signature. It was not installed.'); return; }
        downloaded = info;
        set('downloaded', `Launcher ${info.version} is ready. Restart to install it.`, { version: info.version });
      }).catch(error => set('error', `Launcher update failed: ${error.message}`));
    });
    updater.on('error', error => set('error', `Launcher update failed: ${error.message}`));
  }

  return {
    get status() { return status; },
    async check() {
      if (!updater || checking || ['downloading', 'downloaded'].includes(status.phase)) return status;
      checking = true;
      try {
        const url = new URL('launcher.json', feedUrl.endsWith('/') ? feedUrl : `${feedUrl}/`);
        const result = await fetchSigned(url, { key: trustKey, fetchImpl, signal: AbortSignal.timeout(20000), maxBytes: 64 * 1024, redirect: 'follow' });
        const data = result.data;
        if (typeof data?.version !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(data.sha512 || '')) throw new Error('launcher.json is malformed.');
        signed = { version: data.version, sha512: data.sha512 };
        await updater.checkForUpdates();
      } catch (error) {
        set('error', `The launcher update server is unavailable (${error.message}).`);
      } finally { checking = false; }
      return status;
    },
    async install() {
      if (!updater || status.phase !== 'downloaded' || !downloaded) throw new Error('No launcher update is ready yet.');
      await canRestart();
      if (!(await matchesSignature(downloaded))) { set('error', 'The new launcher does not match its signature. It was not installed.'); throw new Error(status.message); }
      updater.quitAndInstall(false, true);
    },
  };
}

module.exports = { createLauncherUpdates, sha512 };
