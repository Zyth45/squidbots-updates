'use strict';
// "Play": the game (install, update, repair, play), the realm address, and the addons. Plus settings.

function playState() {
  const { client, check } = App.state;
  const progress = client?.progress || {};
  if (BUSY.includes(progress.phase)) return { kind: 'busy', button: ['pause', t('play.pause', 'Pause')], action: 'client-pause' };
  // Most players already have the game: showing its folder is the main way in; a full install is the fallback.
  if (!client?.path) return { kind: 'none', button: ['folder', t('play.locateMain', 'Show my game folder')], action: 'client-locate' };
  if (!client.installed) return App.state.config.game.updatesOnly ? { kind: 'none', button: ['folder', t('play.locateMain', 'Show my game folder')], action: 'client-locate' } : { kind: 'missing', button: ['download', t('play.install', 'Install')], action: 'client-update' };
  if (check?.needsUpdate) return { kind: 'update', button: ['download', t('play.update', 'Update')], action: 'client-update' };
  if (client.running) return { kind: 'running', button: ['play', t('play.running', 'Playing…')], action: '' };
  return { kind: 'ready', button: ['play', t('play.play', 'Play')], action: 'play' };
}

function statusLine() {
  const { client, check } = App.state;
  const progress = client?.progress || {};
  if (BUSY.includes(progress.phase)) return progressText(progress);
  if (progress.phase === 'error' || progress.phase === 'paused') return translateError(progress.message || '');
  if (!client?.path) return t('play.noFolder', 'Already have the game? Show its folder: only the new and changed files are downloaded.');
  if (!client.installed) return App.state.config.game.updatesOnly ? t('play.noGameHere', 'This folder does not contain the game. Show the folder where it is installed.') : t('play.notInstalled', 'The game is not installed in this folder yet.');
  if (check?.needsUpdate) return t('play.updateAvailable', 'Update {version}: {files} files, {size}', { version: check.version, files: formatNumber(check.files), size: formatBytes(check.bytes) });
  if (check?.ahead) return t('play.ahead', 'Test release {version} kept: newer than the stable one', { version: check.ahead });
  return client.version ? t('play.upToDate', 'Up to date · release {version}', { version: client.version }) : t('play.readyShort', 'Ready to play');
}

const currentRealm = () => App.state.settings.realmlist || App.state.config.game.realmlists[0].address;

// On the Play page: where the game connects, and whether that server answers.
function realmBadge() {
  const realm = App.state.realm;
  const light = realm ? (realm.online ? 'on' : 'off') : 'unknown';
  const label = realm ? (realm.online ? t('play.realmOnline', 'Server online') : t('play.realmOffline', 'Server not answering')) : t('play.realmChecking', 'Checking the server…');
  return `<button class="realm-badge" data-action="settings" title="${esc(t('play.changeRealm', 'Change the server address in the settings'))}"><span class="light ${light}"></span><span><small>${esc(label)}</small><strong>${esc(currentRealm())}</strong></span>${icon('settings')}</button>`;
}

// In the settings: the realmlist written into the game before it starts.
function realmPicker() {
  const { config } = App.state;
  const current = currentRealm();
  const known = config.game.realmlists.some(item => item.address === current);
  const options = config.game.realmlists.map(item => `<option value="${esc(item.address)}" ${item.address === current ? 'selected' : ''}>${esc(item.name)} · ${esc(item.address)}</option>`).join('');
  return `<div class="field"><span>${esc(t('settings.realmlist', 'Server address (realmlist)'))}</span>
    <div class="realm-row"><select id="realmlist">${options}<option value="custom" ${known ? '' : 'selected'}>${esc(t('play.otherAddress', 'Other address…'))}</option></select>
    <input id="custom-realm" placeholder="play.example.org" value="${known ? '' : esc(current)}" ${known ? 'hidden' : ''} spellcheck="false"><button class="button ghost small" data-action="realm-save" ${known ? 'hidden' : ''} id="realm-save">${esc(t('common.save', 'Save'))}</button></div>
    <small>${esc(t('settings.realmlistHint', 'Written into realmlist.wtf and Config.wtf of the game each time it starts. 127.0.0.1 is the server on this PC.'))}</small></div>`;
}

