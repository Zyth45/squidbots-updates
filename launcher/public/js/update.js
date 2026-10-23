'use strict';
// Update of the repack (core, CoA Bots, addon, dashboard) from the squidbots-updates releases.
// The main process downloads the signed package and runs its own tool (coa_update.py); this page shows where it
// is, and when it stops, one plain sentence: what happened, whether anything was changed, what to do.

// The steps shown to the player, in order. The tool's own step lines are matched to them.
const UPDATE_STEPS = [
  ['download', 'download', 'Download'],
  ['unpack', 'folder', 'Unpacking the files'],
  ['check', 'shield', 'Checks'],
  ['backup', 'folder', 'Backup'],
  ['files', 'layers', 'New files'],
  ['bots', 'bot', 'Bots and settings'],
  ['test', 'play', 'Test start'],
];
const TOOL_STEPS = [[/^Checks/, 'check'], [/^Backup/, 'backup'], [/^Files/, 'files'], [/^CoA Bots installer/, 'bots'], [/^Test start/, 'test'], [/installed\.$/, 'done'], [/^Undo/, 'undo'], [/put back as it was/, 'done']];

// Error codes of coa_update.py (and of the launcher's own part): a title, whether the repack was changed, what to do.
const UPDATE_ERRORS = {
  download: ['update.err.download', 'The update could not be downloaded. Check your internet connection, then try again.', 'none'],
  unpack: ['update.err.unpack', 'The update could not be unpacked (disk full, or an antivirus blocked a file). Free some space or allow the launcher, then try again.', 'none'],
  launcher: ['update.err.launcher', 'The launcher could not run the update.', 'none'],
  10: ['update.err.10', 'This folder is not a complete CoA repack (Start_All_Server.bat, Core, mysql…). Choose the right server folder.', 'none'],
  11: ['update.err.11', 'This update does not take the version of your repack. Install the full CoA Bots 2.0 repack first.', 'none'],
  12: ['update.err.12', 'A server file of your repack was changed by hand (worldserver.exe). Put back the original file, then try again.', 'none'],
  13: ['update.err.13', 'The server could not be stopped. Stop it on the home page (or close the programs of the repack), then try again.', 'none'],
  16: ['update.err.16', 'The folder path is too long for Windows. Move the repack to a short folder such as C:\\Games\\CoA-Repack.', 'none'],
  20: ['update.err.20', 'The update package is damaged (an antivirus may have removed a file). Try again: it will be downloaded again.', 'none'],
  21: ['update.err.21', 'An update is already running for this server in another window. Let it finish.', 'none'],
  30: ['update.err.30', 'The backup could not be made (often: not enough disk space).', 'none'],
  40: ['update.err.40', 'The update failed and your server was put back exactly as it was. Nothing is lost.', 'restored'],
  41: ['update.err.41', 'The update failed and putting the server back failed too. Do not start the server: undo it again, or send the report to the support.', 'broken'],
  49: ['update.err.49', 'Unexpected error during the update.', 'unknown'],
  50: ['update.err.50', 'The update is installed but the server did not start. Your backup is intact: undo the update, or send the report to the support.', 'changed'],
  60: ['update.err.60', 'The undo could not finish. Your backup is intact: try the undo again.', 'unknown'],
};
const CHANGED_TEXT = {
  none: ['update.changed.none', 'Nothing was changed on your server.'],
  restored: ['update.changed.restored', 'Your server is as it was before the update.'],
  changed: ['update.changed.changed', 'The new version is installed, the backup made just before is kept.'],
  broken: ['update.changed.broken', 'Your server is in between two versions.'],
  unknown: ['update.changed.unknown', 'Check the state below before starting the server.'],
};

App.state.update = { state: null, run: null };

function updateStepOf(text) { return TOOL_STEPS.find(([pattern]) => pattern.test(text || ''))?.[1] || null; }

