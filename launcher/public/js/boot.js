'use strict';
// Start-up, the click handler, live events from the main process, and the screenshot tour.

document.addEventListener('click', event => {
  if (!event.target.closest('.split-button')) { const menu = $('#play-menu'); if (menu) menu.hidden = true; }
  const target = event.target.closest('button, [data-action]');
  if (!target || target.disabled) return;
  const data = target.dataset;
  if (data.window) { App.api.window(data.window); return; }
  if (data.tab) { App.go(data.tab); if (data.tab === 'server' && App.state.server) { App.api.serverInfo().then(info => { App.state.server = info; App.refresh('server'); loadServerTab(); }).catch(() => {}); } return; }
  if (data.action === 'dialog-close') { dialog.close(); return; }
  if (data.action && App.actions[data.action]) App.actions[data.action](target, event);
});
$('#dialog').addEventListener('click', event => { if (event.target.id === 'dialog') dialog.close(); });
$('#dialog').addEventListener('close', () => { if (!$('#dialog').open) $('#dialog-body').innerHTML = ''; });

function subscribe() {
  const api = App.api;
  api.onClientProgress(progress => {
    App.state.client = { ...App.state.client, progress };
    if (App.state.tab !== 'play' || $('#dialog').open) return;
    const line = $('#status-line');
    const bar = $('.hero .progress span');
    if (line && bar && BUSY.includes(progress.phase)) {
      line.textContent = progressText(progress);
      const { pct } = progressBar(progress);
      bar.dataset.pct = pct ?? 30;
      applyBars($('.hero'));
      const label = $('.hero-progress > span');
      if (label) label.textContent = pct === null ? '' : `${pct}%`;
    } else App.refresh('play');
  });
  api.onServerProgress(progress => { if (App.state.server) { App.state.server.progress = progress; patchServer(); } });
  api.onBotsProgress(progress => { App.state.botsProgress = progress; patchServer(); });
  let importDrawn = 0;
  api.onImport(progress => {
    App.state.importProgress = progress.phase === 'idle' ? null : progress;
    if (Date.now() - importDrawn < 250 && progress.phase !== 'idle') return;
    importDrawn = Date.now();
    if (App.state.tab === 'server' && App.state.srvTab === 'install' && !$('#dialog').open) App.refresh('server');
  });
  api.onServices(services => {
    if (!App.state.server) return;
    const changed = JSON.stringify(services) !== JSON.stringify(App.state.server.services);
    App.state.server.services = services;
    if (changed && App.state.srvTab === 'services') patchServer();
    if (changed && App.state.tab === 'home' && !$('#dialog').open) App.render();
  });
  api.onUpgrade(update => {
    const s = App.state;
    if (update.line !== undefined) appendLog(update.line);
    if (update.step) s.upgradeStep = update.step;
    if (UPGRADE_STEPS.some(([id]) => id === update.step)) s.upgradeLastStep = update.step;
    if (update.running !== undefined) s.upgradeRunning = update.running;
    if (update.step && s.tab === 'server' && s.srvTab === 'upgrade') {
      const current = $('.stepper');
      if (current) current.outerHTML = stepper(); else App.refresh('server');
    }
  });
  api.onServerTask(task => {
    App.state.task = task.phase === 'done' ? null : task;
    const line = $('.task-line span');
    if (line && App.state.task) line.textContent = taskText(App.state.task);
    else if (App.state.srvTab === 'backups' && App.state.tab === 'server' && !$('#dialog').open) App.refresh('server');
  });
  api.onAddonProgress(({ done, total }) => { if (total) toast(t('addon.downloading', 'Downloading addons… {pct}%', { pct: Math.floor((100 * done) / total) })); });
  api.onUpdateState(state => { App.state.update.state = state; if (App.state.tab === 'home' && !$('#dialog').open) App.render(); });
  api.onUpdateEvent(event => onUpdateEvent(event));
  api.onFeed(feed => { App.state.feed = feed; if (['home', 'server'].includes(App.state.tab) && !$('#dialog').open) App.render(); });
  api.onLauncherUpdate(status => {
    App.state.launcherUpdate = status;
    // Only the bar is redrawn: the page underneath (a form being filled…) is left alone.
    const bar = $('#launcher-banner');
    if (bar) bar.innerHTML = launcherBanner();
    if (status.phase === 'downloaded') toast(t('launcher.ready', 'A new launcher is ready: it installs when you restart.'), 'success');
  });
  api.onGameExit(async () => { App.state.client = await api.clientInfo(); App.refresh('play'); });
}