function addonRow(pkg) {
  const labels = { installed: ['ok', t('addon.installed', 'Installed')], update: ['warn', t('addon.update', 'Update')], repair: ['warn', t('addon.repair', 'To repair')], manual: ['info', t('addon.manual', 'Installed by hand')], available: ['', ''] };
  const [kind, label] = labels[pkg.status] || labels.available;
  const primary = pkg.status === 'available' ? ['download', t('addon.install', 'Install')] : pkg.status === 'update' ? ['download', t('addon.doUpdate', 'Update')] : pkg.status === 'repair' ? ['refresh', t('addon.doRepair', 'Repair')] : pkg.status === 'manual' ? ['refresh', t('addon.takeOver', 'Manage it')] : null;
  const canWrite = App.state.client?.installed;
  return `<div class="addon"><div class="addon-text"><strong>${esc(pkg.name)}</strong><small>${esc(pkg.category || '')}${pkg.version ? ` · ${esc(pkg.version)}` : ''}</small><p>${esc(pkg.description || '')}</p></div>
    <div class="addon-side">${label ? `<span class="pill ${kind}">${esc(label)}</span>` : ''}
      ${['installed', 'update', 'repair'].includes(pkg.status) ? `<button class="button ghost small" data-action="addon-remove" data-id="${esc(pkg.id)}" ${canWrite ? '' : 'disabled'}>${esc(t('addon.uninstall', 'Uninstall'))}</button>` : ''}
      ${primary ? `<button class="button ${pkg.status === 'available' ? 'primary' : 'ghost'} small" data-action="addon-install" data-id="${esc(pkg.id)}" ${canWrite ? '' : 'disabled'}>${icon(primary[0])}${esc(primary[1])}</button>` : ''}</div></div>`;
}

function addonsPanel() {
  const { config, addons, addonQuery } = App.state;
  if (!config.game.hasAddons) return '';
  let body;
  if (!addons) body = skeleton(4);
  else if (addons.error) body = emptyState('warning', t('addon.unavailable', 'The addon catalog is unavailable'), addons.error);
  else {
    const query = addonQuery.toLowerCase();
    const shown = addons.packages.filter(pkg => !query || `${pkg.name} ${pkg.description} ${pkg.category}`.toLowerCase().includes(query));
    body = shown.length ? `<div class="addon-list">${shown.map(addonRow).join('')}</div>` : emptyState('search', t('addon.none', 'No addon matches'), '');
  }
  const updates = addons?.packages?.filter(pkg => pkg.status === 'update' || pkg.status === 'repair').length || 0;
  return `<section class="panel addons-panel">
    <header><h2>${icon('addons')}${esc(t('addon.title', 'Addons'))}</h2>
      <div class="button-row">${updates ? `<button class="button primary small" data-action="addons-update-all">${icon('download')}${esc(t('addon.updateAll', 'Update all ({n})', { n: updates }))}</button>` : ''}<button class="icon-button" data-action="addons-folder" title="${esc(t('addon.folder', 'Open the AddOns folder'))}">${icon('folder')}</button><button class="icon-button" data-action="addons-refresh" title="${esc(t('common.refresh', 'Refresh'))}">${icon('refresh')}</button></div></header>
    <label class="search">${icon('search')}<input id="addon-search" type="search" placeholder="${esc(t('addon.search', 'Search an addon…'))}" value="${esc(addonQuery)}"></label>
    <div id="addon-body">${body}</div>
  </section>`;
}

