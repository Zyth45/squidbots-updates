'use strict';
// The Realms tab: one server, several ways to play. The CoA realm is the repack's own; Wildcard and Warcraft Reborn
// are extra realms with their own characters, bots and settings (accounts are shared). Each realm has its emblem
// and its colour, used everywhere a page works on one realm (settings, console) so nobody wonders where they are.

// Emblems drawn for this launcher (simple shapes, no image of another launcher or game).
const REALM_EMBLEMS = {
  coa: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="re-coa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7ad"/><stop offset="1" stop-color="#c7862c"/></linearGradient></defs>
    <path d="M32 4 54 12v18c0 15-10 25-22 30C20 55 10 45 10 30V12Z" fill="#1d1508" stroke="url(#re-coa)" stroke-width="3" stroke-linejoin="round"/>
    <path d="M20 44 44 20M44 44 20 20" stroke="url(#re-coa)" stroke-width="2.6" stroke-linecap="round" opacity=".55"/>
    <path d="M17 41l6 6M41 17l6 6M47 41l-6 6M23 17l-6 6" stroke="url(#re-coa)" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>
    <path d="M32 15l3.6 12.4L48 31l-12.4 3.6L32 47l-3.6-12.4L16 31l12.4-3.6Z" fill="url(#re-coa)"/>
    <circle cx="32" cy="31" r="3.2" fill="#1d1508"/></svg>`,
  wildcard: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="re-wc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3b8ff"/><stop offset="1" stop-color="#8b43e6"/></linearGradient></defs>
    <g transform="rotate(16 44 22)"><rect x="32" y="8" width="25" height="25" rx="6" fill="#241238" stroke="url(#re-wc)" stroke-width="2.6"/>
      <circle cx="38.5" cy="14.5" r="2.4" fill="#f3c9ff"/><circle cx="50.5" cy="14.5" r="2.4" fill="#f3c9ff"/><circle cx="38.5" cy="26.5" r="2.4" fill="#f3c9ff"/><circle cx="50.5" cy="26.5" r="2.4" fill="#f3c9ff"/></g>
    <g transform="rotate(-14 25 38)"><rect x="8" y="21" width="33" height="33" rx="8" fill="url(#re-wc)"/>
      <circle cx="16" cy="29" r="3" fill="#fff"/><circle cx="24.5" cy="37.5" r="3" fill="#fff"/><circle cx="33" cy="46" r="3" fill="#fff"/><circle cx="33" cy="29" r="3" fill="#fff"/><circle cx="16" cy="46" r="3" fill="#fff"/></g></svg>`,
  reborn: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="re-wr" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#b8541c"/><stop offset=".6" stop-color="#ff9a3c"/><stop offset="1" stop-color="#ffe2a0"/></linearGradient></defs>
    <path d="M29 36C21 36 11 30 5 17c8 4 14 5 19 3-3 5-2 10 5 13Z" fill="url(#re-wr)" opacity=".85"/>
    <path d="M35 36c8 0 18-6 24-19-8 4-14 5-19 3 3 5 2 10-5 13Z" fill="url(#re-wr)" opacity=".85"/>
    <path d="M32 7c6 9 11 15 8 26-1 6-5 10-8 23-3-13-7-17-8-23-3-11 2-17 8-26Z" fill="url(#re-wr)"/>
    <path d="M32 21c2.5 4 4 7 2.8 11.5-.6 2.4-1.8 4-2.8 7.5-1-3.5-2.2-5.1-2.8-7.5C28 28 29.5 25 32 21Z" fill="#fff3d6"/>
    <path d="M18 58h28" stroke="url(#re-wr)" stroke-width="2.6" stroke-linecap="round" opacity=".6"/></svg>`,
};

const REALMS_INFO = {
  coa: { color: '#e8b04a', title: 'Conquest of Azeroth', sub: 'CoA', textKey: 'realms.coaText', text: 'The classic realm: the classes of Conquest of Azeroth, your characters and your bots of today.' },
  wildcard: { color: '#c27bff', title: 'Wildcard', sub: 'Darkmoon', textKey: 'realms.wildcardText', text: 'One class, the Hero: its spells and talents are drawn at random. A new game every time.' },
  reborn: { color: '#ff8a3d', title: 'Warcraft Reborn', sub: 'Bronzebeard', textKey: 'realms.rebornText', text: 'The ten original classes, reworked: classic Warcraft, plus.' },
};
const realmEmblem = (key, size = 56) => `<span class="realm-emblem realm-${key} s${size}">${REALM_EMBLEMS[key] || ''}</span>`;
const realmTitle = key => REALMS_INFO[key]?.title || key;
// Short names, for the lights of the home page.
const realmShort = key => ({ coa: 'CoA', wildcard: 'Wildcard', reborn: 'Reborn' }[key] || key);

async function loadRealms() {
  const before = !!App.state.realms?.available;
  try { App.state.realms = await App.api.realmsStatus(); } catch (error) { App.state.realms = { error: translateError(error.message) }; }
  // The Realms tab exists only from CoA Bots 2.6 (or when realms were made): redraw the tabs when that changes.
  if (!!App.state.realms?.available !== before) { App.render(); return; }
  if (['realms', 'server', 'console', 'modules'].includes(App.state.tab)) App.refresh(App.state.tab);
  // A realm started or stopped from its card: the home page (status line, lights, Start/Stop) follows.
  const worlds = list => (list || []).filter(realm => ['running', 'starting'].includes(realm.state)).map(realm => `${realm.key}:${realm.state}`).sort().join(',');
  if (App.state.server && worlds(App.state.realms?.realms) !== worlds(App.state.server.realmsOn)) {
    App.state.server = await App.api.serverInfo().catch(() => App.state.server);
    if (App.state.tab === 'home') App.refresh('home');
  }
}
// The home page reads the realms too (every 10 s): a realm started from its card shows there without visiting its tab.
setInterval(() => { if (App.state.tab === 'home' && App.state.realms?.available && !App.state.realmBusy) loadRealms(); }, 10000);

// Every realm in the order of the page: CoA first, then the extra ones (created or not).
function realmList() {
  const r = App.state.realms;
  if (!r || r.error) return [];
  return [{ key: 'coa', ...r.coa, main: true }, ...r.realms];
}
const createdRealms = () => realmList().filter(realm => realm.main || !['absent', 'disabled'].includes(realm.state));

function realmStatePill(state, realm) {
  if (state === 'queued') return `<span class="pill warn"><i class="state-dot"></i>${esc(t('realms.queuedShort', 'Waiting'))}</span>`;
  const map = { lowmem: ['bad', 'realms.lowMemory', 'Low memory'], running: ['ok', 'realms.running', 'Running'], starting: ['warn', 'realms.starting', 'Starting…'], stopping: ['warn', 'realms.stopping', 'Stopping…'], stopped: ['', 'realms.stopped', 'Stopped'], disabled: ['', 'realms.disabled', 'Switched off'], foreign: ['bad', 'realms.foreign', 'Port used by another program'] };
  const [kind, key, text] = map[state] || map.stopped;
  return `<span class="pill ${kind}"><i class="state-dot"></i>${esc(t(key, text))}</span>`;
}

// The switch at the top of the settings and console pages: which realm the page works on.
function realmPicker(current, action) {
  const list = createdRealms();
  if (list.length < 2) return '';
  return `<div class="realm-picker" role="tablist" aria-label="${esc(t('realms.which', 'Realm'))}">${list.map(realm => `<button role="tab" class="realm-pick realm-${realm.key}${realm.key === current ? ' active' : ''}" data-action="${action}" data-key="${realm.key}" aria-selected="${realm.key === current}">${realmEmblem(realm.key, 22)}<span>${esc(realmTitle(realm.key))}</span>${realm.state === 'running' ? '<i class="state-dot on"></i>' : ''}</button>`).join('')}</div>`;
}

// The coloured line that says, on a page, which realm is being worked on.
function realmBanner(key, text) {
  return `<div class="realm-banner realm-${key}">${realmEmblem(key, 30)}<div><strong>${esc(realmTitle(key))}</strong><span>${esc(text)}</span></div></div>`;
}

// The line under the name says what is going on when it matters more than the description of the mode.
function realmNote(realm, working) {
  const line = (kind, text) => `<p class="realm-text realm-note ${kind}">${esc(text)}</p>`;
  if (realm.state === 'queued') return line('warn', t('realms.queuedText', 'Starts after {name}: the worlds start one after the other.', { name: realmTitle(realm.after || 'coa') }));
  if ((realm.state === 'starting' || working) && realm.firstStart) return line('info', t('realms.firstStart', 'First start: a few minutes (auction house, new bots). The next ones are quicker.'));
  if (realm.state === 'stopped' && realm.skipped?.reason === 'memory') return line('bad', t('realms.lowMemoryText', 'Not started with the server: {free} GB free, about {need} GB needed. Stop a realm or lower its bots.', { free: (realm.skipped.free / 1024).toFixed(1), need: (realm.skipped.need / 1024).toFixed(1) }));
  return '';
}

function realmCard(realm, busy) {
  const info = REALMS_INFO[realm.key];
  const working = busy === realm.key || (App.state.stoppingAll && ['running', 'starting'].includes(realm.state));
  const head = `<header>${realmEmblem(realm.key, 56)}<div class="realm-name"><h2>${esc(info.title)}</h2><small>${esc(info.sub)}</small></div>${realmStatePill(realm.state === 'absent' ? 'disabled' : working && (App.state.realmBusyKind === 'stop' || App.state.stoppingAll) ? 'stopping' : working && realm.state === 'stopped' ? 'starting' : realm.state === 'stopped' && realm.skipped ? 'lowmem' : realm.state, realm)}</header>
    ${realmNote(realm, working) || `<p class="realm-text">${esc(t(info.textKey, info.text))}</p>`}`;
  if (realm.state === 'absent') {
    const r = App.state.realms;
    const creatable = r.supported && realm.ready;
    const why = !r.supported && r.version ? t('realms.needVersion', 'Comes with CoA Bots 2.6 (this server: {version}).', { version: r.version })
      : r.supported ? t('realms.needNewer', 'Comes with CoA Bots 2.6: its update tool must know the databases of this realm.')
      : t('realms.needBots', 'Needs CoA Bots in this server.');
    return `<article class="realm-card realm-${realm.key} absent">${head}
      <ul class="realm-promise"><li>${icon('user')}${esc(t('realms.ownChars', 'Its own characters (your CoA characters stay where they are)'))}</li><li>${icon('bot')}${esc(t('realms.ownBots', 'Its own bots, {n} to start with', { n: 150 }))}</li><li>${icon('key')}${esc(t('realms.sameAccount', 'The same game accounts'))}</li></ul>
      <div class="realm-buttons">${creatable ? `<button class="button primary small wide" data-action="realm-create" data-key="${realm.key}" ${busy ? 'disabled' : ''}>${icon('play')}${esc(working ? t('realms.creating', 'Switching on…') : t('realms.activate', 'Switch on'))}</button>` : `<small class="muted">${esc(why)}</small>`}</div>
      <footer class="realm-more"><small class="muted">${creatable ? esc(working && App.state.realmLine ? App.state.realmLine : t('realms.createTime', 'About a minute.')) : ''}</small></footer>
    </article>`;
  }
  // Switched off: out of the realm list, everything kept; one click puts it back.
  if (realm.state === 'disabled') {
    return `<article class="realm-card realm-${realm.key} absent">${head}
      <ul class="realm-promise"><li>${icon('check')}${esc(t('realms.keptChars', 'Its characters and its bots are kept'))}</li><li>${icon('check')}${esc(t('realms.keptSettings', 'Its settings and modules are kept'))}</li><li>${icon('info')}${esc(t('realms.hidden', 'Out of the realm list of the game'))}</li></ul>
      <div class="realm-buttons"><button class="button primary small wide" data-action="realm-enable" data-key="${realm.key}" ${busy ? 'disabled' : ''}>${icon('play')}${esc(t('realms.activate', 'Switch on'))}</button></div>
      <footer class="realm-more"><small class="muted">${esc(t('realms.nothingDeleted', 'Nothing is deleted: switch it on whenever you want.'))}</small></footer>
    </article>`;
  }
  const on = ['running', 'starting'].includes(realm.state) || working;
  const stat = (label, value, hint, of) => `<div${hint ? ` title="${esc(hint)}"` : ''}><dt>${esc(label)}</dt><dd>${value === null || value === undefined || value === '' ? '—' : esc(String(value))}${of ? `<small>/${esc(String(of))}</small>` : ''}</dd></div>`;
  const stats = `<dl class="realm-stats">${stat(t('realms.players', 'Players'), realm.state === 'running' ? realm.players : null)}${realm.state === 'running' && Number.isFinite(realm.online) ? stat(t('realms.bots', 'Bots'), realm.online, t('realms.botsHint', 'Bots in game now, out of the number set for this realm.'), realm.bots) : stat(t('realms.bots', 'Bots'), realm.bots)}${stat(t('realms.port', 'Port'), realm.worldPort, t('realms.portHint', 'The game reaches this realm on this port (the realm list gives it to the client).'))}</dl>`;
  const startStop = on
    ? `<button class="button ghost small" data-action="realm-stop" data-key="${realm.key}" ${busy || realm.state === 'starting' ? 'disabled' : ''}>${icon('pause')}${esc(t('realms.stop', 'Stop'))}</button>`
    : `<button class="button primary small" data-action="realm-start" data-key="${realm.key}" ${busy || realm.state === 'queued' ? 'disabled' : ''}>${icon('play')}${esc(t('realms.start', 'Start'))}</button>`;
  const more = realm.main
    ? `<label class="realm-auto"><input type="checkbox" data-action="realm-auto" data-key="coa" ${realm.autostart !== false ? 'checked' : ''}>${esc(t('realms.autostart', 'Start with the server'))}</label><small class="muted">${esc(t('realms.mainFoot', 'Its settings are the base of the other realms.'))}</small>`
    : `<label class="realm-auto"><input type="checkbox" data-action="realm-auto" data-key="${realm.key}" ${realm.autostart ? 'checked' : ''}>${esc(t('realms.autostart', 'Start with the server'))}</label>
       <span class="realm-links"><button class="link-button" data-action="realm-logs" data-key="${realm.key}">${icon('book')}${esc(t('realms.logs', 'Logs'))}</button>
       <button class="link-button" data-action="realm-purge" data-key="${realm.key}" ${on || busy ? 'disabled' : ''} title="${esc(t('realms.purgeHint', 'Deletes the random bots of this realm only; they are made again at its next start.'))}">${icon('refresh')}${esc(t('realms.purge', 'New bots'))}</button>
       <button class="link-button" data-action="realm-disable" data-key="${realm.key}" ${busy ? 'disabled' : ''} title="${esc(t('realms.disableHint', 'Stops it and takes it out of the realm list; nothing is deleted.'))}">${icon('close')}${esc(t('realms.disable', 'Switch off'))}</button></span>`;
  return `<article class="realm-card realm-${realm.key}${on ? ' on' : ''}">${head}${stats}
    <div class="realm-buttons">${startStop}<button class="button ghost small" data-action="realm-settings" data-key="${realm.key}">${icon('settings')}${esc(t('realms.settings', 'Settings'))}${realm.changed ? `<em class="count" title="${esc(t('realms.ownHint', 'Settings changed for this realm only'))}">${realm.changed}</em>` : ''}</button><button class="button ghost small" data-action="realm-console" data-key="${realm.key}" ${realm.state === 'running' ? '' : 'disabled'}>${icon('terminal')}${esc(t('realms.console', 'Console'))}</button></div>
    <footer class="realm-more">${more}</footer>
  </article>`;
}

function realmsPage() {
  const head = `<div class="page-head"><div><p class="eyebrow">${esc(t('server.eyebrow', 'On this PC'))}</p><h1>${esc(t('tab.realms', 'Realms'))} <span class="pill warn">${esc(t('realms.beta', 'Beta'))}</span></h1></div></div>`;
  if (!App.state.server?.path) return `<div class="page classic">${head}${emptyState('globe', t('modules.noServer', 'No server yet'), t('modules.noServerText', 'Install or choose your server first.'))}</div>`;
  const r = App.state.realms;
  if (!r) return `<div class="page classic">${head}${skeleton(3)}</div>`;
  if (r.error) return `<div class="page classic">${head}${emptyState('warning', t('realms.error', 'The realms cannot be read'), r.error)}</div>`;
  return `<div class="page classic realms-page">${head}
    <p class="realms-lead">${esc(t('realms.lead', 'One server, several ways to play. Each realm has its own characters, bots and settings; the game accounts are shared: log in once, then pick the realm in the realm list of the game.'))}</p>
    <div class="realm-cards">${realmList().map(realm => realmCard(realm, App.state.realmBusy || '')).join('')}</div>
  </div>`;
}

App.pages.realms = {
  render: realmsPage,
  mount() {
    markSeen('realms');
    if (!App.state.server) App.api.serverInfo().then(info => { App.state.server = info; App.refresh('realms'); loadRealms(); }).catch(() => {});
    else if (!App.state.realmsFresh) { App.state.realmsFresh = true; loadRealms(); }
  },
};

// The page follows the realms while it is shown (states, players), without redrawing during an action.
setInterval(() => { if (App.state.tab === 'realms' && !App.state.realmBusy && App.state.server?.path && !$('#dialog').open) loadRealms(); }, 8000);
// Known once a server is chosen, so the tab shows up (or not) without visiting a page first.
// Read again every 15 s while the tab is hidden or unreadable (a server updated to 2.6, another server chosen):
// the tab appears without restarting the launcher.
let realmsCheckedAt = 0;
let realmsRoot = '';
setInterval(() => {
  const root = App.state.server?.path;
  if (!root || App.state.realmBusy) return;
  const stale = !App.state.realms || realmsRoot !== root || ((!App.state.realms.available || App.state.realms.error) && Date.now() - realmsCheckedAt > 15000);
  if (!stale) return;
  realmsCheckedAt = Date.now();
  realmsRoot = root;
  loadRealms();
}, 2000);

async function realmAction(key, work, kind = '') {
  App.state.realmBusy = key;
  App.state.realmBusyKind = kind;
  App.refresh(App.state.tab);
  try { await work(); }
  finally { App.state.realmBusy = ''; App.state.realmBusyKind = ''; await loadRealms(); }
}

Object.assign(App.actions, {
  'realm-create': button => guard(async () => {
    const key = button.dataset.key;
    const name = realmTitle(key);
    if (!await confirmDialog({ title: t('realms.activateTitle', 'Switch the {name} realm on?', { name }), body: esc(t('realms.activateBody', 'The first time, its two databases are made (its characters and its bots, about a minute) and it is added to the realm list of the game. Your Conquest of Azeroth characters and bots are not touched. You can switch it off again at any time.')), confirm: t('realms.activate', 'Switch on') })) return;
    const off = App.api.onRealmsProgress(line => { App.state.realmLine = line; App.refresh('realms'); });
    try { await realmAction(key, () => App.api.realmsCreate(key, {})); }
    finally { off(); App.state.realmLine = ''; }
    toast(t('realms.activated', '{name} is on: start it, then pick it in the realm list of the game.', { name }), 'success');
  }, button),
  'realm-start': button => guard(async () => {
    const key = button.dataset.key;
    if (key !== 'coa') {
      const memory = await App.api.realmsMemory(key).catch(() => null);
      if (memory && !memory.enough && !await confirmDialog({ title: t('realms.memoryTitle', 'Not much free memory'), body: esc(t('realms.memoryBody', '{name} needs about {need} GB with its bots, and {free} GB are free. The whole PC may slow down. Stop another realm or lower its bots first, or start anyway.', { name: realmTitle(key), need: (memory.need / 1024).toFixed(1), free: (memory.free / 1024).toFixed(1) })), confirm: t('realms.startAnyway', 'Start anyway'), danger: true })) return;
    }
    toast(t('realms.startingLong', 'Starting {name}… the first start with bots takes a few minutes.', { name: realmTitle(key) }));
    await realmAction(key, () => App.api.realmsStart(key));
    toast(t('realms.started', '{name} is running.', { name: realmTitle(key) }), 'success');
  }, button),
  'realm-stop': button => guard(async () => {
    const key = button.dataset.key;
    await realmAction(key, () => App.api.realmsStop(key), 'stop');
    toast(t('realms.stopped2', '{name} is stopped.', { name: realmTitle(key) }), 'success');
  }, button),
  'realm-auto': input => guard(async () => { await App.api.realmsOptions(input.dataset.key, { autostart: input.checked }); await loadRealms(); }),
  'realm-logs': button => guard(() => App.api.realmsOpenLogs(button.dataset.key)),
  'realm-purge': button => guard(async () => {
    const key = button.dataset.key;
    if (!await confirmDialog({ title: t('realms.purgeTitle', 'Recreate the bots of {name}?', { name: realmTitle(key) }), body: esc(t('realms.purgeBody', 'The random bots of this realm are deleted (players are not touched); they are made again at its next start. The bots of the other realms stay.')), confirm: t('realms.purge', 'New bots'), danger: true })) return;
    const release = holdDialog(t('server.purgingTitle', 'Recreating the bots'), t('realms.purgingLong', 'Recreating the bots of {name}: the realm starts, deletes them and stops by itself (a few minutes).', { name: realmTitle(key) }));
    try { await realmAction(key, () => App.api.realmsPurge(key)); } finally { release(); }
    toast(t('realms.purged', 'Done: the bots come back at the next start.'), 'success');
  }, button),
  'realm-disable': button => guard(async () => {
    const key = button.dataset.key;
    const name = realmTitle(key);
    if (!await confirmDialog({ title: t('realms.disableTitle', 'Switch {name} off?', { name }), body: esc(t('realms.disableBody', 'Its world stops and it leaves the realm list of the game. Its characters, its bots and its settings are kept: switch it on again whenever you want.')), confirm: t('realms.disable', 'Switch off') })) return;
    await realmAction(key, () => App.api.realmsDisable(key, true));
    toast(t('realms.disabledDone', '{name} is switched off. Nothing was deleted.', { name }), 'success');
  }, button),
  'realm-enable': button => guard(async () => {
    const key = button.dataset.key;
    await realmAction(key, () => App.api.realmsDisable(key, false));
    toast(t('realms.enabledDone', '{name} is back in the realm list: start it when you want.', { name: realmTitle(key) }), 'success');
  }, button),
  'realm-settings': button => { App.state.confRealm = button.dataset.key; App.state.pending = {}; App.state.conf = null; App.state.srvTab = 'settings'; App.go('server'); loadConf(); },
  'realm-console': button => { App.state.consoleRealm = button.dataset.key; App.go('console'); },
  'conf-realm': button => {
    if (Object.keys(App.state.pending).length) { toast(t('realms.saveFirst', 'Save or discard your changes first.'), 'error'); return; }
    App.state.confRealm = button.dataset.key; App.state.conf = null; App.refresh('server'); loadConf();
  },
  'console-realm': button => { App.state.consoleRealm = button.dataset.key; App.render(); },
});

// ---------------------------------------------------------------- modules of a realm (Modules tab, realm picked)
const REALM_MODULES = {
  bots: { art: 'squidbots', icon: 'bot', title: () => 'SquidBots', textKey: 'realms.modBots', text: 'The random bots and the group AI of this realm. Off, the realm is for players only.' },
  ahbot: { art: 'ahbot', icon: 'coin', title: () => t('modules.ahbot', 'Auction house'), textKey: 'realms.modAhbot', text: 'Gavelgrin keeps the auction house of this realm busy; he gets his own character in this realm.' },
  manastorm: { art: 'manastorm', icon: 'play', title: () => 'Manastorm Endless', textKey: 'realms.modManastorm', text: 'Endless runs of Manastorm rooms. Every player needs the updated client files.' },
  rotation: { art: 'rotation', icon: 'refresh', title: () => t('modules.rotation', 'Rotation assistant'), textKey: 'realms.modRotation', text: 'One button that casts the next spell of your rotation.' },
  multirace: { art: '', icon: 'user', title: () => 'Multirace', textKey: 'realms.modMultirace', text: 'More playable races.' },
};

async function loadRealmModules(key) {
  try { App.state.realmModules = { key, list: await App.api.realmsModules(key) }; } catch (error) { App.state.realmModules = { key, error: translateError(error.message) }; }
  if (App.state.tab === 'modules') App.refresh('modules');
}

function realmModulesView(key) {
  const data = App.state.realmModules;
  if (!data || data.key !== key) { loadRealmModules(key); return skeleton(3); }
  if (data.error) return emptyState('warning', t('modules.error', 'The modules cannot be read'), data.error);
  const realm = realmList().find(item => item.key === key);
  const running = ['running', 'starting'].includes(realm?.state);
  const shown = data.list.filter(module => module.origin !== 'mode');
  const absent = data.list.filter(module => module.origin === 'mode').map(module => REALM_MODULES[module.id].title());
  const stopFirst = running ? `<p class="module-note">${icon('info')}${esc(t('realms.modStop', 'Stop this realm to switch a module: it is read when the realm starts.'))}</p>` : '';
  const cards = shown.map(module => {
    const info = REALM_MODULES[module.id];
    const tag = module.origin === 'own'
      ? `<span class="origin own">${esc(t('realms.fromRealm', 'This realm only'))}<button class="link-button" data-action="realm-module" data-key="${key}" data-id="${module.id}" data-state="coa" ${running ? 'disabled' : ''}>${icon('refresh')}${esc(t('realms.backToCoa', 'As CoA ({value})', { value: module.coaOn ? t('realms.on', 'on') : t('realms.off', 'off') }))}</button></span>`
      : `<span class="origin coa">${esc(t('realms.fromCoa', 'As CoA'))}</span>`;
    return `<section class="panel module-card">${info.art ? moduleArt(info.art) : ''}<header><h2>${icon(info.icon)}${esc(info.title())}</h2><button class="switch ${module.on ? 'on' : ''}" data-action="realm-module" data-key="${key}" data-id="${module.id}" data-state="${module.on ? 'off' : 'on'}" ${running ? 'disabled' : ''} role="switch" aria-checked="${module.on}"><span></span></button></header>
      <p class="muted">${esc(t(info.textKey, info.text))}</p>
      <p class="module-origin">${tag}</p>${stopFirst}
    </section>`;
  }).join('');
  const note = absent.length ? `<p class="modules-foot">${icon('info')} ${esc(t('realms.modAbsent', 'Not in this game mode: {list}.', { list: absent.join(', ') }))}</p>` : '';
  return `<div class="grid-2 modules realm-mods">${cards}</div>${note}`;
}

// The realm picker and its banner above the modules (only when a realm exists besides CoA).
function modulesRealmHead(key) {
  if (createdRealms().length < 2) return '';
  return realmPicker(key, 'modules-realm') + realmBanner(key, key === 'coa'
    ? t('realms.modCoa', 'The modules of Conquest of Azeroth. The other realms follow them, except the ones they change.')
    : t('realms.modRealm', 'The modules of this realm. "As CoA" follows Conquest of Azeroth; switch one and it becomes this realm\'s own.'));
}

Object.assign(App.actions, {
  'modules-realm': button => { App.state.modRealm = button.dataset.key; App.state.realmModules = null; App.refresh('modules'); },
  'realm-module': button => guard(async () => {
    const { key, id, state } = button.dataset;
    const list = await App.api.realmsModule(key, id, state);
    App.state.realmModules = { key, list };
    toast(t('modules.restartNeeded', 'Saved: it applies at the next start of the server.'), 'success');
    App.refresh('modules');
    loadRealms();
  }, button),
});

// "Start the server" could not start a realm: say which and why (the card also says it for the memory).
App.api.onRealmsFailed?.(failed => {
  for (const item of failed || []) {
    const name = item.key ? realmTitle(item.key) : t('tab.realms', 'Realms');
    toast(item.error === 'memory' ? t('realms.failedMemory', '{name} was not started: not enough free memory.', { name }) : t('realms.failed', '{name} did not start: {error}', { name, error: translateError(item.error) }), 'error');
  }
  loadRealms();
});