// Live events of the run: the step, the download and file progress, the last line.
function onUpdateEvent(event) {
  const run = App.state.update.run || (App.state.update.run = { step: 'download', line: '', done: 0, total: 0, stepSince: Date.now() });
  const before = run.step;
  if (event.event === 'phase') {
    if (event.phase === 'download') Object.assign(run, { step: 'download', done: 0, total: event.total || 0 });
    if (event.phase === 'unpack') Object.assign(run, { step: 'unpack', done: 0, total: 0, line: t('update.unpackLine', 'Unpacking the update files…') });
    if (event.phase === 'check') run.step = 'check';
    if (event.phase === 'undo') run.step = 'undo';
  } else if (event.event === 'bytes') Object.assign(run, { done: event.done, total: event.total });
  else if (event.event === 'unpack') Object.assign(run, { step: 'unpack', line: event.total > 1 ? t('update.unpackPart', 'Unpacking the update files: part {done} of {total}…', { done: event.done, total: event.total }) : t('update.unpackLine', 'Unpacking the update files…') });
  else if (event.event === 'step') { const step = updateStepOf(event.text) || run.step; if (step !== run.step) Object.assign(run, { done: 0, total: 0 }); run.step = step; run.line = event.text; if (step === 'test' && !run.testSince) run.testSince = Date.now(); }
  else if (event.event === 'progress') Object.assign(run, { done: event.done, total: event.total, line: event.text });
  else if (['info', 'installer', 'warn'].includes(event.event) && event.text) run.line = event.text;
  if (run.step !== before) run.stepSince = Date.now();
  if ($('#dialog').open && $('#update-live')) { $('#update-live').innerHTML = updateLive(); applyBars($('#update-live')); }
}

function updateLive() {
  const run = App.state.update.run || {};
  const current = run.step === 'undo' ? -1 : UPDATE_STEPS.findIndex(([id]) => id === run.step);
  const pct = run.total ? Math.min(100, Math.floor((100 * run.done) / run.total)) : null;
  const steps = run.step === 'undo'
    ? `<li class="active">${icon('refresh')}<span>${esc(t('update.undoing', 'Putting the server back as it was'))}</span></li>`
    : UPDATE_STEPS.map(([id, iconName, label], index) => `<li class="${index < current ? 'done' : index === current ? 'active' : ''}">${icon(index < current ? 'check' : iconName)}<span>${esc(t(`update.step.${id}`, label))}</span></li>`).join('');
  return `<ol class="update-steps">${steps}</ol>
    ${pct !== null && ['download', 'files'].includes(run.step) ? `${progressBar({ total: 100, completed: pct }).html}<small class="muted">${run.step === 'download' ? esc(`${formatBytes(run.done)} / ${formatBytes(run.total)}`) : `${pct} %`}</small>` : ''}
    <p class="update-line">${esc(run.step === 'test' && run.testSince ? testLine(run.testSince) : run.line || '')}</p>
    ${run.step !== 'test' && run.stepSince && Date.now() - run.stepSince > 10000 ? `<p class="muted small update-still">${icon('refresh')}${esc(t('update.stillWorking', 'Still working ({time}). Big updates take longer: do not close the launcher.', { time: elapsed(run.stepSince) }))}</p>` : ''}`;
}