// Classic skin: big title and play button with the download size, the server and Discord on the right,
// the latest releases of the game, the server and the bots below. Drawn with our own art only.
function classicPlay() {
  const { config, client, check, news, updates } = App.state;
  const state = playState();
  const progress = client?.progress || {};
  const busy = BUSY.includes(progress.phase);
  const bar = busy ? progressBar(progress) : null;
  const size = state.kind === 'update' && check?.bytes !== undefined ? t('classic.size', 'Download size: {size}', { size: formatBytes(check.bytes) }) : state.kind === 'ready' ? t('classic.ready', 'Ready to play') : '';
  const menu = client?.path ? [
    ['client-check', t('play.check', 'Check for updates')], ['client-repair', t('play.repair', 'Scan and repair')], ['client-components', t('play.components', 'Optional components')],
    ['client-locate', t('play.changeFolder', 'Change folder')], ['client-folder', t('play.openFolder', 'Open the folder')],
  ] : [[config.game.updatesOnly ? 'base-client' : 'client-install', config.game.updatesOnly ? t('play.getGame', 'No game yet? Here is how to get it') : t('play.fullInstall', 'No game yet? Install it completely')]];
  const areaInfo = { client: ['play', t('classic.newsGame', 'Game')], server: ['layers', t('classic.newsServer', 'Server')], bots: ['bot', t('classic.newsBots', 'Bots')] };
  const cards = newsCards(news || []);
  return `<div class="page classic">
    <section class="hero classic-hero">
      <div class="classic-main">
        <h1>${esc(config.game.name)}</h1>
        <p class="status-line ${progress.phase === 'error' ? 'bad' : ''}" id="status-line">${esc(statusLine())}</p>
        ${busy ? `<div class="hero-progress">${bar.html}<span>${bar.pct === null ? '' : `${bar.pct}%`}</span></div>` : ''}
        <div class="split-button ${state.kind}">
          <button class="split-main" data-action="${state.action}" ${state.action ? '' : 'disabled'}>${icon(state.button[0])}<span><strong>${esc(state.button[1])}</strong>${size ? `<small>${esc(size)}</small>` : ''}</span></button>
          <button class="split-more" data-action="play-menu" aria-label="${esc(t('classic.more', 'More'))}">${icon('chevron')}</button>
          <div class="split-menu" id="play-menu" hidden>${menu.map(([action, label]) => `<button data-action="${action}">${esc(label)}</button>`).join('')}</div>
        </div>
        ${client?.path ? `<span class="chip classic-folder" title="${esc(client.path)}">${icon('folder')}<span>${esc(client.path)}</span></span>` : ''}
      </div>
      <aside class="classic-side">
        ${realmBadge()}
        ${config.server ? `<button class="side-card" data-tab="server">${icon('layers')}<span><strong>${esc(t('tab.server', 'Local server'))}</strong><small>${esc(updates.core || updates.bots ? t('updates.dot', 'A new version is available') : App.state.server?.version || t('classic.serverHint', 'Your own server, with the bots'))}</small></span>${updates.core || updates.bots ? '<i class="dot"></i>' : icon('next')}</button>` : ''}
        ${config.discord ? `<button class="side-card discord" data-action="discord">${icon('discord')}<span><strong>Discord</strong><small>${esc(t('classic.discord', 'Join the community'))}</small></span>${icon('next')}</button>` : ''}
      </aside>
    </section>
    ${cards ? `<section class="news-row"><h2>${esc(t('classic.news', 'Latest news'))}</h2><div class="news-grid">${cards}</div></section>` : ''}
  </div>`;
}

async function loadNews() {
  try { App.state.news = await App.api.news(); } catch { App.state.news = []; }
  if (isClassic()) App.refresh('play');
  if (App.state.tab === 'home') App.render();
}

App.pages.addons = {
  render() { return `<div class="page addons-page">${addonsPanel()}</div>`; },
  mount() { App.pages.play.mount(); },
};

