'use strict';
// "Local server": the repack and its bots on this PC — services, installation and updates,
// backups, moving to a new version, and the bot settings that matter.

const SERVICE_STATE = {
  running: ['on', () => t('server.running', 'Running')],
  starting: ['busy', () => t('server.starting', 'Starting…')],
  stopping: ['busy', () => t('server.stopping', 'Stopping…')],
  stopped: ['off', () => t('server.stopped', 'Stopped')],
  foreign: ['busy', () => t('server.foreign', 'Port used by another program')],
  unknown: ['unknown', () => t('server.unknown', 'Unknown')],
};
const SRV_TABS = [['services', 'layers', 'srv.tab.services', 'Services'], ['install', 'download', 'srv.tab.install', 'Installation'], ['backups', 'database', 'srv.tab.backups', 'Backups'],['settings', 'settings', 'srv.tab.settings', 'Server settings']];
const UPGRADE_STEPS = [['stop', 'srv.step.stop', 'Stop the server'], ['install', 'srv.step.install', 'Install the new version'], ['prepare', 'srv.step.prepare', 'Create its database'], ['bots', 'srv.step.bots', 'Put the bots back'], ['migrate', 'srv.step.migrate', 'Copy accounts, characters and bots'], ['settings', 'srv.step.settings', 'Carry your settings over'], ['switch', 'srv.step.switch', 'Switch to the new version']];
const pendingKey = (file, key) => `${file}|${key}`;
const worldRunning = info => (info?.services || []).some(service => service.id === 'world' && service.state === 'running');

async function loadServer() {
  try { App.state.server = await App.api.serverInfo(); }
  catch (error) { App.state.server = { error: translateError(error.message) }; }
  App.refresh('server');
  loadServerTab();
}

function loadServerTab(force = false) {
  const s = App.state;
  if (!s.server?.path) return;
  if (s.srvTab === 'settings' && (force || !s.conf)) loadConf();
  if (s.srvTab === 'backups' && (force || !s.backups)) loadBackups();
  if (s.srvTab === 'modules' && (force || !s.modules)) loadModules();
  if (s.srvTab === 'upgrade' && (force || !s.upgrade)) loadUpgrade();
}

// ---------------------------------------------------------------- services
function servicesView(info) {
  const running = info.services.filter(service => service.state === 'running').length;
  const all = running === info.services.length;
  const any = info.services.some(service => !['stopped', 'unknown', 'foreign'].includes(service.state));
  // While something starts or stops, say so: "stopped" only when every service really is.
  const moving = info.services.find(service => service.state === 'starting' || service.state === 'stopping');
  const summary = moving
    ? `<div class="summary busy"><span class="light busy"></span><div><strong>${esc(moving.state === 'starting' ? t('server.startingAll', 'Starting the server…') : t('server.stoppingAll', 'Stopping the server…'))}</strong><small>${esc(t('server.keepOpen', 'Keep the launcher open until it is done.'))}</small></div></div>`
    : `<div class="summary ${all ? 'on' : running ? 'partial' : 'off'}"><span class="light ${all ? 'on' : running ? 'busy' : 'off'}"></span><div><strong>${esc(all ? t('server.allGood', 'Everything is running') : running ? t('server.partial', '{n} of {total} services running', { n: running, total: info.services.length }) : t('server.allStopped', 'The server is stopped'))}</strong><small>${esc(all ? t('server.allGoodHint', 'Set the server address to 127.0.0.1 and play.') : t('server.startHint', 'Start the services in order: database, login, world.'))}</small></div></div>`;
  const list = info.services.map(service => {
    const [kind, label] = SERVICE_STATE[service.state] || SERVICE_STATE.unknown;
    return `<div class="service"><span class="light ${kind}"></span><div class="service-text"><strong>${esc(service.name)}${service.variant ? ` <span class="pill info">${icon('bot')}${esc(service.variant)}</span>` : ''}</strong><small>${esc(label())} · ${esc(t('server.port', 'port {port}', { port: service.port }))}${service.other ? ` · ${esc(service.other)}` : ''}</small></div>
      <button class="button ghost small" data-action="service-log" data-id="${esc(service.id)}">${esc(t('server.log', 'Log'))}</button>
      ${service.state === 'running' ? `<button class="button ghost small" data-action="service-stop" data-id="${esc(service.id)}">${esc(t('server.stop', 'Stop'))}</button>` : `<button class="button ghost small" data-action="service-start" data-id="${esc(service.id)}" ${info.installed && service.state === 'stopped' ? '' : 'disabled'}>${esc(t('server.start', 'Start'))}</button>`}</div>`;
  }).join('');
  return `<div class="grid-2">
    <section class="panel" id="srv-services"><header><h2>${icon('layers')}${esc(t('server.services', 'Services'))}</h2><div class="button-row"><button class="button primary small" data-action="service-start-all" ${info.installed ? '' : 'disabled'}>${icon('play')}${esc(t('server.startAll', 'Start all'))}</button><button class="button ghost small" data-action="service-stop-all" ${any ? '' : 'disabled'}>${icon('pause')}${esc(t('server.stopAll', 'Stop all'))}</button></div></header>
      ${summary}<div class="service-list">${list}</div></section>
    <section class="panel"><header><h2>${icon('user')}${esc(t('server.account', 'Game account'))}</h2></header>
      <p class="muted">${esc(t('server.accountHint', 'Create the account you log in with on your own server. The worldserver must be running.'))}</p>
      <form id="game-account" class="form-grid"><input id="ga-name" maxlength="17" placeholder="${esc(t('server.accountName', 'Account name'))}" autocomplete="off"><input id="ga-password" type="password" maxlength="16" placeholder="${esc(t('server.password', 'Password'))}" autocomplete="new-password"><label class="check"><input type="checkbox" id="ga-gm"><span>${esc(t('server.gm', 'Game master'))}</span></label><button class="button primary small" type="submit" ${worldRunning(info) ? '' : 'disabled'}>${esc(t('server.create', 'Create'))}</button></form>
      ${info.bots?.installed && info.canPurgeBots ? `<div class="line-action">${icon('bot')}<span>${esc(t('server.purgeHint', 'Bots acting strangely after an update? Recreate them: your own characters stay.'))}</span><button class="button ghost small" data-action="purge-bots" ${worldRunning(info) ? 'disabled' : ''}>${esc(t('server.purge', 'Recreate the bots'))}</button>${worldRunning(info) ? `<small class="muted purge-stop">${esc(t('server.purgeStop', 'Stop the server first.'))}</small>` : ''}</div>` : ''}
    </section></div>`;
}

