'use strict';
// State, small helpers, dialogs and the two top tabs.

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const int = value => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0);
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const loc = value => (value && typeof value === 'object' ? value[I18N.lang] || value.en || '' : String(value ?? ''));

// What's new: a red dot on the places a launcher update changed, until the player has opened them once.
// Raise a number when its place changes again in a later launcher.
const NEW_SPOTS = { modules: 1, settings: 1, realms: 1 };
const seenSpots = () => {
  try {
    const saved = localStorage.getItem('seenSpots');
    // First launch: everything counts as seen.
    if (saved === null) { localStorage.setItem('seenSpots', JSON.stringify(NEW_SPOTS)); return { ...NEW_SPOTS }; }
    return JSON.parse(saved || '{}');
  } catch { return {}; }
};
const isNew = id => (NEW_SPOTS[id] || 0) > (seenSpots()[id] || 0);
function markSeen(id) {
  if (!isNew(id)) return;
  try { localStorage.setItem('seenSpots', JSON.stringify({ ...seenSpots(), [id]: NEW_SPOTS[id] })); } catch {}
}
const newDot = () => `<i class="dot" title="${esc(t('common.new', 'New'))}"></i>`;

const App = {
  api: window.launcher,
  state: {
    tab: 'play', config: null, settings: null, client: null, check: null, realm: null,
    addons: null, addonQuery: '', addonsLoading: false,
    server: null, serverCheck: null, botsCheck: null, srvTab: 'settings',
    conf: null, pending: {}, backups: null, upgrade: null, upgradeLog: [], upgradeStep: '', upgradeLastStep: '', upgradeRunning: false,
    oldRepack: null, oldCheck: null, upgradeFolder: '', task: null, launcherUpdate: null,
    updates: { core: null, bots: null },
  },
  actions: {},
  pages: {},
  render() {
    if (App.state.tab === 'addons' && !isClassic()) App.state.tab = 'play';
    // Server edition: Home, Realms, Modules on the left of the crest; Verification, Management and Console on its right.
    const serverTabs = [['home', 'home', t('tab.home', 'Home')], ...(App.state.realms?.available ? [['realms', 'globe', t('tab.realms', 'Realms')]] : []), ['modules', 'addons', t('tab.modules', 'Modules')]];
    const rightTabs = [['verify', 'shield', t('tab.verify', 'Verification')], ['server', 'settings', t('tab.settings', 'Settings')], ['console', 'terminal', t('tab.console', 'Console')]];
    if (App.state.config.edition === 'server' && ![...serverTabs, ...rightTabs].some(([id]) => id === App.state.tab)) App.state.tab = 'home';
    $('#tabs').innerHTML = (App.state.config.edition === 'server' ? serverTabs : [['play', 'play', t('tab.play', 'Play')], ...(isClassic() && App.state.config.game.hasAddons ? [['addons', 'addons', t('addon.title', 'Addons')]] : []), ...(App.state.config.server ? [['server', 'layers', t('tab.server', 'Local server')]] : [])]
      ).map(([id, iconName, label]) => `<button class="tab${App.state.tab === id ? ' active' : ''}" data-tab="${id}">${icon(iconName)}<span>${esc(label)}</span>${(id === 'server' || id === 'home') && hasUpdates() && !(App.state.config.edition === 'server' && id === 'server') ? `<i class="dot" title="${esc(t('updates.dot', 'A new version is available'))}"></i>` : (id === 'modules' && isNew('modules')) || (id === 'realms' && isNew('realms')) ? newDot() : ''}</button>`).join('');
    $('#tabs-right').innerHTML = App.state.config.edition === 'server' ? rightTabs.map(([id, iconName, label]) => `<button class="tab${App.state.tab === id ? ' active' : ''}" data-tab="${id}">${icon(iconName)}<span>${esc(label)}</span>${id === 'server' && isNew('settings') ? newDot() : ''}</button>`).join('') : '';
    const banner = $('#launcher-banner');
    if (banner) banner.innerHTML = App.state.config.edition === 'server' && typeof launcherBanner === 'function' ? launcherBanner() : '';
    const page = App.pages[App.state.tab];
    $('#view').innerHTML = page.render();
    applyBars();
    page.mount?.();
  },
  refresh(tab) { if (!tab || App.state.tab === tab || (tab === 'play' && App.state.tab === 'addons') || (tab === 'server' && App.state.tab === 'home')) App.render(); },
  go(tab) { App.state.tab = tab; if (tab === 'dash') App.state.dashFresh = false; if (tab === 'modules') { App.state.modulesFresh = false; markSeen('modules'); } App.render(); if (tab === 'home' && typeof refreshLive === 'function') refreshLive(); },
};
window.App = App;

// New core or bots published? Drives the red dots on "Local server" and on its sub-tabs.
const hasUpdates = () => !!(App.state.updates.core || App.state.updates.bots);
async function refreshUpdates() {
  if (!App.state.config?.server) return;
  const before = JSON.stringify(App.state.updates);
  try { App.state.updates = await App.api.peekUpdates(); } catch { return; }
  if (JSON.stringify(App.state.updates) !== before && !$('#dialog').open) App.render();
}

// One look: the classic skin with the SquidBots emblem (older settings may still name another one).
// One layout (classic); two colour sets: amber (default) and abyss (deep blue).
function applyTheme(theme) { const root = document.documentElement; root.dataset.theme = 'classic'; if (theme === 'classic') delete root.dataset.palette; else root.dataset.palette = 'abyss'; }
const isClassic = () => true;