App.pages.play = {
  render() {
    if (isClassic()) return classicPlay();
    const { config, client } = App.state;
    const state = playState();
    const progress = client?.progress || {};
    const busy = BUSY.includes(progress.phase);
    const bar = busy ? progressBar(progress) : null;
    return `<div class="page play">
      <section class="hero">
        <span class="eyebrow">${esc(t('play.eyebrow', 'Your game'))}</span>
        <h1>${esc(config.game.name)}</h1>
        <p class="status-line ${progress.phase === 'error' ? 'bad' : ''}" id="status-line">${esc(statusLine())}</p>
        ${busy ? `<div class="hero-progress">${bar.html}<span>${bar.pct === null ? '' : `${bar.pct}%`}</span></div>` : ''}
        <div class="play-row">
          <button class="big-button ${state.kind}" data-action="${state.action}" ${state.action ? '' : 'disabled'}>${icon(state.button[0])}<span>${esc(state.button[1])}</span></button>
          ${realmBadge()}
        </div>
        <div class="quick">
          ${client?.path ? `<span class="chip" title="${esc(client.path)}">${icon('folder')}<span>${esc(client.path)}</span></span><button class="link-button" data-action="client-locate">${esc(t('play.changeFolder', 'Change folder'))}</button>` : `<button class="link-button" data-action="${config.game.updatesOnly ? 'base-client' : 'client-install'}">${esc(config.game.updatesOnly ? t('play.getGame', 'No game yet? Here is how to get it') : t('play.fullInstall', 'No game yet? Install it completely'))}</button>`}
          ${client?.path ? `<button class="link-button" data-action="client-check" ${busy ? 'disabled' : ''}>${esc(t('play.check', 'Check for updates'))}</button><button class="link-button" data-action="client-repair" ${client.installed && !busy ? '' : 'disabled'}>${esc(t('play.repair', 'Scan and repair'))}</button><button class="link-button" data-action="client-components">${esc(t('play.components', 'Optional components'))}</button><button class="link-button" data-action="client-folder">${esc(t('play.openFolder', 'Open the folder'))}</button>` : ''}
        </div>
      </section>
      ${addonsPanel()}
    </div>`;
  },
  mount() {
    $('#addon-search')?.addEventListener('input', event => {
      App.state.addonQuery = event.target.value;
      const holder = document.createElement('div');
      holder.innerHTML = addonsPanel();
      $('#addon-body').replaceWith(holder.querySelector('#addon-body'));
    });
  },
};

async function saveRealm(address, button) {
  await guard(async () => {
    const saved = await App.api.saveSettings({ realmlist: address });
    if (saved.realmlist !== address) throw new Error(t('play.badAddress', 'This is not a valid server address.'));
    App.state.settings = saved;
    App.state.realm = null;
    toast(t('settings.realmSaved', 'The game will connect to {address}.', { address }), 'success');
    App.refresh('play');
    probeRealm();
  }, button);
}

async function probeRealm() {
  try { App.state.realm = await App.api.probeRealm(); } catch { App.state.realm = { online: false }; }
  const badge = $('.realm-badge');
  if (badge) badge.outerHTML = realmBadge();
}

// The realm picker lives in the settings dialog.
document.addEventListener('change', event => {
  if (event.target.id === 'realmlist') {
    const custom = event.target.value === 'custom';
    $('#custom-realm').hidden = !custom;
    $('#realm-save').hidden = !custom;
    if (custom) $('#custom-realm').focus();
    else saveRealm(event.target.value);
  }
});

async function loadAddons(force = false) {
  if (!App.state.config.game.hasAddons || App.state.addonsLoading) return;
  App.state.addonsLoading = true;
  try { App.state.addons = await App.api.addons(force); }
  catch (error) { App.state.addons = { error: translateError(error.message), packages: [] }; }
  App.state.addonsLoading = false;
  App.refresh('play');
}