// ---------------------------------------------------------------- installation
// The repack comes from Jealous: the player downloads the zip, the launcher checks it and unpacks it.
function importView(info) {
  const server = App.state.config.server || {};
  const p = App.state.importProgress;
  const pct = p?.total ? Math.floor((100 * p.done) / p.total) : null;
  const working = p ? `<div class="hero-progress"><div class="progress${pct === null ? ' indeterminate' : ''}"><span data-pct="${pct ?? 30}"></span></div><span>${pct === null ? '' : `${pct}%`}</span></div><p class="muted small">${esc(p.phase === 'hash' ? t('import.hashing', 'Checking the zip…') : t('import.unpacking', 'Unpacking the repack… ({done}/{total} files)', { done: formatNumber(p.done), total: formatNumber(p.total) }))}</p>` : '';
  const source = loc(server.repackSource) || t('import.sourceDefault', 'the latest release of the CoA repack by Jealous (Proton link on Discord, #js-3067-server)');
  const repack = `<section class="panel" id="srv-repack"><header><h2>${icon('download')}${esc(t('server.repack', 'Server (repack)'))}</h2>${info.details?.release ? `<code>${esc(info.details.release)}</code>` : ''}</header>
    <p class="muted">${esc(info.installed ? (App.state.config.hasUpdates ? t('update.installedHint', 'Updates of the core, the bots and the addon come from the launcher in one click, with a backup: the card on the home page tells when one is out.') : t('import.installedHint', 'To move to a newer repack, import its zip: it goes into a new folder and this one stays as it is.')) : t('import.hint', 'Download {source}, then show the zip here: the launcher checks it, unpacks it and installs the bots.', { source }))}</p>
    <div class="folder-line">${icon('folder')}<span>${esc(info.path || t('server.noFolder', 'No folder chosen yet'))}</span><button class="button ghost small" data-action="server-choose">${esc(info.path ? t('common.change', 'Change') : t('server.chooseFolder', 'Choose a folder'))}</button>${info.path ? `<button class="icon-button" data-action="server-folder" title="${esc(t('play.openFolder', 'Open the folder'))}">${icon('external')}</button>` : ''}</div>
    ${working || `${!info.installed && info.bots ? `<label class="check with-bots"><input type="checkbox" id="with-bots" ${App.state.withBots === false ? '' : 'checked'}><span>${esc(t('server.withBots', 'Also install {name} (recommended)', { name: info.bots.name }))}</span></label>` : ''}
    <div class="button-row">${info.installed && App.state.config.hasUpdates ? `<button class="button primary" data-action="update-check">${icon('refresh')}${esc(t('update.check', 'Check for an update'))}</button>` : `<button class="button primary" data-action="repack-import">${icon('download')}${esc(info.installed ? t('import.newer', 'Import a newer repack (zip)') : t('import.button', 'Import the repack zip'))}</button>`}${!(info.installed && App.state.config.hasUpdates) && (server.repackSourceUrl || App.state.feed?.repack) ? `<button class="button ghost" data-action="repack-source">${icon('external')}${esc(t('import.where', 'Where to download it'))}</button>` : ''}${info.installed ? `<button class="button ghost" data-action="server-repair">${icon('shield')}${esc(t('play.repair', 'Scan and repair'))}</button>` : ''}</div>`}
  </section>`;
  return installTail(info, repack);
}

function installTail(info, repack) {
  const b = info.bots;
  const botsProgress = App.state.botsProgress || {};
  const botsBusy = BUSY.includes(botsProgress.phase) || b?.installing;
  const botsCheck = App.state.botsCheck;
  const bots = b ? `<section class="panel" id="srv-bots"><header><h2>${icon('bot')}${esc(b.name)}</h2>${b.installed ? `<code>${esc(b.version || '?')}</code>` : ''}</header>
    <p class="muted">${esc(loc(b.description))}</p>
    <div class="state-line">${b.installed ? `<span class="pill ok">${icon('check')}${esc(t('bots.installed', 'Installed'))}</span>${b.builtFor ? `<span class="pill">${esc(t('bots.builtFor', 'for {release}', { release: b.builtFor }))}</span>` : ''}` : `<span class="pill">${esc(t('bots.notInstalled', 'Not installed'))}</span>`}${botsCheck?.needsUpdate && !App.state.config.hasUpdates ? `<span class="pill warn">${esc(t('bots.update', 'Update {version}: {size}', { version: botsCheck.version, size: formatBytes(botsCheck.bytes) }))}</span>` : ''}</div>
    ${App.state.botsError && !b.installed && !botsBusy ? `<div class="conf-warn">${icon('warning')}<span>${esc(t('bots.failed', 'The bots were not installed: {reason}', { reason: App.state.botsError }))}</span></div>` : ''}
    ${botsBusy ? `<p class="muted small">${esc(BUSY.includes(botsProgress.phase) ? progressText(botsProgress) : t('bots.installing', 'The bot installer is preparing the database…'))}</p>` : ''}
    ${b.installed && App.state.config.hasUpdates ? `<p class="muted small">${icon('info')}${esc(t('bots.withUpdates', 'The bots are updated with the server (core, bots and addon in one update).'))}</p>` : `<div class="button-row"><button class="button ${b.installed && !botsCheck?.needsUpdate ? 'ghost' : 'primary'}" data-action="bots-install" ${info.installed && !botsBusy ? '' : 'disabled'}>${icon('download')}${esc(b.installed ? t('bots.reinstall', 'Update / repair the bots') : t('bots.install', 'Install the bots'))}</button>${b.installed ? `<button class="button ghost" data-action="bots-check" ${botsBusy ? 'disabled' : ''}>${icon('refresh')}${esc(t('play.check', 'Check for updates'))}</button>` : ''}</div>`}
    ${!info.installed ? `<p class="muted small">${icon('info')}${esc(t('bots.needsServer', 'Install the server first: the bots go on top of it.'))}</p>` : ''}
    ${App.state.upgradeLog.length && !App.state.upgradeRunning && App.state.srvTab === 'install' ? `<pre class="log" id="job-log">${esc(App.state.upgradeLog.join('\n'))}</pre>` : ''}
  </section>` : '';
  return `<div class="grid-2">${repack}${bots}</div>${info.installed ? `<div class="grid-2 bring-players">${bringPlayersView()}</div>` : ''}`;
}

function installView(info) {
  const progress = info.progress || {};
  const busy = BUSY.includes(progress.phase);
  const check = App.state.serverCheck;
  const bar = busy ? progressBar(progress) : null;
  if (!info.updatesEnabled) return importView(info);
  const repack = `<section class="panel" id="srv-repack"><header><h2>${icon('download')}${esc(t('server.repack', 'Server (repack)'))}</h2>${info.version ? `<code>${esc(info.version)}</code>` : ''}</header>
    <p class="muted">${esc(t('server.repackHint', 'The server files come from a signed release, like the game. Your database and your settings are never overwritten by an update.'))}</p>
    <div class="folder-line">${icon('folder')}<span>${esc(info.path || t('server.noFolder', 'No folder chosen yet'))}</span><button class="button ghost small" data-action="server-choose">${esc(info.path ? t('common.change', 'Change') : t('server.chooseFolder', 'Choose a folder'))}</button>${info.path ? `<button class="icon-button" data-action="server-folder" title="${esc(t('play.openFolder', 'Open the folder'))}">${icon('external')}</button>` : ''}</div>
    ${busy ? `<div class="hero-progress">${bar.html}<span>${bar.pct === null ? '' : `${bar.pct}%`}</span></div><p class="muted small">${esc(progressText(progress))}</p><button class="button ghost small" data-action="server-pause">${icon('pause')}${esc(t('play.pause', 'Pause'))}</button>`
      : `${!info.installed && info.bots ? `<label class="check with-bots"><input type="checkbox" id="with-bots" ${App.state.withBots === false ? '' : 'checked'}><span>${esc(t('server.withBots', 'Also install {name} (recommended)', { name: info.bots.name }))}</span></label>` : ''}<div class="state-line">${check ? (check.needsUpdate ? `<span class="pill warn">${esc(t('server.updateAvailable', 'Update {version}: {files} files, {size}', { version: check.version, files: formatNumber(check.files), size: formatBytes(check.bytes) }))}</span>` : check.ahead ? `<span class="pill info">${esc(t('server.ahead', 'Test release {version} kept (newer than stable)', { version: check.ahead }))}</span>` : `<span class="pill ok">${icon('check')}${esc(t('server.upToDate', 'Up to date'))}</span>`) : ''}${progress.phase === 'error' ? `<span class="pill bad">${esc(translateError(progress.message || ''))}</span>` : ''}</div>
      <div class="button-row"><button class="button ${!info.installed || check?.needsUpdate ? 'primary' : 'ghost'}" data-action="server-update" ${info.updatesEnabled && info.path ? '' : 'disabled'}>${icon('download')}${esc(info.installed ? t('server.update', 'Update') : t('server.install', 'Install the server'))}</button><button class="button ghost" data-action="server-check" ${info.updatesEnabled && info.installed ? '' : 'disabled'}>${icon('refresh')}${esc(t('play.check', 'Check for updates'))}</button><button class="button ghost" data-action="server-repair" ${info.installed ? '' : 'disabled'}>${icon('shield')}${esc(t('play.repair', 'Scan and repair'))}</button></div>`}
  </section>`;

  return installTail(info, repack);
}