// Screenshot tour driven by the main process: tab names, click:<selector>, lang:<code>, dialog:settings, wait.
App.smoke = step => {
  if (step === 'wait') return;
  // Screenshot tours: show the launcher-update bar as if a new launcher were downloading / ready.
  if (step.startsWith('launcher:')) { App.state.launcherUpdate = { phase: step.slice(9), version: '9.9.9', percent: 56 }; const bar = $('#launcher-banner'); if (bar) bar.innerHTML = launcherBanner(); return; }
  if (step.startsWith('click:')) { $(step.slice(6))?.click(); return; }
  if (step.startsWith('fill:')) {
    const [selector, value] = step.slice(5).split('::');
    const input = $(selector);
    if (input) {
      if (input.type === 'checkbox') input.checked = value === '1'; else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return;
  }
  if (step.startsWith('submit:')) { $(step.slice(7))?.requestSubmit(); return; }
  if (step.startsWith('lang:')) { loadLocale(step.slice(5)).then(() => App.render()); return; }
  if (step === 'dialog:settings') { showSettings(); return; }
  dialog.close();
  if (step.startsWith('srv:')) { App.state.srvTab = step.slice(4); App.go('server'); loadServerTab(true); return; }
  App.go(step);
};

(async function boot() {
  $('#settings-button').innerHTML = icon('settings');
  $('.brand').insertAdjacentHTML('beforeend', LOGO);
  $('#settings-button').title = 'Settings';
  $('#win-min').innerHTML = icon('minimize');
  $('#win-max').innerHTML = icon('maximize');
  $('#win-close').innerHTML = icon('close');
  const data = await App.api.bootstrap();
  Object.assign(App.state, { config: data.config, settings: data.settings, client: data.client, version: data.version, launcherUpdate: data.launcherUpdate });
  applyTheme(data.settings.theme);
  await loadLocale(data.settings.language);
  $('#settings-button').title = t('settings.title', 'Settings');
  document.documentElement.lang = data.settings.language;
  $('#app-name').textContent = data.config.appName;
  document.title = data.config.appName;
  Ocean.start($('#ocean'), data.settings.reduceMotion || data.smoke || matchMedia('(prefers-reduced-motion: reduce)').matches);
  subscribe();
  App.state.tab = data.config.edition === 'server' ? 'home' : data.settings.startPage === 'server' && data.config.server ? 'server' : 'play';
  App.render();
  document.body.classList.add('ready');
  probeRealm();
  setInterval(probeRealm, 30 * 1000);
  if (isClassic() && data.config.edition !== 'server') loadNews();
  // Compare the game with its latest release at start (nothing is downloaded without asking).
  if (data.config.edition === 'server') { refreshAddon(true); App.api.updateRefresh().then(state => { if (state) { App.state.update.state = state; if (App.state.tab === 'home') App.render(); } }).catch(() => {}); App.api.notes().then(notes => { App.state.notes = notes; if (App.state.tab === 'home') App.render(); }).catch(() => {}); App.api.updateState().then(state => { if (!App.state.update.state) App.state.update.state = state; if (App.state.tab === 'home') App.render(); }).catch(() => {}); loadNews(); App.api.feed().then(feed => { App.state.feed = feed; if (App.state.tab === 'home') App.render(); }).catch(() => {}); }
  else if (data.client.installed && data.config.game.hasClient) checkClient(false, true).catch(error => { App.state.client.progress = { phase: 'error', message: error.message }; App.refresh('play'); });
  if (data.config.edition !== 'server' && data.config.game.hasAddons && (data.settings.autoCheckAddons || data.client.installed)) loadAddons();
  if (data.config.server) App.api.serverInfo().then(info => { App.state.server = info; if (info.installed) checkServer(false, true).catch(() => {}); refreshUpdates(); }).catch(() => {});
  // New releases are looked for every 30 minutes (only the small signed manifests are read).
  setInterval(refreshUpdates, 30 * 60 * 1000);
})().catch(error => {
  document.body.classList.add('ready');
  $('#view').innerHTML = emptyState('warning', t('boot.failed', 'The launcher could not start'), error.message);
});