// The test start: what it does and how long it has been running, in the player's words (not the tool's line).
function elapsed(since) {
  const seconds = Math.floor((Date.now() - since) / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
}
function testLine(since) {
  const time = elapsed(since);
  return t('update.testLine', 'The server starts once to check that everything works ({time} so far). The first start after an update takes 5 to 15 minutes; the server is then stopped cleanly.', { time });
}
setInterval(() => { if (App.state.update.run && $('#dialog').open && $('#update-live')) { $('#update-live').innerHTML = updateLive(); applyBars($('#update-live')); } }, 1000);

function updateResultView() {
  const last = App.state.update.state?.last;
  if (!last) return '';
  if (!last.error) {
    const undo = last.command === 'rollback' || /on-cut/.test(last.command || '');
    return `<div class="update-result ok">${icon('check')}<div><strong>${esc(last.command === 'rollback' ? t('update.undone', 'The update was undone: your server is as it was before.') : t('update.done', 'The update is installed and the server started fine.'))}</strong>${undo ? '' : `<small>${esc(t('update.doneHint', 'A backup made just before is kept: you can undo the update at any time.'))}</small>`}</div></div>`;
  }
  const [key, fallback, changed] = UPDATE_ERRORS[last.error.code] || UPDATE_ERRORS[49];
  const [changedKey, changedText] = CHANGED_TEXT[changed];
  const canUndo = ['changed', 'broken', 'unknown'].includes(changed) && last.error.code !== 60;
  return `<div class="update-result bad">${icon('warning')}<div>
      <strong>${esc(t(key, fallback))}</strong>
      <small>${esc(t(changedKey, changedText))} ${esc(t('update.code', 'Code {code}.', { code: last.error.code }))}</small>
      <details><summary>${esc(t('update.details', 'Details for the support'))}</summary><pre>${esc([last.error.text, ...(last.details || [])].join('\n'))}</pre></details>
      <div class="button-row">
        ${['none', 'restored'].includes(changed) ? `<button class="button primary small" data-action="update-start">${icon('refresh')}${esc(t('update.retry', 'Try again'))}</button>` : ''}
        ${canUndo ? `<button class="button ${['none', 'restored'].includes(changed) ? 'ghost' : 'primary'} small" data-action="update-undo">${icon('refresh')}${esc(t('update.undo', 'Undo the update'))}</button>` : ''}
        <button class="button ghost small" data-action="update-report">${icon('copy')}${esc(t('update.report', 'Copy the report'))}</button>
        <button class="button ghost small" data-action="update-log">${icon('folder')}${esc(t('update.log', 'Open the log'))}</button>
      </div></div></div>`;
}

// The dialog: before (what will happen), during (the steps, it cannot be closed), after (the result).
function showUpdate() {
  const u = App.state.update.state || {};
  const m = u.manifest;
  const running = u.busy;
  const head = running
    ? `<header class="dialog-head"><div><h2>${esc(t('update.running', 'Updating your server…'))}</h2><p>${esc(t('update.dontClose', 'Do not close the launcher until it is done.'))}</p></div></header>`
    : dialog.header(m ? t('update.title', 'CoA Bots {version}', { version: m.version }) : t('update.titleNone', 'Server update'), u.here?.release ? t('update.from', 'Installed: {release}', { release: u.here.release }) : '');
  let body;
  if (running) body = `<div id="update-live">${updateLive()}</div>`;
  else if (u.last && (u.last.error || u.state !== 'available')) body = updateResultView();
  else body = `<p>${esc(t('update.what', 'The launcher takes care of everything, in this order:'))}</p>
      <ol class="notes"><li>${esc(t('update.what1', 'downloads the update and checks its signature;'))}</li><li>${esc(t('update.what2', 'makes a full backup (database and files);'))}</li><li>${esc(t('update.what3', 'stops the server cleanly, installs the new version and keeps your settings;'))}</li><li>${esc(t('update.what4', 'starts the server once to check it.'))}</li></ol>
      <div class="line-action">${icon('addons')}<span>${u.addonClient ? esc(t('update.addonTo', 'The SquidBots addon is also installed in your game: {path}', { path: u.addonClient })) : esc(t('update.addonNone', 'SquidBots addon: choose your game folder to install it too (otherwise it is left as it is).'))}</span><button class="button ghost small" data-action="update-client">${esc(u.addonClient ? t('update.addonChange', 'Change') : t('update.addonPick', 'Choose the game folder'))}</button></div>
      <p class="muted">${esc(t('update.time', 'About 5 to 20 minutes. If anything goes wrong, your server is put back as it was.'))}</p>
      ${m?.notes ? `<details class="update-notes"><summary>${esc(t('update.notes', 'What is new'))}</summary><div class="patch-notes">${markdownLite(m.notes)}</div></details>` : ''}`;
  const big = !running && u.state === 'available' && !u.last?.error ? bigUpdate(u) : null;
  if (big) body = big.html + body;
  const foot = running ? '' : u.state === 'available' && !u.last?.error && !big?.blocked
    ? `<footer class="dialog-foot"><button class="button ghost" data-action="dialog-close">${esc(t('common.later', 'Later'))}</button><button class="button primary" data-action="update-start">${icon('download')}${esc(t('update.start', 'Update now'))}</button></footer>`
    : `<footer class="dialog-foot"><button class="button ghost" data-action="dialog-close">${esc(t('common.close', 'Close'))}</button></footer>`;
  dialog.open(`${head}<div class="dialog-content update">${body}</div>${foot}`, 'wide');
}

// ---------------------------------------------------------------- the SquidBots addon in the game
App.state.addon = null;
function addonCard() {
  const a = App.state.addon;
  if (!a || a.state === 'none') return '';
  const r = a.realmlist;
  const realmBad = a.client && r && r.state !== 'ok';
  const text = a.state === 'noclient' ? t('addon.cardPick', 'Choose your game folder')
    : realmBad ? t('game.cardRealm', 'Realmlist to fix')
    : a.state === 'missing' ? t('addon.cardMissing', 'Not in your game yet: install it')
    : a.state === 'outdated' ? t('addon.cardOutdated', 'Version {version} to install', { version: a.version })
    : t('game.cardOk', 'Addon {version} · realmlist OK', { version: a.installedVersion || a.version });
  const dot = realmBad || ['noclient', 'missing', 'outdated'].includes(a.state) ? '<i class="dot"></i>' : icon('next');
  return `<button class="side-card" data-action="addon-card">${icon('addons')}<span><strong>${esc(t('game.cardTitle', 'Your game'))}</strong><small>${esc(text)}</small></span>${dot}</button>`;
}

async function refreshAddon(auto = false) {
  try {
    if (auto) {
      const result = await App.api.addonAuto();
      App.state.addon = result.status;
      if (result.installed?.length) toast(t('addon.autoDone', 'SquidBots addon updated to {version} in your game.', { version: result.status.version }), 'success');
    } else App.state.addon = await App.api.addonStatus();
  } catch { App.state.addon = null; }
  if (App.state.tab === 'home' && !$('#dialog').open) App.render();
}

function showAddon() {
  const a = App.state.addon || {};
  const r = a.realmlist;
  const rows = (a.addons || []).map(addon => `<li><strong>${esc(addon.name)}</strong> · ${esc(addon.installed ? t('addon.installedIn', 'in your game: {version}', { version: addon.installed }) : t('addon.notInGame', 'not in your game'))} · ${esc(t('addon.inRepack', 'in the server: {version}', { version: addon.available }))}</li>`).join('');
  const realm = !r ? '' : `<h3>${esc(t('game.realmTitle', 'Realmlist'))}</h3>
    ${r.files.length ? `<ul class="notes">${r.files.map(item => `<li><code>${esc(item.file)}</code> · <strong>${esc(item.value)}</strong></li>`).join('')}</ul>` : `<p class="muted">${esc(t('game.realmNone', 'No realmlist found in this game.'))}</p>`}
    <div class="line-action">${icon(r.state === 'ok' ? 'check' : 'warning')}<span>${esc(r.state === 'ok' ? t('game.realmOk', 'Your game points at this server.') : t('game.realmWrong', 'Your game does not point at this server: it should use {expected}. The launcher can set it (game closed); the replaced files are kept.', { expected: r.expected }))}</span><button class="button ${r.state === 'ok' ? 'ghost' : 'primary'} small" data-action="addon-realmlist">${esc(t('game.realmSet', 'Set the realmlist'))}</button></div>`;
  dialog.open(`${dialog.header(t('game.cardTitle', 'Your game'), a.client || '')}<div class="dialog-content">
    <h3>${esc(t('addon.cardTitle', 'SquidBots addon'))}</h3>
    <p>${esc(t('addon.what', 'The addon to command your bots in game. The launcher copies it into your game and updates it by itself when the server brings a new version (never while the game is open). What it saved in the game is kept.'))}</p>
    <ul class="notes">${rows}</ul>${realm}</div>
    <footer class="dialog-foot"><button class="button ghost" data-action="addon-change">${icon('folder')}${esc(t('addon.change', 'Another game folder'))}</button>${a.client ? `<button class="button primary" data-action="addon-install">${icon('download')}${esc(a.state === 'current' ? t('addon.reinstall', 'Install again') : t('addon.install', 'Install in my game'))}</button>` : ''}</footer>`);
}

async function addonDone(call, button) {
  const result = await guard(call, button);
  if (!result) return;
  App.state.addon = result.status;
  if (result.installed?.length) toast(t('addon.done', 'SquidBots addon {version} is in your game: it loads at your next login.', { version: result.status.version }), 'success');
  dialog.close();
  App.render();
}

Object.assign(App.actions, {
  'addon-card': async button => {
    const a = App.state.addon || {};
    if (a.state === 'noclient' && a.suggested) {
      const yes = await confirmDialog({ title: t('addon.cardTitle', 'SquidBots addon'), body: esc(t('addon.useSuggested', 'Install it in {path} (the game used by the bots installer)?', { path: a.suggested })), confirm: t('addon.install', 'Install in my game') });
      addonDone(() => App.api.addonSetup(yes), button);
    } else if (a.state === 'noclient') addonDone(() => App.api.addonSetup(false), button);
    else if (a.realmlist && a.realmlist.state !== 'ok') showAddon();
    else if (a.state === 'outdated' || a.state === 'missing') addonDone(() => App.api.addonInstall(), button);
    else showAddon();
  },
  'addon-change': button => addonDone(() => App.api.addonSetup(false), button),
  'addon-install': button => addonDone(() => App.api.addonInstall(), button),
  'addon-realmlist': async button => {
    const status = await guard(() => App.api.addonRealmlist(), button);
    if (!status) return;
    App.state.addon = status;
    App.render();
    toast(t('game.realmDone', 'Realmlist set to {expected}: it is read at the next start of the game.', { expected: status.realmlist?.expected || '' }), 'success');
    showAddon();
  },
});

// The update card, first in the hero: a new version, an update running, cut, or stopped on an error.
function updateCard() {
  const u = App.state.update.state;
  if (!u) return '';
  const card = (kind, iconName, title, text, action, label) => `<div class="update-card ${kind}">${icon(iconName)}<span><strong>${esc(title)}</strong><small>${esc(text)}</small></span>${action}</div>`;
  if (u.busy) return card('info', 'refresh', t('update.running', 'Updating your server…'), t('update.dontClose', 'Do not close the launcher until it is done.'), `<button class="button primary small" data-action="update-open">${esc(t('update.follow', 'Follow'))}</button>`);
  if (u.state === 'cut') return card('bad', 'warning', t('update.cutTitle', 'Update cut'), t('update.cutShort', 'Finish it or undo it before starting the server.'), `<div class="update-card-actions"><button class="button primary small" data-action="update-finish">${esc(t('update.finish', 'Finish it'))}</button><button class="button ghost small" data-action="update-undo-cut">${esc(t('update.undo', 'Undo the update'))}</button></div>`);
  if (u.state === 'available' && launcherFirst(u)) return card('info', 'refresh', t('update.title', 'CoA Bots {version}', { version: u.manifest.version }), launcherFirst(u), App.state.launcherUpdate?.phase === 'downloaded' ? `<button class="button primary small" data-action="launcher-install">${esc(t('home.launcherRestart', 'Restart and update'))}</button>` : `<button class="button ghost small" data-action="launcher-check">${esc(t('settings.checkLauncher', 'Check for a launcher update'))}</button>`);
  if (u.state === 'available') return card('new', 'download', `${t('update.title', 'CoA Bots {version}', { version: u.manifest.version })}${u.manifest.channel === 'beta' ? ' · BETA' : ''}`, (u.manifest.package?.size || 0) + (u.manifest.package?.parts || []).reduce((sum, part) => sum + part.size, 0) >= BIG_UPDATE ? t('update.bigShort', 'Big update: about {size} to download.', { size: formatBytes((u.manifest.package?.size || 0) + (u.manifest.package?.parts || []).reduce((sum, part) => sum + part.size, 0)) }) : t('update.availableShort', 'New version: update in one click, with a backup.'), `<button class="button primary small" data-action="update-open"><i class="dot"></i>${esc(t('update.see', 'Update'))}</button>`);
  if (u.last?.error) return card('bad', 'warning', t('update.lastFailedTitle', 'Update stopped'), t('update.lastFailed', 'The last update stopped with an error.'), `<button class="button ghost small" data-action="update-open">${esc(t('update.seeError', 'See what to do'))}</button>`);
  return '';
}

async function runUpdate(call) {
  App.state.update.run = { step: 'download', line: '', done: 0, total: 0 };
  App.state.update.state = { ...(App.state.update.state || {}), busy: true, last: null };
  showUpdate();
  const element = $('#dialog');
  const block = event => event.preventDefault();
  element.addEventListener('cancel', block);
  try {
    const state = await call();
    if (state) App.state.update.state = state;
  } catch (error) {
    App.state.update.state = { ...(App.state.update.state || {}), busy: false, last: { error: { code: 'launcher', text: translateError(error.message) }, details: [] } };
  } finally {
    element.removeEventListener('cancel', block);
    App.state.update.run = null;
    App.state.verify = null;
  }
  refreshAddon(true);
  // The core and bots versions changed (or came back): read the server again, and its patch notes.
  try { App.state.server = await App.api.serverInfo(); } catch {}
  App.api.notes().then(notes => { App.state.notes = notes; if (App.state.tab === 'home' && !$('#dialog').open) App.render(); }).catch(() => {});
  showUpdate();
  // Done: the result stays in its window, over the home page (where the new versions show).
  if (App.state.update.state?.last?.error) App.render(); else App.go('home');
}

Object.assign(App.actions, {
  'update-check': button => guard(async () => {
    const state = await App.api.updateRefresh();
    if (state) App.state.update.state = state;
    if (state?.state === 'available' || state?.state === 'cut') showUpdate();
    else toast(state?.listError ? t('update.listError', 'The update list could not be read: {error}', { error: state.listError }) : t('update.upToDate', 'Your server is up to date.'), state?.listError ? 'error' : 'success');
    App.render();
  }, button),
  'update-open': () => showUpdate(),
  'update-start': () => runUpdate(() => App.api.updateRun()),
  'update-undo': async () => {
    if (!await confirmDialog({ title: t('update.undo', 'Undo the update'), body: esc(t('update.undoConfirm', 'The server is stopped and put back exactly as it was before the update (database and files).')), confirm: t('update.undo', 'Undo the update'), danger: true })) return;
    await runUpdate(() => App.api.updateUndo('rollback'));
    App.state.undoInfo = null;
    if (App.state.srvTab === 'backups') loadBackups();
  },
  'update-finish': () => runUpdate(() => App.api.updateUndo('finish')),
  'update-undo-cut': () => runUpdate(() => App.api.updateUndo('undo-cut')),
  'update-client': button => guard(async () => { const folder = await App.api.updatePickClient(); App.state.update.state = { ...(App.state.update.state || {}), addonClient: folder }; showUpdate(); }, button),
  'update-report': button => guard(async () => { await App.api.updateReport(); toast(t('update.copied', 'Report copied: paste it on the support Discord.'), 'success'); }, button),
  'update-log': () => guard(() => App.api.updateOpenLog()),
});

// A big update (or one with a notice) says so before the click: what it does, the download, the disk space needed.
// Not enough free space: the update is not offered (the tool would stop at its checks anyway).
const BIG_UPDATE = 500 * 1024 * 1024;
function bigUpdate(u) {
  const m = u.manifest || {};
  const notice = m.notice ? m.notice[I18N.lang] || m.notice.en || '' : '';
  const size = (m.package?.size || 0) + (m.package?.parts || []).reduce((sum, part) => sum + part.size, 0);
  if (!notice && !(size >= BIG_UPDATE) && !m.diskBytes) return null;
  const need = m.diskBytes || 0;
  const blocked = need > 0 && typeof u.diskFree === 'number' && u.diskFree < need;
  const facts = [t('update.bigDownload', 'Download: about {size}.', { size: formatBytes(size) })];
  if (need) facts.push(t('update.bigDisk', 'Free disk space needed: about {need} (free now: {free}).', { need: formatBytes(need), free: typeof u.diskFree === 'number' ? formatBytes(u.diskFree) : '?' }));
  const html = `<div class="update-card ${blocked ? 'bad' : 'info'} big-update">${icon(blocked ? 'warning' : 'info')}<span><strong>${esc(blocked ? t('update.bigBlocked', 'Not enough free disk space for this update.') : t('update.bigTitle', 'Big update'))}</strong>${notice ? `<small>${esc(notice)}</small>` : ''}<small>${esc(facts.join(' '))}</small></span></div>`;
  return { html, blocked };
}

// An update offered only with a launcher recent enough, and never while a new launcher is on its way:
// the player installs the launcher first (it may be the one that knows how to install this update).
function versionBelow(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
}
function launcherFirst(u) {
  const phase = App.state.launcherUpdate?.phase;
  // Not looked for yet: the repack update waits a few seconds, the launcher comes first.
  if (phase === 'idle' || phase === 'checking') return t('update.launcherChecking', 'Looking for a new launcher first…');
  if (phase === 'downloaded') return t('update.launcherReady', 'A new launcher is ready: restart it first, then update the server.');
  if (phase === 'downloading') return t('update.launcherComing', 'A new launcher is being downloaded: install it first, then update the server.');
  const need = u.manifest?.minLauncher;
  if (need && versionBelow(App.state.version, need)) return t('update.launcherNeeded', 'This update needs launcher {need} or newer (you have {have}): update the launcher first.', { need, have: App.state.version });
  return '';
}

// ---------------------------------------------------------------- components published on their own
// The addon and the dashboard: a small card when a newer one is published, installed in a few seconds without
// touching the server. Not while a new launcher is on its way (the launcher comes first).
App.state.components = null;
const COMPONENT_LABEL = { addon: 'SquidBots addon', dashboard: 'Bots dashboard' };
function componentCards() {
  const list = (App.state.components?.list || []).filter(item => item.available || item.waiting);
  if (!list.length) return '';
  const first = ['downloading', 'downloaded'].includes(App.state.launcherUpdate?.phase);
  return list.map(item => {
    const label = t(`component.${item.name}`, COMPONENT_LABEL[item.name] || item.name);
    // Newer, but for a newer server: said, without a button (the server update brings it, or allows it).
    if (item.waiting) return `<div class="update-card component-card waiting">${icon(item.name === 'addon' ? 'addons' : 'chart')}<span><strong>${esc(t('component.title', '{name} {version}', { name: label, version: item.version }))}</strong><small>${esc(t('component.needsBots', 'Needs CoA Bots {need} on the server (you have {have}): update the server first.', { need: item.waiting.minBots, have: item.waiting.bots || '—' }))}</small></span></div>`;
    const text = first ? t('component.launcherFirst', 'Install the new launcher first.') : t('component.available', 'Version {version} (you have {have}): a few seconds, the server is not touched.', { version: item.version, have: item.installed === '0' ? '—' : item.installed });
    const action = first ? '' : `<button class="button primary small" data-action="component-install" data-id="${esc(item.name)}" ${App.state.components.busy ? 'disabled' : ''}>${esc(t('update.see', 'Update'))}</button>`;
    return `<div class="update-card new component-card">${icon(item.name === 'addon' ? 'addons' : 'chart')}<span><strong>${esc(t('component.title', '{name} {version}', { name: label, version: item.version }))}</strong><small>${esc(text)}</small></span>${action}</div>`;
  }).join('');
}
Object.assign(App.actions, {
  'component-install': button => guard(async () => {
    const name = button.dataset.id;
    toast(t('component.installing', 'Installing…'));
    const result = await App.api.componentsInstall(name);
    App.state.components = result.state;
    const label = t(`component.${name}`, COMPONENT_LABEL[name] || name);
    const extra = name === 'addon' && result.game === 'running' ? t('component.addonGameOpen', 'Close the game: the addon goes into it at the next start of the launcher.') : name === 'addon' && result.game === 'installed' ? t('component.addonInGame', 'It is in your game: it loads at your next login.') : '';
    toast(`${t('component.done', '{name} {version} installed.', { name: label, version: result.version })} ${extra}`.trim(), 'success');
    if (name === 'addon') refreshAddon();
    App.render();
  }, button),
});