// ---------------------------------------------------------------- backups
async function loadBackups() {
  try { App.state.backups = await App.api.backups(); }
  catch (error) { App.state.backups = { error: translateError(error.message) }; }
  App.refresh('server');
}

function backupsView() {
  const backups = App.state.backups;
  if (!backups) return skeleton(4);
  if (backups.error) return emptyState('warning', t('backup.error', 'Backups are unavailable'), backups.error);
  const task = App.state.task && ['backup', 'restore'].includes(App.state.task.phase) ? `<div class="task-line">${icon('refresh')}<span>${esc(taskText(App.state.task))}</span></div>` : '';
  return `<section class="panel"><header><h2>${icon('database')}${esc(t('backup.title', 'Database backups'))}</h2><div class="button-row"><button class="button ghost small" data-action="backup-folder">${icon('folder')}${esc(t('backup.folder', 'Folder'))}</button><button class="button primary small" data-action="backup-create">${icon('download')}${esc(t('backup.now', 'Back up now'))}</button></div></header>
    <p class="muted">${esc(t('backup.hint', 'Accounts, characters and bots, compressed, in the Backups folder of the server. One is also made before every restore and every new version.'))}</p>
    <label class="check"><input type="checkbox" id="backup-world"><span>${esc(t('backup.world', 'Also the world database (large, only if you changed it)'))}</span></label>
    ${task}
    ${backups.length ? `<div class="backup-list">${backups.map(item => `<div class="backup"><div><strong>${esc(formatDate(item.createdAt, true))}</strong><small>${esc(item.databases.map(name => name.replace('acore_', '')).join(', '))} · ${esc(formatBytes(item.size))}${item.reason === 'automatic' ? ` · ${esc(t('backup.auto', 'automatic'))}` : ''}${item.label ? ` · ${esc(item.label)}` : ''}</small></div><button class="button ghost small" data-action="backup-restore" data-name="${esc(item.name)}">${esc(t('common.restore', 'Restore'))}</button><button class="icon-button" data-action="backup-remove" data-name="${esc(item.name)}" title="${esc(t('common.remove', 'Remove'))}">${icon('close')}</button></div>`).join('')}</div>` : emptyState('database', t('backup.none', 'No backup yet'), t('backup.noneHint', 'Make one before changing anything important.'))}
  </section>`;
}

// ---------------------------------------------------------------- new version
async function loadUpgrade() {
  try {
    const [prepared, state] = await Promise.all([App.api.prepareUpgrade(), App.api.upgradeState()]);
    App.state.upgrade = prepared;
    App.state.upgradeRunning = state.running;
    if (state.log?.length) App.state.upgradeLog = state.log;
    if (!App.state.upgradeFolder) App.state.upgradeFolder = prepared.suggested;
  } catch (error) { App.state.upgrade = { error: translateError(error.message) }; }
  App.refresh('server');
}

function stepper() {
  const s = App.state;
  const done = s.upgradeStep === 'done';
  const failed = s.upgradeStep === 'failed';
  const steps = UPGRADE_STEPS.filter(([id]) => id !== 'bots' || s.server?.bots);
  const index = steps.findIndex(([id]) => id === (failed ? s.upgradeLastStep : s.upgradeStep));
  return `<ol class="stepper"${done || failed ? ` data-end="${done ? 'done' : 'failed'}"` : ''}>${steps.map(([, key, fallback], i) => `<li class="${done || i < index ? 'done' : i === index ? (failed ? 'failed' : 'active') : ''}"><i>${done || i < index ? icon('check') : i + 1}</i><span>${esc(t(key, fallback))}</span></li>`).join('')}</ol>`;
}

function upgradeView() {
  const s = App.state;
  const data = s.upgrade;
  if (!data) return skeleton(6);
  if (data.error) return emptyState('warning', t('upgrade.error', 'This panel is unavailable'), data.error);
  const release = data.release;
  const same = release?.version && data.current?.installed === release.version;
  const running = s.upgradeRunning;
  const wizard = `<section class="panel"><header><h2>${icon('refresh')}${esc(t('upgrade.title', 'Move to a new version'))}</h2></header>
    ${release?.error ? `<span class="pill bad">${esc(release.error)}</span>` : release?.version ? `<div class="state-line"><span class="pill ${same ? 'ok' : 'warn'}">${esc(same ? t('upgrade.latest', 'Latest version: {version}', { version: release.version }) : t('upgrade.new', 'New version {version} · {size}', { version: release.version, size: formatBytes(release.bytes) }))}</span>${data.botsRelease?.version ? `<span class="pill">${icon('bot')}${esc(data.botsRelease.version)}</span>` : ''}</div>` : `<p class="muted">${esc(t('upgrade.noRelease', 'No server release is published.'))}</p>`}
    <p class="muted">${esc(t('upgrade.how', 'The new version is installed in a folder of its own with a fresh database. The bots are put back, then your accounts, characters and bots are copied into it and your settings carried over. The current folder is not touched: it stays your way back.'))}</p>
    <div class="field"><span>${esc(t('upgrade.folder', 'Folder for the new version'))}</span><div class="field-inline"><input id="upgrade-folder" value="${esc(s.upgradeFolder || '')}" spellcheck="false"><button class="button ghost small" data-action="upgrade-pick">${icon('folder')}${esc(t('common.change', 'Change'))}</button></div></div>
    <label class="check"><input type="checkbox" id="upgrade-migrate" checked><span>${esc(t('upgrade.migrate', 'Copy accounts and characters'))}</span></label>
    ${s.server?.bots ? `<label class="check"><input type="checkbox" id="upgrade-bots" checked><span>${esc(t('upgrade.bots', 'Put the bots back and copy their data'))}</span></label>` : ''}
    <div class="button-row"><button class="button primary" data-action="upgrade-run" ${running || !release?.version || same ? 'disabled' : ''}>${icon('play')}${esc(t('upgrade.start', 'Start'))}</button>${running ? `<button class="button ghost" data-action="upgrade-cancel">${esc(t('common.cancel', 'Cancel'))}</button>` : ''}</div>
    ${s.upgradeStep && !['idle', 'check', 'migrate-only'].includes(s.upgradeStep) ? stepper() : ''}
    ${data.previous ? `<div class="line-action">${icon('refresh')}<span>${esc(t('upgrade.previous', 'Previous version kept in {path}', { path: data.previous.path }))}</span><button class="button ghost small" data-action="upgrade-revert" ${running ? 'disabled' : ''}>${esc(t('upgrade.revert', 'Go back to it'))}</button></div>` : ''}
  </section>`;
  const log = s.upgradeLog.length ? `<section class="panel"><header><h2>${icon('book')}${esc(t('upgrade.log', 'Journal'))}</h2>${running ? `<span class="pill warn">${esc(t('upgrade.running', 'in progress…'))}</span>` : ''}</header><pre class="log" id="upgrade-log">${esc(s.upgradeLog.join('\n'))}</pre></section>` : '';
  return `<div class="grid-2"><div class="stack">${wizard}${log}</div><div class="stack">${bringPlayersView()}</div></div>`;
}