let toastTimer;
function toast(message, kind = 'info') {
  const element = $('#toast');
  // An open dialog sits above the page: the message goes inside it so it is seen, not blurred behind.
  const dialogElement = $('#dialog');
  const host = dialogElement?.open ? dialogElement : document.body;
  if (element.parentElement !== host) host.appendChild(element);
  element.className = `toast ${kind}`;
  element.innerHTML = `${icon(kind === 'error' ? 'warning' : kind === 'success' ? 'check' : 'info')}<span>${esc(message)}</span>`;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 6000);
}

async function guard(action, button) {
  if (button) button.disabled = true;
  try { return await action(); }
  catch (error) {
    const message = translateError(error.message);
    const inline = button?.closest?.('#dialog') ? $('#dialog[open] [data-error]') : null;
    if (inline) { inline.hidden = false; inline.innerHTML = `${icon('warning')}<span>${esc(message)}</span>`; }
    else toast(message, 'error');
    return undefined;
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

const dialog = {
  open(html, className = '') {
    const element = $('#dialog');
    element.className = `dialog ${className}`;
    $('#dialog-body').innerHTML = html;
    if (!element.open) element.showModal();
  },
  close() { const element = $('#dialog'); if (element.open) element.close(); },
  header(title, subtitle = '') {
    return `<header class="dialog-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="icon-button" data-action="dialog-close" aria-label="${esc(t('common.close', 'Close'))}">${icon('close')}</button></header><div class="inline-error" data-error hidden></div>`;
  },
};

// A dialog that cannot be closed while a long task runs (recreating the bots); closed by its caller.
function holdDialog(title, body) {
  const element = $('#dialog');
  $('#dialog-body').innerHTML = `<header class="dialog-head"><div><h2>${esc(title)}</h2></div></header><div class="dialog-content"><div class="task-line">${icon('refresh')}<span>${esc(body)}</span></div></div>`;
  const block = event => event.preventDefault();
  element.addEventListener('cancel', block);
  if (!element.open) element.showModal();
  return () => { element.removeEventListener('cancel', block); element.close(); };
}

function confirmDialog({ title, body, confirm, danger = false }) {
  return new Promise(resolve => {
    dialog.open(`${dialog.header(title)}<div class="dialog-content"><p>${body}</p></div><footer class="dialog-foot"><button class="button ghost" data-choice="no">${esc(t('common.cancel', 'Cancel'))}</button><button class="button ${danger ? 'danger' : 'primary'}" data-choice="yes">${esc(confirm)}</button></footer>`, 'small');
    const element = $('#dialog');
    const done = value => { element.removeEventListener('click', onClick); element.removeEventListener('close', onClose); dialog.close(); resolve(value); };
    const onClick = event => { const choice = event.target.closest('[data-choice]')?.dataset.choice; if (choice) done(choice === 'yes'); };
    const onClose = () => { if (!element.open) done(false); };
    element.addEventListener('click', onClick);
    element.addEventListener('close', onClose, { once: true });
  });
}

function emptyState(iconName, title, text, action = '') {
  return `<div class="empty">${icon(iconName)}<strong>${esc(title)}</strong>${text ? `<span>${esc(text)}</span>` : ''}${action}</div>`;
}

function skeleton(lines = 3) { return `<div class="skeleton">${'<span></span>'.repeat(lines)}</div>`; }

function progressBar(progress) {
  let pct = null;
  if (progress?.totalBytes) pct = Math.floor((100 * (progress.bytes || 0)) / progress.totalBytes);
  else if (progress?.total) pct = Math.floor((100 * (progress.completed || 0)) / progress.total);
  return { pct, html: `<div class="progress${pct === null ? ' indeterminate' : ''}"><span data-pct="${pct ?? 30}"></span></div>` };
}

// Inline style attributes are refused by the page's security policy: widths are set from script.
function applyBars(root = document) {
  for (const bar of $$('[data-pct]', root)) bar.style.width = `${Math.min(100, Number(bar.dataset.pct) || 0)}%`;
}

function progressText(progress) {
  if (!progress) return '';
  if (progress.phase === 'downloading' && progress.totalBytes) {
    return t('progress.download', 'Downloading {done} of {total}{speed}', { done: formatBytes(progress.bytes || 0), total: formatBytes(progress.totalBytes), speed: progress.speed ? ` · ${formatBytes(progress.speed)}/s` : '' });
  }
  if (progress.phase === 'applying') return t('progress.applying', 'Installing verified files ({done}/{total}). Keep the launcher open.', { done: formatNumber(progress.completed || 0), total: formatNumber(progress.total || 0) });
  if (progress.phase === 'checking') return progress.total ? t('progress.checking', 'Checking files ({done}/{total})', { done: formatNumber(progress.completed || 0), total: formatNumber(progress.total) }) : t('progress.looking', 'Looking for a release…');
  return translateError(progress.message || '');
}

const BUSY = ['checking', 'downloading', 'applying'];

// Long server jobs (backup, restore) in the player's language.
function taskText(task) {
  const base = task.phase === 'restore' ? t('backup.restoring', 'Restoring the backup…') : t('backup.saving', 'Saving the database…');
  return task.bytes ? `${base} ${formatBytes(task.bytes)}` : base;
}