async function checkClient(force = false, quiet = false) {
  const result = await App.api.checkClient(force);
  if (result.disabled) return result;
  App.state.check = result;
  if (!quiet && !result.needsUpdate) toast(t('play.upToDateToast', 'Your game is up to date.'), 'success');
  App.refresh('play');
  return result;
}

async function updateClient(force = false) {
  const check = App.state.client.installed ? (App.state.check || await checkClient(force, true)) : null;
  if (check && !check.needsUpdate && !force) { toast(t('play.upToDateToast', 'Your game is up to date.'), 'success'); return; }
  if (check) {
    const ok = await confirmDialog({
      title: force ? t('play.repairTitle', 'Repair the game?') : t('play.updateTitle', 'Install update {version}?', { version: check.version }),
      body: `${esc(t('play.updateBody', '{files} files ({size}) are downloaded, verified and installed. Your settings, addons and screenshots are not touched.', { files: formatNumber(check.files - (check.reused || 0)), size: formatBytes(check.bytes) }))}${check.reused ? `<p class="muted">${esc(t('play.reused', '{n} more already on this PC (a disabled copy): reused, not downloaded.', { n: formatNumber(check.reused) }))}</p>` : ''}${check.retire?.length ? `<p class="muted">${esc(t('play.retire', '{n} old addons of the base game are moved to "Retired addons" (not deleted): {names}', { n: check.retire.length, names: check.retire.slice(0, 6).join(', ') + (check.retire.length > 6 ? '…' : '') }))}</p>` : ''}${check.notes?.length ? `<ul class="notes">${check.notes.slice(0, 8).map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}`,
      confirm: t('play.apply', 'Download and install'),
    });
    if (!ok) return;
  }
  const result = await App.api.updateClient(force);
  App.state.client = result.client;
  App.state.check = { ...App.state.check, needsUpdate: false };
  if (result?.addonInstalled) { toast(t('bots.addonInstalled', '{name} is installed in your game.', { name: result.addonInstalled }), 'success'); loadAddons(); }
  toast(t('play.updated', 'The game is ready.'), 'success');
  App.refresh('play');
  loadAddons();
}

async function installAddons(ids) {
  let result;
  try { result = await App.api.installAddons(ids, false); }
  catch (error) {
    if (error.code !== 'ADDON_MANUAL') throw error;
    const ok = await confirmDialog({ title: t('addon.replaceTitle', 'Replace your own copy?'), body: esc(t('addon.replaceBody', 'These folders were installed by hand: {folders}. They are moved to .coa-launcher/addons/replaced so nothing is lost, then the tested version is installed.', { folders: error.folders.join(', ') })), confirm: t('addon.replace', 'Replace') });
    if (!ok) return;
    result = await App.api.installAddons(ids, true);
  }
  toast(t('addon.done', 'Addons installed.'), 'success');
  await loadAddons();
  return result;
}

function showComponents() {
  const check = App.state.check;
  if (!check?.components?.length) { toast(t('play.noComponents', 'This game has no optional components.')); return; }
  dialog.open(`${dialog.header(t('play.components', 'Optional components'))}<div class="dialog-content">${check.components.map(component => `<label class="toggle-row"><input type="checkbox" data-component="${esc(component.id)}" ${component.selected ?? component.default ? 'checked' : ''}><span><strong>${esc(component.name)}</strong><small>${esc(component.description)}</small></span></label>`).join('')}</div><footer class="dialog-foot"><button class="button ghost" data-action="dialog-close">${esc(t('common.cancel', 'Cancel'))}</button><button class="button primary" data-action="components-save">${esc(t('common.save', 'Save'))}</button></footer>`);
}

// ---------------------------------------------------------------- settings
function showSettings() {
  const { settings, version, launcherUpdate, config } = App.state;
  const lang = code => `<option value="${code}" ${settings.language === code ? 'selected' : ''}>${{ fr: 'Français', en: 'English', ru: 'Русский' }[code]}</option>`;
  const check = (id, key, label) => `<label class="check"><input type="checkbox" id="${id}" data-setting="${key}" ${settings[key] ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  const game = config.edition !== 'server';
  dialog.open(`${dialog.header(t('settings.title', 'Settings'))}<div class="dialog-content settings">
    ${game ? realmPicker() : ''}
    <div class="field"><span>${esc(t('settings.theme', 'Look'))}</span><select id="theme" data-setting="theme">${[['abyss', t('settings.themeAbyss', 'Abyss (deep water)')], ['classic', t('settings.themeClassic', 'Amber')]].map(([id, label]) => `<option value="${id}" ${settings.theme === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>
    ${config.hasTestChannel ? `<div class="field"><span>${esc(t('settings.channel', 'Versions'))}</span><select id="channel" data-setting="channel">${[['stable', t('settings.channelStable', 'Stable (recommended)')], ['test', t('settings.channelTest', 'Test (newest, may have bugs)')]].map(([id, label]) => `<option value="${id}" ${settings.channel === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select><small>${esc(t('settings.channelHint', 'Test gets new server, bot and game versions first. Going back to Stable never installs an older version: you stay on the test one until Stable catches up.'))}</small></div>` : ''}
    <div class="field"><span>${esc(t('settings.language', 'Language'))}</span><select id="language" data-setting="language">${['fr', 'en', 'ru'].map(lang).join('')}</select></div>
    ${game ? check('set-min', 'minimizeOnLaunch', t('settings.minimize', 'Minimize the launcher when the game starts')) : ''}
    ${check('set-motion', 'reduceMotion', t('settings.motion', 'Still background (no animation)'))}
    ${game ? check('set-addons', 'autoCheckAddons', t('settings.autoAddons', 'Look for addon updates at start')) : ''}
    ${game ? `<h3>${icon('shield')}${esc(t('settings.care', 'Your game settings'))}</h3>
    <div class="button-row"><button class="button ghost small" data-action="wtf-backup">${esc(t('settings.wtfBackup', 'Back up my settings'))}</button><button class="button ghost small" data-action="wtf-restore">${esc(t('settings.wtfRestore', 'Restore…'))}</button><button class="button ghost small" data-action="clear-cache">${esc(t('settings.clearCache', 'Empty the cache'))}</button></div>
    <p class="muted small">${esc(t('settings.wtfHint', 'WTF holds your settings, key bindings, macros and the addons\' saved data. It is copied before every update and addon install (10 copies kept).'))}</p>
    <div id="wtf-list"></div>` : ''}
    <h3>${icon('bug')}${esc(t('settings.support', 'Help'))}</h3>
    <p class="muted small">${esc(t('settings.supportHint', 'The support report gathers versions, server state and recent logs into one zip (passwords are removed). Drop it on the support Discord.'))}</p>
    <div class="button-row"><button class="button primary small" data-action="support-report">${icon('download')}${esc(t('settings.report', 'Create a support report'))}</button>${config.discord ? `<button class="button ghost small" data-action="discord">${icon('discord')}${esc(t('settings.discord', 'Open the Discord'))}</button>` : ''}</div>
    <h3>${icon('info')}${esc(t('settings.about', 'About'))}</h3>
    <p class="muted small">${esc(config.appName)} v${esc(version)} · ${esc(launcherUpdate?.message || t('settings.updatesAuto', 'Launcher updates are checked automatically.'))}</p>
    ${config.edition === 'server' ? `<div class="button-row"><button class="button ghost small" data-action="launcher-check">${icon('refresh')}${esc(t('settings.checkLauncher', 'Check for a launcher update'))}</button>${config.hasUpdates ? `<button class="button ghost small" data-action="update-check">${icon('refresh')}${esc(t('settings.checkRepack', 'Check for a repack and bots update'))}</button>` : ''}</div>` : ''}
    ${config.edition === 'server' && config.hasBeta ? `${check('set-beta', 'betaUpdates', t('settings.beta', 'Receive beta versions (testers)'))}<p class="muted small">${esc(t('settings.betaHint', 'Betas come before the stable version and may have bugs. Backup and undo work as usual. Unticking never installs an older version: you stay on the beta until the next stable one.'))}</p>` : ''}
    ${config.edition === 'server' ? `<p class="small"><button class="link-button" data-action="source-link" data-id="launcher">${icon('external')}${esc(t('modules.launcherSource', 'Open source launcher: source code on GitHub'))}</button></p>` : ''}
  </div>`, 'wide');
}

document.addEventListener('change', event => {
  const key = event.target.dataset?.setting;
  if (!key || !event.target.closest('#dialog')) return;
  const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  guard(async () => {
    App.state.settings = await App.api.saveSettings({ [key]: value });
    if (key === 'language') { await loadLocale(value); App.render(); showSettings(); }
    if (key === 'reduceMotion') Ocean.setStill(value);
    // The beta list is read (or left) at once: the home page shows what this changes.
    if (key === 'betaUpdates') App.api.updateRefresh().then(state => { if (state) App.state.update.state = state; }).catch(() => {});
    if (key === 'theme') { applyTheme(value); Ocean.setStill(App.state.settings.reduceMotion); App.render(); if (value === 'classic' && !App.state.news) loadNews(); }
    // Another channel: look again at the game, the server and the bots against the new addresses.
    if (key === 'channel') {
      Object.assign(App.state, { check: null, serverCheck: null, botsCheck: null, upgrade: null, updates: { core: null, bots: null } });
      toast(value === 'test' ? t('settings.onTest', 'Test channel: looking for the newest versions…') : t('settings.onStable', 'Stable channel.'), 'success');
      if (App.state.client?.installed) checkClient(false, true).catch(() => {});
      if (App.state.server?.installed) checkServer(false, true).catch(() => {});
      refreshUpdates();
    }
  });
});

Object.assign(App.actions, {
  settings: () => showSettings(),
  'play-menu': () => { const menu = $('#play-menu'); if (menu) menu.hidden = !menu.hidden; },
  // Updates-only launchers: the base game comes from the published link, then its folder is shown here.
  'base-client': () => {
    const { baseClient } = App.state.config.game;
    const steps = [t('base.step1', 'Download the game from the official link.'), t('base.step2', 'Unpack it where you like (for example C:\\Games\\CoA).'), t('base.step3', 'Come back here and show its folder: the launcher adds only what changed.')];
    dialog.open(`${dialog.header(t('base.title', 'Get the game'))}<div class="dialog-content">${baseClient?.note ? `<p class="muted">${esc(loc(baseClient.note))}</p>` : ''}<ol class="notes">${steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol></div><footer class="dialog-foot"><button class="button ghost" data-action="client-locate">${icon('folder')}${esc(t('base.have', 'I have it: show its folder'))}</button>${baseClient ? `<button class="button primary" data-action="base-client-open">${icon('download')}${esc(t('base.open', 'Open the download page'))}</button>` : ''}</footer>`);
  },
  'base-client-open': () => guard(() => App.api.openBaseClient()),
  play: button => guard(async () => { await App.api.launch(); App.state.client.running = true; App.refresh('play'); }, button),
  'client-install': button => guard(async () => { const info = await App.api.chooseInstall(); if (info) { App.state.client = info; App.state.check = null; App.refresh('play'); if (!info.installed) await updateClient(); else await checkClient(false, true); } }, button),
  // The usual start: an existing game folder is compared file by file, and only the difference is offered.
  'client-locate': button => guard(async () => {
    dialog.close();
    const info = await App.api.locateClient();
    if (!info) return;
    Object.assign(App.state, { client: info, check: null });
    App.refresh('play');
    loadAddons();
    const result = await checkClient(false, true);
    if (result?.needsUpdate) await updateClient();
    else if (result) toast(t('play.alreadyGood', 'Your game already matches the latest release: nothing to download.'), 'success');
  }, button),
  'client-update': button => guard(() => updateClient(false), button),
  'client-repair': button => guard(async () => { const result = await checkClient(true, true); if (result.needsUpdate) await updateClient(true); else toast(t('play.nothingToRepair', 'Every file checked: nothing to repair.'), 'success'); }, button),
  'client-check': button => guard(() => checkClient(false), button),
  'client-pause': () => App.api.pauseClient(),
  'client-components': button => guard(async () => { if (!App.state.check) await checkClient(false, true); showComponents(); }, button),
  'components-save': button => guard(async () => {
    await App.api.setComponents(Object.fromEntries($$('[data-component]').map(input => [input.dataset.component, input.checked])));
    dialog.close();
    await checkClient(false, true);
  }, button),
  'client-folder': () => guard(() => App.api.openClientFolder()),
  'addon-install': button => guard(() => installAddons([button.dataset.id]), button),
  'addon-remove': button => guard(async () => {
    const pkg = App.state.addons.packages.find(item => item.id === button.dataset.id);
    if (!await confirmDialog({ title: t('addon.removeTitle', 'Uninstall {name}?', { name: pkg.name }), body: esc(t('addon.removeBody', 'Files installed by the launcher are removed. Files you changed and your saved settings are kept.')), confirm: t('addon.uninstall', 'Uninstall'), danger: true })) return;
    await App.api.uninstallAddon(pkg.id);
    toast(t('addon.removed', 'Uninstalled.'), 'success');
    await loadAddons();
  }, button),
  'addons-update-all': button => guard(() => installAddons(App.state.addons.packages.filter(pkg => pkg.status === 'update' || pkg.status === 'repair').map(pkg => pkg.id)), button),
  'addons-refresh': button => guard(() => loadAddons(true), button),
  'addons-folder': () => guard(() => App.api.openAddonsFolder()),
  'wtf-backup': button => guard(async () => { const result = await App.api.backupGameSettings(); toast(t('settings.wtfSaved', 'Settings copied ({size}).', { size: formatBytes(result.size) }), 'success'); }, button),
  'wtf-restore': button => guard(async () => {
    const list = await App.api.settingsBackups();
    const when = id => { const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id); return m ? formatDate(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`, true) : id; };
    $('#wtf-list').innerHTML = list.length ? `<div class="history-list">${list.map(item => `<div class="history-row"><div><strong>${esc(when(item.id))}</strong><small>${esc(item.automatic ? t('settings.wtfAuto', 'automatic, before an update') : t('settings.wtfManual', 'made by you'))} · ${esc(formatBytes(item.size))}</small></div><button class="button ghost small" data-action="wtf-restore-one" data-id="${esc(item.id)}">${esc(t('common.restore', 'Restore'))}</button></div>`).join('')}</div>` : `<p class="muted small">${esc(t('settings.wtfNone', 'No copy yet.'))}</p>`;
  }, button),
  'wtf-restore-one': button => guard(async () => { await App.api.restoreGameSettings(button.dataset.id); $('#wtf-list').innerHTML = ''; toast(t('settings.wtfRestored', 'Settings put back. The ones you had are kept in a new copy.'), 'success'); }, button),
  'clear-cache': button => guard(async () => { const result = await App.api.clearGameCache(); toast(t('settings.cacheCleared', 'Cache emptied ({size} freed).', { size: formatBytes(result.freed) }), 'success'); }, button),
  'support-report': button => guard(async () => {
    const result = await App.api.supportReport();
    if (!result) return;
    toast(t('settings.reportSaved', 'Report saved ({size}). Drop it on the support Discord.', { size: formatBytes(result.size) }), 'success');
    if (result.discord) await App.api.openDiscord();
  }, button),
  discord: () => guard(() => App.api.openDiscord()),
  'realm-save': button => { const address = $('#custom-realm').value.trim(); if (address) saveRealm(address, button); },
});