// Bring the accounts, characters and bots of another repack into this server (in the Installation tab).
function bringPlayersView() {
  const s = App.state;
  const running = s.upgradeRunning;
  const old = s.oldRepack;
  const check = s.oldCheck;
  return `<section class="panel"><header><h2>${icon('user')}${esc(t('import.title', 'Bring players over from another repack'))}</h2></header>
    <p class="muted">${esc(t('bring.hint', 'A repack installed by hand? Copy its accounts, characters and bots into this server. The other folder is only read.'))}</p>
    <div class="button-row"><button class="button ghost" data-action="import-pick" ${running ? 'disabled' : ''}>${icon('folder')}${esc(old ? t('common.change', 'Change') : t('import.choose', 'Choose the old repack'))}</button></div>
    ${old ? `<p class="folder-line">${icon('folder')}<span>${esc(old.path)}</span>${old.repack ? `<code>${esc(old.release || '?')}</code>` : `<span class="pill bad">${esc(t('import.notRepack', 'Not a repack folder'))}</span>`}</p>
      ${check ? `<div class="facts-box">${check.old ? `<span>${esc(t('import.old', 'Old: {accounts} accounts, {characters} characters', check.old))}</span>` : ''}${check.new ? `<span>${esc(t('import.here', 'Here: {accounts} accounts, {characters} characters', check.new))}</span>` : ''}${check.clashes ? `<span class="pill bad">${esc(t('import.clashes', 'Some accounts exist in both: see the log.'))}</span>` : ''}</div>` : ''}
      <div class="button-row"><button class="button ghost" data-action="import-check" ${old.repack && !running ? '' : 'disabled'}>${icon('search')}${esc(t('import.check', 'Check (changes nothing)'))}</button><button class="button primary" data-action="import-run" ${old.repack && check && !check.clashes && !running ? '' : 'disabled'}>${esc(t('import.run', 'Copy into this server'))}</button></div>` : ''}
  </section>`;
}

function appendLog(line) {
  const s = App.state;
  s.upgradeLog.push(line);
  if (s.upgradeLog.length > 400) s.upgradeLog.shift();
  const pre = $('#upgrade-log') || $('#job-log');
  if (pre) { pre.textContent = s.upgradeLog.join('\n'); pre.scrollTop = pre.scrollHeight; }
}

// ---------------------------------------------------------------- bot settings
async function loadConf() {
  try { App.state.conf = await App.api.serverSettings(); }
  catch (error) { App.state.conf = { error: translateError(error.message) }; }
  App.refresh('server');
}

function confValue(setting) {
  const pending = App.state.pending[pendingKey(setting.file, setting.key)];
  return pending !== undefined ? pending.value : setting.value;
}

function warnings(key) {
  const conf = App.state.conf;
  return (conf.overrides || []).filter(rule => rule.warn.includes(key) && Object.entries(rule.if).every(([name, value]) => {
    const setting = conf.settings.find(item => item.key === name);
    return setting && String(confValue(setting)).trim() === value;
  })).map(rule => loc(rule.text));
}

function control(setting) {
  const value = confValue(setting);
  const attrs = `data-conf-file="${esc(setting.file)}" data-conf-key="${esc(setting.key)}" data-conf-kind="${esc(setting.kind)}"`;
  if (setting.kind === 'bool') return `<label class="switch"><input type="checkbox" ${attrs} ${String(value).trim() === '1' ? 'checked' : ''}><span></span></label>`;
  if (setting.kind === 'choice') return `<select ${attrs}>${setting.choices.map(choice => `<option value="${esc(choice.value)}" ${String(choice.value) === String(value).trim() ? 'selected' : ''}>${esc(loc(choice.label))}</option>`).join('')}</select>`;
  if (setting.kind === 'int' || setting.kind === 'float') return `<input class="num-input" type="number" ${setting.kind === 'float' ? 'step="any"' : 'step="1"'} value="${esc(value)}" ${attrs}>`;
  return `<input class="text-input" type="text" maxlength="400" value="${esc(value)}" ${attrs}>`;
}

// ---------------------------------------------------------------- modules
async function loadModules() {
  try { App.state.modules = await App.api.modulesStatus(); } catch (error) { App.state.modules = { error: translateError(error.message) }; }
  App.refresh('modules');
}

// The Modules tab of the top bar (second, so nobody misses it). Read again at each visit.
App.pages.modules = {
  render: () => `<div class="page classic"><div class="page-head"><p class="eyebrow">${esc(t('server.eyebrow', 'On this PC'))}</p><h1>${esc(t('tab.modules', 'Modules'))}</h1></div>${App.state.server?.path ? modulesView() : emptyState('addons', t('modules.noServer', 'No server yet'), t('modules.noServerText', 'Install or choose your server first.'))}</div>`,
  mount() { if (!App.state.modulesFresh && App.state.server?.path) { App.state.modulesFresh = true; loadModules(); } },
};

// The base races by id; an added race is shown by its number.
function raceName(id) {
  const names = { 1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf', 5: 'Undead', 6: 'Tauren', 7: 'Gnome', 8: 'Troll', 10: 'Blood Elf', 11: 'Draenei' };
  return names[Number(id)] ? t(`race.${id}`, names[Number(id)]) : t('race.added', 'race {id}', { id });
}

// Who made the module, and a link to its source code.
function moduleCredit(id, author) {
  return `<p class="module-credit">${esc(t('modules.by', 'By {author}', { author }))} · <button class="link-button" data-action="source-link" data-id="${id}">${icon('external')}${esc(t('modules.source', 'Source code'))}</button></p>`;
}

function moduleSwitch(action, on, disabled) {
  return `<button class="switch ${on ? 'on' : ''}" data-action="${action}" data-on="${on ? '1' : '0'}" ${disabled ? 'disabled' : ''} role="switch" aria-checked="${on}"><span></span></button>`;
}

function modulesView() {
  const m = App.state.modules;
  if (!m) return skeleton(4);
  if (m.error) return emptyState('warning', t('modules.error', 'The modules cannot be read'), m.error);
  const r = m.multirace;
  const stopFirst = m.worldRunning ? `<p class="muted small">${icon('info')}${esc(t('modules.stopFirst', 'Stop the server to switch a module: it is read when the server starts.'))}</p>` : '';
  const facts = [
    [r.core, r.core ? t('modules.coreYes', 'The core of this server knows the added races.') : t('modules.coreNo', 'The core of this server does not have the added races yet: a CoA Bots update will bring it.')],
    [r.dbc >= r.dbcNeeded, t('modules.dbc', 'Race data: {n} of {need} files in Data\\dbc_races.', { n: r.dbc, need: r.dbcNeeded })],
  ];
  const client = { yes: t('modules.clientYes', 'Your game has the race patch.'), partial: t('modules.clientPartial', 'Your game has only part of the race patch.'), no: t('modules.clientNo', 'Your game does not have the race patch.'), disabled: t('modules.clientDisabled', 'The race patch of your game is switched off (.disabled).'), unknown: t('modules.clientUnknown', 'Game folder not chosen yet (SquidBots addon card).') }[r.client.state];
  const clientAction = r.client.state === 'disabled' ? `<button class="button ghost small" data-action="modules-client" data-on="1">${esc(t('modules.clientOn', 'Switch it back on'))}</button>`
    : ['yes', 'partial'].includes(r.client.state) ? `<button class="button ghost small" data-action="modules-client" data-on="0">${esc(t('modules.clientOff', 'Switch it off in my game'))}</button>` : '';
  return `<div class="grid-2 modules">
    <section class="panel module-card"><header><h2>${icon('bot')}SquidBots</h2>${moduleSwitch('modules-squidbots', m.squidbots.enabled, m.worldRunning || !m.squidbots.installed)}</header>
      <p class="muted">${esc(t('modules.squidbotsText', 'The random bots and the group AI. Off, the server starts without them (your own characters are not changed).'))}</p>
      <p class="small">${esc(m.squidbots.installed ? (m.squidbots.enabled ? t('modules.squidbotsOn', 'On: the server starts with the bots.') : t('modules.squidbotsOff', 'Off: the server starts without the bots.')) : t('modules.squidbotsMissing', 'CoA Bots is not installed in this server.'))}</p>${stopFirst}
      ${moduleCredit('squidbots', 'SquidBots (Zyth45)')}
    </section>
    <section class="panel module-card"><header><h2>${icon('user')}Multirace</h2>${moduleSwitch('modules-multirace', r.enabled, m.worldRunning || (!r.enabled && (!r.core || r.dbc < r.dbcNeeded)))}</header>
      <p class="muted">${esc(t('modules.multiraceText', 'More playable races. Every player then needs the patched game client: a game without it crashes when it meets a character or a bot of an added race.'))}</p>
      <ul class="module-facts">${facts.map(([ok, text]) => `<li class="${ok ? 'ok' : 'bad'}">${icon(ok ? 'check' : 'warning')}<span>${esc(text)}</span></li>`).join('')}<li class="${r.client.state === 'yes' ? 'ok' : 'warn'}">${icon(r.client.state === 'yes' ? 'check' : 'info')}<span>${esc(client)}</span>${clientAction}</li></ul>
      <p class="small">${esc(r.enabled ? (r.bots ? t('modules.multiraceOnBots', 'On, bots included.') : t('modules.multiraceOn', 'On, players only.')) : t('modules.multiraceOff', 'Off.'))}</p>${stopFirst}
      ${moduleCredit('multirace', 'Ilusixn')}
    </section>
    <section class="panel module-card ${m.ahbot.available ? '' : 'soon'}"><header><h2>${icon('coin')}${esc(t('modules.ahbot', 'Auction house'))}</h2>${moduleSwitch('modules-ahbot', m.ahbot.enabled, m.worldRunning || !m.ahbot.available)}</header>
      <p class="muted">${esc(t('modules.ahbotText', 'An auctioneer fills the auction house with items to buy and buys what you sell. It has its own account, never removed when the bots are recreated.'))}</p>
      <p class="small">${esc(!m.ahbot.available ? t('modules.ahbotSoon', 'Available with CoA Bots 2.5.') : m.ahbot.enabled ? t('modules.ahbotOn', 'On (in game: .ahbot reload, .ahbot empty).') : t('modules.multiraceOff', 'Off.'))}</p>${m.ahbot.available ? stopFirst : ''}
      ${moduleCredit('ahbot', 'AzerothCore')}
    </section>
  </div>
  <p class="modules-foot">${esc(t('modules.foot', 'SquidBots Server is open source.'))} <button class="link-button" data-action="source-link" data-id="launcher">${icon('external')}${esc(t('modules.source', 'Source code'))}</button></p>`;
}

function settingsView() {
  const conf = App.state.conf;
  if (!conf) return skeleton(6);
  if (conf.error) return emptyState('warning', t('conf.error', 'The settings cannot be read'), conf.error);
  const count = Object.keys(App.state.pending).length;
  // The Lite version keeps the bot groups and the realm rates: the settings people actually change.
  const groups = conf.groups.filter(group => conf.settings.some(setting => setting.group === group.id));
  const bar = `<div class="conf-bar${count ? ' dirty' : ''}" id="conf-bar"><span>${esc(count ? t('conf.pending', '{n} unsaved change(s)', { n: count }) : t('conf.saved', 'Saved. A copy of each file is kept before any change.'))}</span><span class="spacer"></span><button class="button ghost small" data-action="conf-history">${esc(t('conf.history', 'History'))}</button>${count ? `<button class="button ghost small" data-action="conf-discard">${esc(t('conf.discard', 'Discard'))}</button><button class="button primary small" data-action="conf-save">${esc(t('common.save', 'Save'))}</button>${worldRunning(App.state.server) ? `<button class="button primary small" data-action="conf-save-restart">${esc(t('conf.saveRestart', 'Save and restart'))}</button>` : ''}` : ''}</div>`;
  const recipes = conf.recipes.length ? `<div class="recipes">${conf.recipes.map(recipe => `<button class="recipe" data-action="conf-recipe" data-id="${esc(recipe.id)}"><strong>${esc(loc(recipe.title))}</strong><small>${esc(loc(recipe.summary))}</small></button>`).join('')}</div>` : '';
  const body = groups.map(group => `<section class="conf-group"><h3>${icon(group.icon)}${esc(loc(group.label))}</h3>${conf.settings.filter(setting => setting.group === group.id).map(setting => {
    const warn = warnings(setting.key);
    const changed = App.state.pending[pendingKey(setting.file, setting.key)] !== undefined;
    return `<div class="conf-row${changed ? ' changed' : ''}"><div class="conf-label"><strong>${esc(loc(setting.label))}</strong><p>${esc(loc(setting.help))}</p><small class="when">${icon('refresh')}${esc(loc(conf.when?.[setting.when]))}</small><div class="conf-warn" data-warn="${esc(setting.key)}" ${warn.length ? '' : 'hidden'}>${icon('info')}<span>${esc(warn.join(' '))}</span></div></div><div class="conf-control">${control(setting)}</div></div>`;
  }).join('')}</section>`).join('');
  // The actions asked about most, above the settings.
  const info = App.state.server || {};
  const tools = `<div class="conf-tools">${info.bots?.installed && info.canPurgeBots ? `<div class="line-action">${icon('bot')}<span>${esc(t('conf.purgeHint', 'Recreate the random bots (after changing their number, classes or levels): your characters stay. The server must be stopped.'))}</span><button class="button ghost small" data-action="purge-bots" ${worldRunning(info) ? 'disabled' : ''}>${esc(t('server.purge', 'Recreate the bots'))}</button>${worldRunning(info) ? `<small class="muted purge-stop">${esc(t('server.purgeStop', 'Stop the server first.'))}</small>` : ''}</div>` : ''}<div class="line-action">${icon('book')}<span>${esc(t('conf.logsHint', 'The server logs (Server.log, errors, bots): the console scrolls too fast, these files keep everything.'))}</span><button class="button ghost small" data-action="open-logs">${esc(t('conf.openLogs', 'Open the logs'))}</button></div></div>`;
  return `${tools}${bar}${recipes}${body}`;
}

function patchConfBar() {
  const holder = document.createElement('div');
  holder.innerHTML = settingsView();
  $('#conf-bar')?.replaceWith(holder.querySelector('#conf-bar'));
  for (const element of $$('[data-warn]')) {
    const list = warnings(element.dataset.warn);
    element.hidden = !list.length;
    element.querySelector('span').textContent = list.join(' ');
  }
}

document.addEventListener('input', event => {
  const target = event.target;
  if (target.id === 'upgrade-folder') App.state.upgradeFolder = target.value;
  if (target.id === 'with-bots') App.state.withBots = target.checked;
  if (!target.dataset?.confKey) return;
  const { confFile: file, confKey: key, confKind: kind } = target.dataset;
  const value = target.type === 'checkbox' ? (target.checked ? '1' : '0') : target.value;
  const setting = App.state.conf.settings.find(item => item.file === file && item.key === key);
  const id = pendingKey(file, key);
  if (String(value).trim() === String(setting.value).trim()) delete App.state.pending[id];
  else App.state.pending[id] = { file, key, value, kind };
  target.closest('.conf-row')?.classList.toggle('changed', App.state.pending[id] !== undefined);
  patchConfBar();
});

// ---------------------------------------------------------------- page
App.pages.server = {
  render() {
    const s = App.state;
    const info = s.server;
    if (!info) return `<div class="page server">${skeleton(6)}</div>`;
    if (info.error) return `<div class="page server">${emptyState('warning', t('server.error', 'The server panel is unavailable'), info.error)}</div>`;
    if (!info.path && s.srvTab !== 'install') s.srvTab = 'install';
    const tabs = `<nav class="subtabs">${SRV_TABS.filter(([id]) => id !== 'settings' || info.path).map(([id, iconName, key, fallback]) => `<button class="subtab${s.srvTab === id ? ' active' : ''}" data-action="srv-tab" data-id="${id}" ${!info.path && id !== 'install' ? 'disabled' : ''}>${icon(iconName)}<span>${esc(t(key, fallback))}</span>${id === 'settings' && Object.keys(s.pending).length ? `<em>${Object.keys(s.pending).length}</em>` : ''}${(id === 'upgrade' && s.updates.core) || (id === 'install' && s.updates.bots) ? '<i class="dot"></i>' : ''}</button>`).join('')}</nav>`;
    const view = { services: servicesView, install: installView, backups: backupsView, upgrade: upgradeView, modules: modulesView, settings: settingsView }[s.srvTab];
    return `<div class="page server"><div class="page-head"><div><span class="eyebrow">${esc(t('server.eyebrow', 'On this PC'))}</span><h1>${esc(t('server.title', 'Local server'))}</h1></div></div>${updateBanner()}${tabs}<div class="srv-body">${view(info)}</div></div>`;
  },
  mount() { if (!App.state.server) loadServer(); },
};

// Says what is new and leads to the sub-tab that installs it.
function updateBanner() {
  const { core, bots } = App.state.updates;
  const rows = [];
  if (core) rows.push(`<div class="update-banner"><i class="dot"></i><span>${esc(t('updates.core', 'New server version available: {version}', { version: core }))}</span><button class="button primary small" data-action="srv-tab" data-id="upgrade">${esc(t('updates.see', 'See'))}</button></div>`);
  if (bots) rows.push(`<div class="update-banner"><i class="dot"></i><span>${esc(t('updates.bots', 'New bots version available: {version}', { version: bots }))}</span><button class="button primary small" data-action="srv-tab" data-id="install">${esc(t('updates.see', 'See'))}</button></div>`);
  return rows.join('');
}

// Live updates redraw only what changed, never a form being typed in.
function patchServer() {
  if (App.state.tab !== 'server' || $('#dialog').open) return;
  if (['services', 'install'].includes(App.state.srvTab) && !$('#ga-name:focus, #ga-password:focus')) App.refresh('server');
}

async function checkServer(force = false, quiet = false) {
  const result = await App.api.checkServer(force);
  if (result.disabled) return result;
  App.state.serverCheck = result;
  refreshUpdates();
  if (!quiet && !result.needsUpdate) toast(t('server.upToDate', 'Up to date'), 'success');
  App.refresh('server');
  return result;
}

async function updateServer(force = false) {
  const info = App.state.server;
  const check = await checkServer(force, true);
  if (!check.needsUpdate && info.installed) { toast(t('server.upToDate', 'Up to date'), 'success'); return; }
  const ok = await confirmDialog({
    title: info.installed ? t('server.updateTitle', 'Update the server to {version}?', { version: check.version }) : t('server.installTitle', 'Install the server {version}?', { version: check.version }),
    body: esc(t('server.updateBody', '{files} files ({size}) are downloaded, verified and installed. Your database and settings are kept.', { files: formatNumber(check.files), size: formatBytes(check.bytes) })),
    confirm: t('play.apply', 'Download and install'),
  });
  if (!ok) return;
  // A first install brings the bots too unless the player unticked them.
  const withBots = !info.installed && info.bots && App.state.withBots !== false;
  App.state.server = await App.api.updateServer(force);
  App.state.serverCheck = { ...check, needsUpdate: false };
  refreshUpdates();
  toast(t('server.updated', 'Server files are ready.'), 'success');
  App.refresh('server');
  App.state.verify = null;
  if (withBots && App.state.server.installed && !App.state.server.bots?.installed) {
    try { await installBotsNow(); }
    catch (error) { App.state.botsError = translateError(error.message); App.refresh('server'); throw error; }
  }
}

async function installBotsNow() {
  App.state.upgradeLog = [];
  App.state.botsError = '';
  App.state.server.bots.installing = true;
  App.refresh('server');
  try { App.state.server = await App.api.installBots(); }
  finally { if (App.state.server.bots) App.state.server.bots.installing = false; }
  App.state.botsCheck = null;
  refreshUpdates();
  if (App.state.server.addonInstalled) { toast(t('bots.addonInstalled', '{name} is installed in your game.', { name: App.state.server.addonInstalled }), 'success'); loadAddons(); }
  toast(t('bots.done', 'The bots are ready. Start the server to meet them.'), 'success');
  App.refresh('server');
  if (App.state.verify && typeof runVerify === 'function') runVerify(false);
}

document.addEventListener('submit', event => {
  if (event.target.id !== 'game-account') return;
  event.preventDefault();
  const button = event.target.querySelector('[type=submit]');
  guard(async () => {
    const name = $('#ga-name').value.trim();
    const output = await App.api.createGameAccount(name, $('#ga-password').value, $('#ga-gm').checked);
    $('#ga-password').value = '';
    toast(output || t('server.accountCreated', 'Account {name} created.', { name: name.toUpperCase() }), 'success');
  }, button);
});

Object.assign(App.actions, {
  'srv-tab': button => guard(async () => {
    const s = App.state;
    if (s.srvTab === 'settings' && button.dataset.id !== 'settings' && Object.keys(s.pending).length && !(await confirmDialog({ title: t('conf.unsaved', 'Unsaved changes'), body: esc(t('conf.unsavedBody', 'Discard the changes that are not saved?')), confirm: t('conf.discard', 'Discard'), danger: true }))) return;
    if (button.dataset.id !== 'settings') s.pending = {};
    s.srvTab = button.dataset.id;
    if (s.tab !== 'server') App.go('server'); else App.refresh('server');
    loadServerTab(true);
  }),
  'service-start': button => guard(async () => { App.state.server = await App.api.startService(button.dataset.id); App.refresh('server'); probeRealm(); }, button),
  'service-stop': button => guard(async () => { App.state.server = await App.api.stopService(button.dataset.id); App.refresh('server'); }, button),
  'service-start-all': button => guard(async () => { App.state.server = await App.api.startService('all'); App.refresh('server'); toast(t('server.allGood', 'Everything is running'), 'success'); probeRealm(); }, button),
  'service-stop-all': button => guard(async () => { App.state.server = await App.api.stopService('all'); App.refresh('server'); }, button),
  'service-log': button => guard(async () => {
    const text = await App.api.serviceLog(button.dataset.id);
    dialog.open(`${dialog.header(t('server.logOf', 'Log: {name}', { name: button.dataset.id }))}<div class="dialog-content"><pre class="log">${esc(text || t('server.noLog', 'Nothing logged yet.'))}</pre></div>`, 'wide');
    const pre = $('#dialog .log');
    if (pre) pre.scrollTop = pre.scrollHeight;
  }, button),
  'modules-squidbots': button => guard(async () => {
    App.state.modules = await App.api.modulesSquidbots(button.dataset.on !== '1');
    App.state.server = await App.api.serverInfo().catch(() => App.state.server);
    App.render();
  }, button),
  'modules-multirace': button => guard(async () => {
    const on = button.dataset.on !== '1';
    let body;
    // The repack's own switch says first what it would do (nothing written): the characters that change race.
    const plan = await App.api.modulesMultiracePlan(on).catch(() => null);
    const moved = plan?.characters || [];
    const back = plan?.restored || [];
    const list = items => `<ul class="notes small">${items.slice(0, 12).map(item => `<li>${esc(item)}</li>`).join('')}${items.length > 12 ? `<li>… +${items.length - 12}</li>` : ''}</ul>`;
    if (on) {
      body = esc(t('modules.onBody', 'The added races are switched on and the random bots recreated with every race at the next start (a few minutes). Every player needs the patched game client, or their game crashes when it meets an added race.'));
      if (back.length) body += ` <strong>${esc(t('modules.onPlayers', '{n} character(s) of players get their race and look back.', { n: back.length }))}</strong>${list(back.map(item => item.name))}`;
    } else if (plan) {
      body = esc(t('modules.offBodyScript', 'The added races are switched off and the random bots recreated without them at the next start.'));
      if (moved.length) body += ` <strong>${esc(t('modules.offMoved', '{n} character(s) of players change race (a base race of their side) and choose their look at their next login. Their race comes back when Multirace is switched on again.', { n: moved.length }))}</strong>${list(moved.map(item => `${item.name}: ${raceName(item.from)} → ${raceName(item.to)}`))}`;
    } else {
      const count = await App.api.modulesCustomCharacters();
      body = esc(t('modules.offBody', 'The added races are switched off and the random bots recreated without them at the next start. Characters of players are never changed.'))
        + (count ? ` <strong>${esc(t('modules.offPlayers', '{n} character(s) of players use an added race: they cannot log in while Multirace is off.', { n: count }))}</strong>` : '');
    }
    if (!await confirmDialog({ title: on ? t('modules.onTitle', 'Switch Multirace on?') : t('modules.offTitle', 'Switch Multirace off?'), body, confirm: on ? t('modules.on', 'Switch on') : t('modules.off', 'Switch off'), danger: !on })) return;
    toast(t('modules.working', 'Switching… the random bots are being recreated.'));
    App.state.modules = await App.api.modulesMultirace({ on, bots: true });
    toast(on ? t('modules.onDone', 'Multirace is on. Start the server: the bots are recreated with every race.') : t('modules.offDone', 'Multirace is off. Start the server: the bots are recreated without the added races.'), 'success');
    App.render();
  }, button),
  'source-link': button => guard(() => App.api.openSource(button.dataset.id)),
  'modules-ahbot': button => guard(async () => {
    App.state.modules = await App.api.modulesAhbot(button.dataset.on !== '1');
    toast(t('modules.restartNeeded', 'Saved: it applies at the next start of the server.'), 'success');
    App.render();
  }, button),
  'modules-client': button => guard(async () => {
    const on = button.dataset.on === '1';
    if (!on && !await confirmDialog({ title: t('modules.clientOffTitle', 'Switch the race patch off in your game?'), body: esc(t('modules.clientOffBody', 'Its files are renamed to .disabled (nothing is deleted). Do it to play on a server without the added races; switch it back on at any time.')) + `<br><small class="muted">${esc((App.state.modules?.multirace?.client?.active || []).join(', '))}</small>`, confirm: t('modules.clientOff', 'Switch it off in my game') })) return;
    App.state.modules = await App.api.modulesClientPatch(on);
    App.render();
  }, button),
  'open-logs': button => guard(() => App.api.openLogs(), button),
  'purge-bots': button => guard(async () => {
    if (!await confirmDialog({ title: t('server.purgeTitle', 'Recreate the random bots?'), body: esc(t('server.purgeBody', 'Every random bot is deleted and created again at the next start. Your own characters are not touched.')), confirm: t('server.purge', 'Recreate the bots'), danger: true })) return;
    await App.api.purgeBots();
    toast(t('server.purged', 'Random bots deleted. They come back at the next start.'), 'success');
  }, button),
  'server-choose': button => guard(async () => { const info = await App.api.chooseServer(); if (info) { Object.assign(App.state, { server: info, serverCheck: null, botsCheck: null, conf: null, backups: null, upgrade: null, verify: null, network: null, botsError: '', pending: {} }); App.refresh('server'); if (info.installed) checkServer(false, true).catch(() => {}); } }, button),
  'server-folder': () => guard(() => App.api.openServerFolder()),
  'server-update': button => guard(() => updateServer(false), button),
  'server-check': button => guard(() => checkServer(false), button),
  'server-repair': button => guard(async () => { const result = await checkServer(true, true); if (result.needsUpdate) await updateServer(true); else toast(t('play.nothingToRepair', 'Every file checked: nothing to repair.'), 'success'); }, button),
  'server-pause': () => App.api.pauseServer(),
  'bots-check': button => guard(async () => { App.state.botsCheck = await App.api.checkBots(false); refreshUpdates(); if (!App.state.botsCheck.needsUpdate) toast(t('server.upToDate', 'Up to date'), 'success'); App.refresh('server'); }, button),
  'repack-source': button => guard(() => App.api.openRepackSource(), button),
  'repack-import': button => guard(async () => {
    const before = App.state.server;
    const pick = await App.api.importPick();
    if (!pick) return;
    if (pick.missing.length) {
      dialog.open(`${dialog.header(t('import.notFull', 'This zip is not a full repack'))}<div class="dialog-content"><p>${esc(pick.update ? t('import.isUpdate', '{name} looks like an update zip. Take the full repack zip (with Core, mysql, Scripts and Settings).', { name: pick.name }) : t('import.missing', 'Missing in {name}: {files}.', { name: pick.name, files: pick.missing.join(', ') }))}</p></div>`, 'small');
      return;
    }
    const verdict = pick.known
      ? `<div class="check ok"><span class="check-light"></span><div><strong>${esc(t('import.known', 'Genuine release: {name}', { name: pick.known.name || pick.known.release }))}</strong><small>${esc(pick.known.notes || '')}</small></div></div>`
      : `<div class="check warn"><span class="check-light"></span><div><strong>${esc(pick.listed ? t('import.unknown', 'This zip is not in the list of known releases') : t('import.noList', 'The list of known releases could not be read'))}</strong><small>${esc(t('import.unknownHint', 'It may be newer than the list, or modified. It is unpacked anyway and the Verification page checks it.'))}</small></div></div>`;
    const ok = await confirmDialog({
      title: t('import.confirmTitle', 'Import {name}?', { name: pick.name }),
      body: `${verdict}<p>${esc(t('import.confirmBody', '{files} files ({size}). {where}', { files: formatNumber(pick.entries), size: formatBytes(pick.size), where: pick.target ? t('import.into', 'Unpacked into {path}.', { path: pick.target }) : t('import.chooseFolder', 'Next, choose an empty folder for it.') }))}</p>`,
      confirm: t('import.go', 'Import'),
    });
    if (!ok) return;
    const info = await App.api.importRun();
    App.state.importProgress = null;
    if (!info) return;
    Object.assign(App.state, { server: info, serverCheck: null, botsCheck: null, conf: null, backups: null, upgrade: null, verify: null, network: null, botsError: '', pending: {} });
    toast(t('import.done', 'Repack ready in {path}.', { path: info.path }), 'success');
    App.refresh('server');
    refreshUpdates();
    const withBots = info.bots && !info.bots.installed && App.state.withBots !== false;
    if (withBots) {
      try { await installBotsNow(); }
      catch (error) { App.state.botsError = translateError(error.message); App.refresh('server'); throw error; }
    }
    // Moving from an older server: its players can be brought over.
    if (before?.installed && before.path !== info.path) toast(t('import.bringPlayers', 'Your previous server is kept. To bring its players: Management > Installation > Bring players over from another repack.'));
  }, button),
  'bots-install': button => guard(async () => {
    const b = App.state.server.bots;
    // The bot installer needs the worldserver stopped: offer to stop the server, and start it again after.
    const running = worldRunning(App.state.server);
    if (!await confirmDialog({
      title: b.installed ? t('bots.reinstallTitle', 'Update the bots?') : t('bots.installTitle', 'Install {name}?', { name: b.name }),
      body: esc(running ? t('bots.installRunning', 'The server is running: it is stopped first, the bots are updated, then the server starts again. Players online are disconnected for a few minutes. Your bot settings are kept.') : t('bots.installBody2', 'The installer of the bots shipped with the repack prepares the bot database. The worldserver must be stopped. Your bot settings are kept.')),
      confirm: running ? t('bots.stopAndGo', 'Stop the server and update') : t('bots.go', 'Go'),
    })) return;
    if (running) {
      toast(t('server.stoppingAll', 'Stopping the server…'));
      App.state.server = await App.api.stopService('all');
      App.refresh('server');
    }
    await installBotsNow();
    if (running) {
      toast(t('bots.restarting', 'Bots updated: starting the server again…'));
      App.state.server = await App.api.startService('all');
      App.refresh('server');
      toast(t('server.allGood', 'Everything is running'), 'success');
    }
  }, button),
  'backup-create': button => guard(async () => { const meta = await App.api.createBackup({ includeWorld: $('#backup-world')?.checked === true }); App.state.task = null; toast(t('backup.done', 'Backup saved ({size}).', { size: formatBytes(meta.size) }), 'success'); await loadBackups(); }, button),
  'backup-restore': button => guard(async () => {
    if (!await confirmDialog({ title: t('backup.restoreTitle', 'Restore this backup?'), body: esc(t('backup.restoreBody', 'Accounts, characters and bots go back to this date. Stop the worldserver first. The current state is saved just before.')), confirm: t('common.restore', 'Restore'), danger: true })) return;
    const result = await App.api.restoreBackup(button.dataset.name);
    App.state.task = null;
    toast(t('backup.restored', 'Backup restored. The state before is in {name}.', { name: result.safety }), 'success');
    await loadBackups();
  }, button),
  'backup-remove': button => guard(async () => {
    if (!await confirmDialog({ title: t('backup.removeTitle', 'Delete this backup?'), body: esc(button.dataset.name), confirm: t('common.remove', 'Remove'), danger: true })) return;
    await App.api.removeBackup(button.dataset.name);
    await loadBackups();
  }, button),
  'backup-folder': () => guard(() => App.api.openBackupsFolder()),
  'upgrade-pick': button => guard(async () => { const found = await App.api.chooseUpgradeFolder('new'); if (found) { App.state.upgradeFolder = found.path; App.refresh('server'); } }, button),
  'upgrade-run': button => guard(async () => {
    const s = App.state;
    const folder = ($('#upgrade-folder')?.value || '').trim();
    if (!folder) { toast(t('upgrade.chooseFolder', 'Choose a folder for the new version.')); return; }
    const options = { folder, migrate: $('#upgrade-migrate')?.checked !== false, bots: $('#upgrade-bots') ? $('#upgrade-bots').checked : false };
    if (!await confirmDialog({ title: t('upgrade.confirmTitle', 'Move to {version}?', { version: s.upgrade.release.version }), body: esc(t('upgrade.confirmBody', 'The server stops, the new version ({size}) is installed in {folder}, then your players are copied into it. Your current folder stays as it is.', { size: formatBytes(s.upgrade.release.bytes), folder })), confirm: t('upgrade.start', 'Start') })) return;
    s.upgradeLog = [];
    s.upgradeRunning = true;
    App.refresh('server');
    const result = await App.api.runUpgrade(options);
    Object.assign(s, { server: result.info, serverCheck: null, botsCheck: null, upgrade: null, upgradeFolder: '', conf: null, backups: null, verify: null, network: null });
    for (const warning of result.warnings) appendLog(`! ${warning}`);
    toast(t('upgrade.done', 'Done. Start the server to play on the new version.'), 'success');
    refreshUpdates();
    await loadUpgrade();
  }, button),
  'upgrade-cancel': () => guard(() => App.api.cancelUpgrade()),
  'upgrade-revert': button => guard(async () => {
    if (!await confirmDialog({ title: t('upgrade.revertTitle', 'Go back to the previous version?'), body: esc(t('upgrade.revertBody', 'The launcher uses the previous folder again, with its database as it was before the move. What players did since then stays in the new folder.')), confirm: t('upgrade.revert', 'Go back to it') })) return;
    Object.assign(App.state, { server: await App.api.revertUpgrade(), serverCheck: null, upgrade: null, conf: null, backups: null, verify: null, network: null });
    toast(t('upgrade.reverted', 'Back on the previous version.'), 'success');
    refreshUpdates();
    await loadUpgrade();
  }, button),
  'import-pick': button => guard(async () => { const found = await App.api.chooseUpgradeFolder('old'); if (found) { App.state.oldRepack = found; App.state.oldCheck = null; App.refresh('server'); } }, button),
  'import-check': button => guard(async () => { App.state.upgradeLog = []; const result = await App.api.migrateFrom({ from: App.state.oldRepack.path, check: true }); App.state.oldCheck = result.summary; App.refresh('server'); }, button),
  'import-run': button => guard(async () => {
    const replacing = App.state.oldCheck?.new?.characters > 0;
    if (!await confirmDialog({ title: t('import.confirmTitle', 'Copy the players of the old server?'), body: esc(replacing ? t('import.replace', 'This server already has {n} characters: they are REPLACED by the old ones (a backup is made first).', { n: App.state.oldCheck.new.characters }) : t('import.body', 'Accounts, characters and bots are copied into this server. A backup of this server is made first.')), confirm: t('import.run', 'Copy into this server'), danger: replacing })) return;
    App.state.upgradeLog = [];
    const result = await App.api.migrateFrom({ from: App.state.oldRepack.path, force: replacing });
    toast(t('import.done', 'Done: {accounts} accounts, {characters} characters.', { accounts: result.summary.result?.accounts ?? '?', characters: result.summary.result?.characters ?? '?' }), 'success');
    App.state.oldCheck = null;
    App.refresh('server');
  }, button),
  'conf-save': button => guard(() => saveConf(false), button),
  'conf-save-restart': button => guard(() => saveConf(true), button),
  'conf-discard': () => { App.state.pending = {}; App.refresh('server'); },
  'conf-history': button => guard(async () => {
    const list = await App.api.serverSettingsBackups();
    const when = id => { const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id); return m ? formatDate(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`, true) : id; };
    dialog.open(`${dialog.header(t('conf.history', 'History'), t('conf.historySub', 'A copy of each file is kept before every change'))}<div class="dialog-content">${list.length ? `<div class="history-list">${list.map(item => `<div class="history-row"><div><strong>${esc(when(item.id))}</strong><small>${esc(item.files.map(file => file.split('/').pop()).join(', '))}</small></div><button class="button ghost small" data-action="conf-restore" data-id="${esc(item.id)}">${esc(t('conf.putBack', 'Put back'))}</button></div>`).join('')}</div>` : emptyState('book', t('conf.noHistory', 'No change yet'), '')}</div>`, 'wide');
  }, button),
  'conf-restore': button => guard(async () => { await App.api.restoreServerSettings(button.dataset.id); dialog.close(); App.state.pending = {}; toast(t('conf.restored', 'Settings put back. They apply at the next start.'), 'success'); await loadConf(); }, button),
  'conf-recipe': button => {
    const recipe = App.state.conf.recipes.find(item => item.id === button.dataset.id);
    for (const [key, value] of Object.entries(recipe.changes)) {
      const setting = App.state.conf.settings.find(item => item.key === key);
      if (String(setting.value).trim() === value) delete App.state.pending[pendingKey(setting.file, key)];
      else App.state.pending[pendingKey(setting.file, key)] = { file: setting.file, key, value, kind: setting.kind };
    }
    App.refresh('server');
    toast(t('conf.prepared', '"{name}" prepared: check the values, then save.', { name: loc(recipe.title) }));
  },
});

async function saveConf(restart) {
  const result = await App.api.saveServerSettings(Object.values(App.state.pending));
  App.state.pending = {};
  toast(result.written.length ? t('conf.savedFiles', 'Saved in {files}.', { files: result.written.join(', ') }) : t('conf.nothing', 'Nothing changed.'), 'success');
  if (restart) {
    App.state.server = await App.api.stopService('all');
    App.state.server = await App.api.startService('all');
    toast(t('conf.restarted', 'The server restarted with the new settings.'), 'success');
  }
  await loadConf();
}
