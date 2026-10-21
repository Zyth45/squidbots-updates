'use strict';
// Server edition: the Home page (state of the server, start / stop, core and bots at a glance) and the
// Verification page (every check on the core, the bots, the services, the database and the files).

const isServerEdition = () => App.state.config?.edition === 'server';

function newsCards(list) {
  const areaInfo = { client: ['play', t('classic.newsGame', 'Game')], server: ['layers', t('classic.newsServer', 'Server')], bots: ['bot', t('classic.newsBots', 'Bots')] };
  return list.map(item => `<article class="news-card ${esc(item.area)}" data-action="news-open" data-area="${esc(item.area)}" tabindex="0" role="button"><div class="news-art">${icon(areaInfo[item.area]?.[0] || 'info')}</div><div class="news-text"><small>${item.publishedAt ? esc(new Date(item.publishedAt).toLocaleDateString(I18N.lang)) : ''} · ${esc(areaInfo[item.area]?.[1] || item.area)}</small><strong>${esc(item.version)}</strong><p>${esc(item.notes.join(' · ') || t('classic.noNotes', 'No notes for this release.'))}</p></div></article>`).join('');
}

// ---------------------------------------------------------------- the checks, in words
const CHECK_TEXT = {
  'core.installed': {
    ok: ['Core installed', 'Release {version}.'],
    bad: ['This folder is not a complete repack', 'Missing: {missing}. Install the server or choose its folder.'],
  },
  'core.update': {
    ok: ['Core up to date', 'Release {installed}.'],
    warn: ['New core available', '{latest} (installed: {installed}). Move to it from New version, or update in place.'],
    info: ['Core release not checked', '{error}{latest}'],
  },
  'core.files': {
    ok: ['Core files intact', 'Every file matches the signed release.'],
    warn: ['Core files changed or missing', '{files} file(s) differ from the release. Repair puts them back (your database and settings are kept).'],
    info: ['Core files not checked', '{error}'],
  },
  'bots.installed': {
    ok: ['CoA Bots installed', 'Version {version}, built for {builtFor}.'],
    info: ['CoA Bots not installed', 'The server runs without bots. Install them from Management.'],
  },
  'bots.update': {
    ok: ['Bots up to date', 'Release {installed}.'],
    warn: ['New bots available', '{latest} (installed: {installed}).'],
    info: ['Bots release not checked', '{error}'],
  },
  'bots.match': {
    ok: ['Bots made for this core', 'The bot worldserver was built from this very core ({release}).'],
    bad: ['Bots made for another core', 'The bots were built for {release}, not for the core installed here. Update the bots, or the core, so both match.'],
    info: ['Bots and core not compared', 'This bots package does not say which core it was built for.'],
  },
  'bots.files': {
    ok: ['Bot files intact', 'Every file matches the signed release.'],
    warn: ['Bot files changed or missing', '{files} file(s) differ. Updating the bots puts them back (your bot settings are kept).'],
    info: ['Bot files not checked', '{error}'],
  },
  'service.running': { ok: ['{name} running', 'Port {port}{variant}.'] },
  'service.stopped': { info: ['{name} stopped', 'Port {port}.'] },
  'service.foreign': { bad: ['{name}: port {port} taken by another program', '{other}. Another repack (or program) uses this port: stop it, then start this server.'] },
  'db.own': {
    ok: ['MySQL is this server\'s own', 'The database answering on this port is the one of this folder.'],
    bad: ['MySQL of another folder', '{error}'],
  },
  'db.updates': {
    ok: ['Database updates applied', '{applied} update(s) applied at the last start, none failed.'],
    bad: ['Database updates failed', '{failed}'],
  },
  crashes: {
    ok: ['No crash this week', 'No crash report in the last 7 days.'],
    warn: ['Crashes this week', '{count} crash(es) in the last 7 days. "Put away" moves their reports to Crashes\\archive.'],
  },
  'backup.age': {
    ok: ['Recent backup', 'Last backup {days} day(s) ago.'],
    warn: ['No recent backup', 'Make a backup before any update: one click, a few seconds.'],
  },
  disk: {
    ok: ['Enough disk space', '{free} free.'],
    warn: ['Little disk space left', 'Only {free} free: updates and backups need room.'],
  },
  // ---- known problems of the repacks
  'path.ok': { ok: ['Good place for the server', '{path}'] },
  'path.protected': { warn: ['Server in a protected folder', '{path}: Windows may stop the server writing its logs and database there. Move it to C:\\Games or similar.'] },
  'path.ascii': { warn: ['Accents or special letters in the path', '{path}: MySQL may refuse a data folder with such letters. A plain path is safer.'] },
  'data.maps': {
    ok: ['Maps and game data present', 'Data\\maps, vmaps, mmaps and dbc are there.'],
    bad: ['Game data missing', 'Empty or missing: {missing}. The world cannot start without them: repair the core.'],
  },
  'runtime.python': { ok: ['Python of the repack present', 'Runtime\\python runs the repack scripts.'], bad: ['Python of the repack missing', 'Runtime\\python\\python.exe is missing: repair the core.'] },
  'conf.updates': {
    ok: ['The server updates its databases', 'Updates.EnableDatabases = 7 and the SQL of this core are found at each start.'],
    bad: ['Database updates are off', 'Updates.EnableDatabases = {value}: the SQL of this core is never applied (errors, crashes). The fix sets 7 in the template.'],
  },
  'conf.dist': {
    ok: ['Every module has its settings', 'No module runs on missing settings.'],
    bad: ['Module settings missing', '{count} module(s) with only a .conf.dist: {files}. Without coa.conf the client is disconnected. The fix copies each .dist (nothing is overwritten).'],
  },
  'bots.dbupdates': {
    ok: ['Bots database left to the installer', 'Playerbots.Updates.EnableDatabases = 0, as it must be.'],
    bad: ['The server would update the bots database', 'Playerbots.Updates.EnableDatabases = {value}: the server with bots does not start. The fix sets 0.'],
  },
  'bots.conf': {
    ok: ['Bots connected to this database', 'playerbots.conf has the port and password of this server.'],
    bad: ['Bot settings not filled in', 'playerbots.conf still has <MYSQL_PORT> or <APP_PASSWORD>: run the bots installer again.'],
  },
  'bots.whisper': { warn: ['Bots whisper every quest step', 'AiPlayerbot.BotsWhisperPublic = 1 (old default of 1.2/1.3). The fix sets 0.'] },
  'bots.leftover': { bad: ['A 1.5 file left in the 1.6 bots', 'Database\\world\\updates of 1.5 makes the 1.6 installer stop ("Replace … oldValue"). The fix removes that folder; then install the bots again.'] },
  'bots.ram': {
    ok: ['Enough memory for the bots', '{bots} bots need about {neededText} of {totalText}.'],
    warn: ['Too many bots for this PC', '{bots} bots need about {neededText} and this PC has {totalText}: lower MinRandomBots and MaxRandomBots in the server settings.'],
  },
  'bots.accounts': {
    ok: ['Bot accounts as expected', '{accounts} RNDBOT accounts.'],
    warn: ['Bot accounts out of step', '{accounts} RNDBOT accounts for {expected} expected: old bots are left. Recreate the bots (your characters stay).'],
  },
  'bots.outland': {
    ok: ['No level-60 bot in Outland', ''],
    warn: ['Level-60 bots in Outland', '{count} bot(s) under level 61 in Outland. Nothing to do: they go back to a zone of their level at their next teleport.'],
    info: ['A few low-level bots in Outland', '{count} bot(s) under level 61 in Outland. Nothing to do: they go back to a zone of their level at their next teleport.'],
  },
  'bots.tables': {
    ok: ['Bot database complete', '{count} playerbots tables.'],
    bad: ['Bot database empty', 'acore_playerbots has none of its playerbots tables: the world with bots stops at "Could not prepare statements of the Playerbots database". Install the bots again (server stopped); your characters are not touched.'],
  },
  'mysql.folders': {
    ok: ['Database folder clean', 'Only the server databases in mysql\\data.'],
    bad: ['Foreign folder in the database', '{folders} in mysql\\data can stop MySQL. Move it out of the server folder.'],
  },
  'mysql.tablespace': { bad: ['Database files of two installs mixed', '"Multiple files found for the same tablespace ID": a full repack was unpacked over an old one. Install in an empty folder and bring the players over.'] },
  'world.bots': { ok: ['The world runs with the bots', ''], info: ['The world runs without the bots', 'Started from Core\\ instead of CoA-Bots\\Core\\: no bots, .playerbots unknown. Stop and start from the launcher.'] },
  'process.old': { bad: ['{name} from before the update still runs', 'Players reach the old program (black screen, realm list loop). Restart it.'] },
  ra: { ok: ['Remote console answers', 'Port {port}.'], warn: ['Remote console silent', 'Port {port} is not answering while the world runs: accounts cannot be made from the launcher.'] },
  'realm.flag': {
    ok: ['Realm shown online', ''],
    bad: ['Realm shown offline', 'realmlist.flag = {flag}. The fix sets 0.'],
  },
  'bots.which': { warn: ['Two playerbots.conf, only one is read', 'With the bots the server reads CoA-Bots\\Core\\configs\\modules\\playerbots.conf. The one in Core\\configs\\modules is ignored: change the bot settings from the Server settings page.'] },
  'bots.missingkeys': {
    ok: ['Bot settings complete', 'playerbots.conf has every key of this version.'],
    warn: ['Bot settings of an older version', '{count} key(s) of this version are missing ({keys}…): they run at their defaults. The fix adds them with their default values (a copy is kept).'],
  },
  'coa.remote': { info: ['Only this PC can play', 'CoA.AllowRemoteClients = 0: players on other PCs are refused even with the right address.'] },
  'logs.size': {
    ok: ['Logs of a normal size', ''],
    warn: ['Very large logs', '{files}. Stop the server, then delete or move them. Logger.playerbots = {level} in the settings.'],
  },
  'conf.missing': {
    info: ['{count} setting(s) not in the files, no effect', '{keys}…: the server uses its defaults, the same as in the modules. Only the logs mention it.'],
    warn: ['{count} missing setting(s) fill the log', '{keys}…: one of them is asked for up to {repeats} times, so Server.log keeps growing. Module settings files are not where the server reads them: "Fix" (when shown) copies the ones this repack has; the others come with the next update. Nothing changes in game: the defaults already apply.'],
  },
  'mysql.foreign': { warn: ['MySQL of another folder running', '{file}: it may hold the port or the database files. Stop that server before starting, updating or moving players.'] },
  'realm.address': { info: ['Realm address: {address}', 'Players on another PC need the LAN or public address (and the firewall open on 3724 and 8085).'] },
};

const ACTIONS = {
  install: ['srv-tab', 'install', 'Install'],
  check: ['verify-run-in', 'install:server-check', 'Check'],
  upgrade: ['srv-tab', 'upgrade', 'New version'],
  repair: ['verify-run-in', 'install:server-repair', 'Repair'],
  'bots-install': ['verify-run-in', 'install:bots-install', 'Update'],
  start: ['service-start-all', '', 'Start'],
  restart: ['srv-tab', 'services', 'Services'],
  backup: ['backup-create', '', 'Back up now'],
  'crashes-archive': ['crashes-archive', '', 'Put away'],
};

function checkText(check) {
  const entry = CHECK_TEXT[check.id]?.[check.state] || [check.id, ''];
  const data = { ...check.data };
  if (data.variant) data.variant = ` · ${data.variant}`;
  if (typeof data.free === 'number') data.free = formatBytes(data.free);
  if (typeof data.needed === 'number') { data.neededText = formatBytes(data.needed); data.totalText = formatBytes(data.total); }
  for (const key of ['error', 'latest']) if (data[key] === undefined) data[key] = '';
  return [t(`check.${check.id}.${check.state}.title`, entry[0], data), t(`check.${check.id}.${check.state}.text`, entry[1], data)];
}

const GROUPS = [['core', 'layers', 'Core'], ['bots', 'bot', 'Bots'], ['services', 'play', 'Services'], ['settings', 'settings', 'Settings'], ['database', 'database', 'Database'], ['setup', 'folder', 'Install'], ['health', 'shield', 'Health']];

function verifyView() {
  const v = App.state.verify;
  const running = App.state.verifying;
  const head = `<div class="verify-head"><div class="verify-score ${v ? (v.summary.bad ? 'bad' : v.summary.warn ? 'warn' : 'ok') : ''}">${v ? (v.summary.bad ? icon('warning') : v.summary.warn ? icon('info') : icon('check')) : icon('shield')}<div><strong>${esc(!v ? t('verify.never', 'Not checked yet') : v.summary.bad ? t('verify.bad', '{n} problem(s) to fix', { n: v.summary.bad }) : v.summary.warn ? t('verify.warn', '{n} point(s) to look at', { n: v.summary.warn }) : t('verify.ok', 'All good'))}</strong><small>${esc(v ? t('verify.when', 'Checked at {time}{deep}', { time: new Date(v.at).toLocaleTimeString(I18N.lang), deep: v.deep ? t('verify.withFiles', ', files included') : '' }) : t('verify.hint', 'A quick check reads the versions, the services and the logs.'))}</small></div></div>
    <div class="button-row"><button class="button ghost" data-action="verify-copy" title="${esc(t('verify.copyHint', 'For the support Discord: the versions of the core and the bots'))}">${icon('book')}${esc(t('verify.copy', 'Copy the versions'))}</button><button class="button ghost" data-action="verify-run" ${running ? 'disabled' : ''}>${icon('refresh')}${esc(t('verify.quick', 'Check again'))}</button><button class="button primary" data-action="verify-deep" ${running ? 'disabled' : ''}>${icon('shield')}${esc(t('verify.deep', 'Check every file'))}</button></div></div>`;
  if (!v) return `<div class="page verify">${head}${running ? `<div class="task-line">${icon('refresh')}<span>${esc(t('verify.running', 'Checking…'))}</span></div>` : ''}</div>`;
  const groups = GROUPS.map(([id, iconName, label]) => {
    const list = v.checks.filter(check => check.group === id);
    if (!list.length) return '';
    return `<section class="panel verify-group"><header><h2>${icon(iconName)}${esc(t(`verify.group.${id}`, label))}</h2></header>${list.map(check => {
      const [title, text] = checkText(check);
      const fix = check.action?.startsWith('fix:') ? check.action.slice(4) : '';
      const action = !fix && check.action && check.state !== 'ok' ? ACTIONS[check.action] : null;
      const button = fix ? `<button class="button primary small" data-action="verify-fix" data-id="${esc(fix)}">${icon('check')}${esc(t('verify.fix', 'Fix'))}</button>`
        : action ? `<button class="button ${check.state === 'ok' || check.state === 'info' ? 'ghost' : 'primary'} small" data-action="${action[0]}" ${action[1] ? `data-id="${action[1]}"` : ''}>${esc(check.id === 'bots.installed' ? t('verify.action.bots-new', 'Install the bots') : t(`verify.action.${check.action}`, action[2]))}</button>` : '';
      return `<div class="check ${check.state}"><span class="check-light"></span><div><strong>${esc(title)}</strong>${text ? `<small>${esc(text)}</small>` : ''}</div>${button}</div>`;
    }).join('')}</section>`;
  }).join('');
  return `<div class="page verify">${head}${running ? `<div class="task-line">${icon('refresh')}<span>${esc(t('verify.running', 'Checking…'))}</span></div>` : ''}<div class="grid-2">${groups}</div></div>`;
}

async function runVerify(deep = false) {
  if (App.state.verifying) return;
  App.state.verifying = true;
  if (['verify', 'home'].includes(App.state.tab)) App.render();
  try { App.state.verify = await App.api.verify(deep); }
  catch (error) { toast(translateError(error.message), 'error'); }
  finally { App.state.verifying = false; if (['verify', 'home'].includes(App.state.tab)) App.render(); }
}

// ---------------------------------------------------------------- dashboard
function dashView() {
  const s = App.state;
  const dash = s.dashboard;
  const world = (s.server?.services || []).find(service => /world/i.test(service.name || service.id || ''));
  if (!dash) return `<div class="page classic">${skeleton(3)}</div>`;
  if (!dash.available) return `<div class="page classic">${emptyState('chart', t('dash.missing', 'No dashboard in this server'), t('dash.missingText', 'It comes with CoA Bots: install or update the bots.'))}</div>`;
  const state = dash.running ? t('dash.running', 'Running on localhost:{port}', { port: dash.port }) : t('dash.stopped', 'Stopped');
  return `<div class="page classic"><section class="hero classic-hero dash-hero">
    <div class="classic-main">
      <h1>${esc(t('tab.dash', 'Dashboard'))}</h1>
      <p class="status-line">${esc(t('dash.what', 'The live map of your bots, their levels, classes, groups, chat and server load. It runs on this PC only.'))}</p>
      <div class="mini-services"><span class="mini-service"><span class="light ${dash.running ? 'on' : 'off'}"></span>${esc(state)}</span>${dash.version ? `<span class="mini-service">${esc(t('dash.version', 'Version {version}', { version: dash.version }))}</span>` : ''}</div>
      <div class="button-row">
        ${dash.running
          ? `<button class="button primary" data-action="dashboard-open">${icon('chart')}${esc(t('dash.open', 'Open the dashboard'))}</button><button class="button ghost" data-action="dashboard-stop">${icon('pause')}${esc(t('dash.stop', 'Stop it'))}</button>`
          : `<button class="button primary" data-action="dashboard-launch">${icon('play')}${esc(t('dash.launch', 'Launch the dashboard'))}</button>`}
      </div>
      ${world && world.state !== 'running' ? `<p class="muted small">${icon('info')}${esc(t('dash.serverOff', 'Your server is stopped: the dashboard opens, but shows bots only while the server runs.'))}</p>` : ''}
    </div>
  </section></div>`;
}

App.pages.dash = {
  render: dashView,
  // render() calls mount() again: the status is read once per visit of the tab, not at every render.
  async mount() {
    if (App.state.dashLoading || App.state.dashFresh) return;
    App.state.dashLoading = true;
    try { App.state.dashboard = await App.api.dashboardStatus(); } catch { App.state.dashboard = { available: false }; }
    App.state.dashLoading = false;
    App.state.dashFresh = true;
    if (App.state.tab === 'dash') App.render();
  },
};

App.pages.verify = {
  render: verifyView,
  mount() { if (!App.state.verify && !App.state.verifying && App.state.server?.path) runVerify(false); },
};

// ---------------------------------------------------------------- home
function homeView() {
  const s = App.state;
  const info = s.server;
  if (!info) return `<div class="page">${skeleton(5)}</div>`;
  // The server folder changed (imported, chosen): the update and addon states were read for the old one.
  if (info.installed && s.updateFor !== info.path) {
    s.updateFor = info.path;
    setTimeout(() => {
      App.api.updateRefresh().then(state => { if (state) { s.update.state = state; if (s.tab === 'home' && !$('#dialog').open) App.render(); } }).catch(() => {});
      refreshAddon(true);
    }, 0);
  }
  if (!info.path) {
    const repack = s.feed?.repack;
    const first = repack
      ? `<button class="split-button update" data-action="feed-open" data-kind="repack"><span class="split-main">${icon('download')}<span><strong>${esc(t('home.download', 'Download the server'))}</strong><small>${esc(repack.name || repack.release)}${repack.size ? ` · ${esc(repack.size)}` : ''}</small></span></span></button>`
      : `<button class="split-button ready" data-tab="server"><span class="split-main">${icon('download')}<span><strong>${esc(t('home.install', 'Install'))}</strong></span></span></button>`;
    return `<div class="page classic"><section class="hero classic-hero"><div class="classic-main"><h1>${esc(t('home.title', 'My server'))}</h1><p class="status-line">${esc(repack ? t('home.noServerFeed', 'No server yet: download the full CoA Bots repack (Proton), then import the zip here. The launcher checks it and unpacks it; after that, every update comes from here in one click.') : t('home.noServer', 'No server yet: install the CoA repack with its bots in a few clicks, or show the folder of the one you have.'))}</p>
      <div class="button-row">${first}</div>
      <div class="button-row"><button class="button ghost" data-action="home-import">${icon('folder')}${esc(t('home.haveZip', 'I have the zip: import it'))}</button><button class="button ghost" data-action="server-choose">${icon('folder')}${esc(t('home.haveServer', 'I already have a server folder'))}</button></div></div></section>${feedNewsRow()}</div>`;
  }
  const services = info.services || [];
  const running = services.filter(service => service.state === 'running').length;
  const moving = services.find(service => service.state === 'starting' || service.state === 'stopping');
  const all = services.length && running === services.length;
  const foreign = services.find(service => service.state === 'foreign');
  // The world runs but its console does not answer (bots being created at a first start): stopping would only
  // time out, so the button waits.
  const busy = all && s.live?.running && s.live.consoleBusy;
  // Silent for more than 20 minutes: not bot creation any more, the world is stuck (a shutdown that never ends).
  const stuck = busy && s.live.busyFor > 20 * 60 * 1000;
  const button = moving ? ['refresh', moving.state === 'starting' ? t('server.startingAll', 'Starting the server…') : t('server.stoppingAll', 'Stopping the server…'), '', 'busy']
    : stuck ? ['warning', t('home.forceStop', 'Force the world to stop'), 'world-force-stop', 'ready']
    : busy ? ['refresh', t('home.botsCreating', 'Bots on the way…'), '', 'busy']
    : running ? ['pause', t('home.stop', 'Stop the server'), 'service-stop-all', 'ready'] : ['play', t('home.start', 'Start the server'), 'service-start-all', 'update'];
  const status = stuck ? t('home.stuckText', 'The world has not answered for {n} minutes: it is stuck. Force it to stop, then start the server again.', { n: Math.round(s.live.busyFor / 60000) })
    : busy ? t('home.botsCreatingText', 'The server is creating its bots (about 10 minutes at a first start). Do not close it: it can be stopped as soon as it answers again.')
    : foreign ? t('home.foreign', '{name}: port {port} is taken by another program.', { name: foreign.name, port: foreign.port })
    // The address the players use: this PC, or the one given in "Who can join" when the server is open.
    : all ? t('home.runningAt', 'Your server is running. Players connect to {address}.', { address: `${s.network?.mode === 'open' ? s.network.address : '127.0.0.1'}${info.ports?.auth && info.ports.auth !== 3724 ? `:${info.ports.auth}` : ''}` }) : running ? t('server.partial', '{n} of {total} services running', { n: running, total: services.length }) : t('server.allStopped', 'The server is stopped');
  const v = s.verify;
  const verifyText = s.verifying ? t('verify.running', 'Checking…') : !v ? t('verify.never', 'Not checked yet') : v.summary.bad ? t('verify.bad', '{n} problem(s) to fix', { n: v.summary.bad }) : v.summary.warn ? t('verify.warn', '{n} point(s) to look at', { n: v.summary.warn }) : t('verify.ok', 'All good');
  const verifyState = !v ? '' : v.summary.bad ? 'bad' : v.summary.warn ? 'warn' : 'ok';
  const dash = s.dashboard;
  const lights = services.map(service => `<span class="mini-service"><span class="light ${service.state === 'running' ? 'on' : service.state === 'starting' || service.state === 'stopping' ? 'busy' : 'off'}"></span>${esc(service.name)}</span>`).join('');
  const menu = [['srv-tab', 'services', t('home.menuServices', 'Services one by one')], ['srv-tab', 'backups', t('srv.tab.backups', 'Backups')], ['server-folder', '', t('home.menuFolder', 'Open the server folder')],
    ['instance-new', '', t('home.menuNew', 'Create a new server (clean instance)…')], ['instance-add', '', t('home.menuAdd', 'Add a repack folder I unpacked…')], ['instance-pick', '', t('home.menuSwitch', 'My servers…')]];
  return `<div class="page classic">
    <section class="hero classic-hero server-hero">${homeLinks()}
      <div class="classic-main">
        <h1>JS CoA Repack</h1>
        <p class="status-line ${foreign ? 'bad' : ''}">${esc(status)}</p>
        <div class="mini-services">${lights}</div>
        <div class="play-row"><div class="split-button ${button[3]}">
          <button class="split-main" data-action="${button[2]}" ${button[2] ? '' : 'disabled'} title="${esc(info.bots?.installed ? t('home.withBots', 'Database, login, world and bots') : t('home.withoutBots', 'Database, login and world'))}">${icon(button[0])}<span><strong>${esc(button[1])}</strong><small>${esc(info.bots?.installed ? t('home.withBots', 'Database, login, world and bots') : t('home.withoutBots', 'Database, login and world'))}</small></span></button>
          <button class="split-more" data-action="play-menu" aria-label="${esc(t('classic.more', 'More'))}">${icon('chevron')}</button>
          <div class="split-menu" id="play-menu" hidden>${menu.map(([action, id, label]) => `<button data-action="${action}" ${id ? `data-id="${id}"` : ''}>${esc(label)}</button>`).join('')}</div>
        </div>
        <button class="icon-button gear-settings" data-action="srv-tab" data-id="settings" title="${esc(t('srv.tab.settings', 'Server settings'))}" aria-label="${esc(t('srv.tab.settings', 'Server settings'))}">${icon('settings')}</button>${s.config.hasUpdates ? `<button class="icon-button gear-settings" data-action="update-check" title="${esc(t('settings.checkRepack', 'Check for a repack and bots update'))}" aria-label="${esc(t('settings.checkRepack', 'Check for a repack and bots update'))}">${icon('refresh')}</button>` : ''}</div>
        <span class="chip classic-folder" title="${esc(info.path)}">${icon('folder')}<span>${esc(info.path)}</span></span>
      </div>
      <aside class="classic-side">${updateCard()}${componentCards()}
        <button class="side-card" ${s.update?.state?.state === 'available' ? 'data-action="update-open"' : 'data-tab="verify"'}>${icon('layers')}<span><strong>${esc(t('home.core', 'Core'))}</strong><small>${esc(shortRelease(info.details?.release || info.version) || '—')}</small></span>${s.updates.core || s.update?.state?.state === 'available' ? '<i class="dot"></i>' : icon('next')}</button>
        <button class="side-card" data-tab="verify">${icon('bot')}<span><strong>CoA Bots</strong><small>${esc(info.bots?.installed ? `${info.bots.version}${info.bots.builtFor ? ` · ${shortRelease(info.bots.builtFor)}` : ''}` : t('bots.notInstalled', 'Not installed'))}</small></span>${s.updates.bots ? '<i class="dot"></i>' : icon('next')}</button>
        <button class="side-card verify-card ${verifyState}" data-tab="verify">${icon('shield')}<span><strong>${esc(t('tab.verify', 'Verification'))}</strong><small>${esc(verifyText)}</small></span>${icon('next')}</button>
        ${addonCard()}
        ${newerRepack(info) ? `<button class="side-card" data-action="repack-newer">${icon('download')}<span><strong>${esc(t('home.newRepack', 'New repack available'))}</strong><small>${esc(newerRepack(info).name || newerRepack(info).release)}</small></span><i class="dot"></i></button>` : ''}
        ${dash?.available ? `<button class="side-card" data-action="${dash.running ? 'dashboard-open' : 'dashboard-start'}">${icon('chart')}<span><strong>${esc(t('home.dashboard', 'Bots dashboard'))}</strong><small>${esc(dash.running ? t('home.dashboardOpen', 'Running on localhost:{port}: open it', { port: dash.port }) : t('home.dashboardStart', 'Map, bots, stats, chat: start it'))}</small></span>${icon('next')}</button>` : ''}
        <button class="side-card" data-action="network-open">${icon('globe')}<span><strong>${esc(t('net.card', 'Who can join'))}</strong><small>${esc(s.network?.mode === 'open' ? t('net.cardOpen', 'Other PCs: {address}', { address: s.network.address }) : t('net.cardLocal', 'This PC only'))}</small></span>${icon('next')}</button>
      </aside>
    </section>
    ${feedNewsRow(false)}
    ${!App.state.feed?.news?.length && (s.news || []).filter(item => item.area !== 'client').length ? `<section class="news-row"><h2>${esc(t('classic.news', 'Latest news'))}</h2><div class="news-grid">${newsCards((s.news || []).filter(item => item.area !== 'client'))}</div></section>` : ''}
  </div>`;
}

// The feed announces a repack whose release differs from the one installed here.
function newerRepack(info) {
  const repack = App.state.feed?.repack;
  if (!repack?.release || !info?.details?.release || App.state.config.hasUpdates) return null;
  const day = release => /^main-(d{8})-/.exec(release)?.[1] || '';
  return day(repack.release) > day(info.details.release) ? repack : null;
}

// News written by the realm owner in the feed (feed.json on the download server).
function homeLinks() {
  return `<span class="news-links"><button class="link-button" data-action="source-link" data-id="botsHelp">${icon('book')}${esc(t('home.botsHelp', 'Bots help'))}</button>${App.state.feed?.discord?.invite ? `<button class="link-button" data-action="feed-open" data-kind="discord">${icon('discord')}${esc(t('home.discordJoin', 'Join the Discord'))}</button>` : ''}</span>`;
}

function feedNewsRow(links = true) {
  const notes = App.state.notes || [];
  const news = notes.length ? notes : App.state.feed?.news || [];
  if (!news.length) return '';
  const title = esc(notes.length ? t('home.lastPatch', 'Last patch note') : t('home.announcements', 'News'));
  const discord = links ? homeLinks() : '';
  return `<section class="news-row">${discord}<div class="news-live"><div class="news-grid one">${news.slice(0, 1).map((item, index) => `<article class="news-card ${notes.length ? 'bots' : 'news'}" data-action="${notes.length ? 'note-open' : 'feed-news'}" data-index="${index}" tabindex="0" role="button"><div class="news-art"><h2>${title}</h2>${icon(notes.length ? 'bot' : 'book')}</div><div class="news-text"><small>${esc(item.date)}</small><strong>${esc(item.title)}</strong><p>${esc(item.summary || item.text)}</p></div></article>`).join('')}</div>${liveView()}</div></section>`;
}

// ---------------------------------------------------------------- live state of the server (home)
function liveView() {
  const l = App.state.live;
  if (!App.state.server?.installed) return '';
  // The server info arrived after the first reading: read now rather than in 10 s.
  if (l === undefined) setTimeout(refreshLive, 0);
  const tile = (iconName, label, value, hint = '') => `<div class="live-tile">${icon(iconName)}<span><small>${esc(label)}</small><strong>${esc(value)}</strong>${hint ? `<em>${esc(hint)}</em>` : ''}</span></div>`;
  if (!l?.running) return `<section class="live"><h3>${esc(t('live.title', 'Server live'))}</h3><p class="muted">${esc(t('live.stopped', 'The figures appear here while the server runs: players, bots, tick and memory.'))}</p></section>`;
  const dash = value => (value === null || value === undefined ? '—' : value);
  const tick = l.tickMean ?? l.tick;
  // Bots still logging in (fewer than the number set): the server is slower meanwhile, and that is expected.
  const arriving = l.bots?.target && l.bots.count < Math.floor(l.bots.target * 0.95);
  if (!arriving) App.state.waitClosed = false;
  return `<section class="live"><h3>${esc(t('live.title', 'Server live'))}${l.realms ? `<span class="live-realms">${icon('globe')}${esc(t('live.allRealms', 'All {n} realms: {players} players · {bots} bots in game', { n: l.realms.count, players: l.realms.players, bots: l.realms.bots }))}</span>` : ''}${arriving ? `<span class="live-arriving" title="${esc(t('live.arrivingHint', 'While they log in, the server is slower (high tick): this is normal. Wait a few minutes until all of them are there.'))}">${icon('bot')}${esc(t('live.arrivingTitle', 'The bots are arriving in your realm: {count} / {target}', { count: l.bots.count, target: l.bots.target }))}${progressBar({ total: l.bots.target, completed: l.bots.count }).html}</span>` : ''}</h3><div class="live-body"><div class="live-grid">
    ${tile('user', t('live.players', 'Players'), dash(l.players))}
    ${tile('bot', t('live.bots', 'Bots in game'), l.bots ? String(l.bots.count) : '—', l.bots ? t('live.inCombat', '{n} in combat', { n: l.bots.inCombat }) : '')}
    ${tile('refresh', t('live.tick', 'Tick'), tick === null || tick === undefined ? '—' : `${tick} ms`, arriving && tick > 150 ? t('live.tickLoading', 'bots arriving') : tick > 150 ? t('live.tickSlow', 'slow') : tick !== null && tick !== undefined ? t('live.tickOk', 'smooth') : '')}
    ${tile('database', t('live.memory', 'Memory'), l.memory ? formatBytes(l.memory) : '—')}
  </div>${homeAccount()}</div>${arriving && !App.state.waitClosed ? `<p class="live-wait live-toast">${icon('info')}<span>${esc(t('live.waitLogin', 'Wait a little before logging in: the server is bringing its bots into the world. The game is slower until they are all there.'))}</span><button class="icon-button" data-action="live-wait-close" title="${esc(t('common.close', 'Close'))}">${icon('close')}</button></p>` : ''}</section>`;
}

// Read every 10 s while the home page is shown, and at once when it opens.
let liveBusy = false;
// The first login, on the home page: the account to create, then where to log in (the full form stays in Management).
function homeAccount() {
  return `<div class="live-account"><strong>${icon('user')}${esc(t('server.account', 'Game account'))}</strong>
    <p class="muted small">${esc(t('home.accountHint', 'Create your game accounts here.'))}</p>
    <form id="home-account" class="home-account-form"><input id="ha-name" maxlength="17" placeholder="${esc(t('server.accountName', 'Account name'))}" autocomplete="off"><input id="ha-password" type="password" maxlength="16" placeholder="${esc(t('server.password', 'Password'))}" autocomplete="new-password"><label class="check"><input type="checkbox" class="ga-gm"><span>${esc(t('server.gm', 'Game master'))}</span></label><button class="button primary small" type="submit">${esc(t('server.create', 'Create'))}</button></form></div>`;
}

App.actions['live-wait-close'] = () => { App.state.waitClosed = true; document.querySelector('.live-toast')?.remove(); };

async function refreshLive() {
  if (liveBusy || App.state.tab !== 'home' || !App.state.server?.installed || document.hidden) return;
  liveBusy = true;
  try { App.state.live = await App.api.liveStats(); } catch { App.state.live = null; }
  liveBusy = false;
  if (App.state.tab !== 'home' || $('#dialog').open || document.querySelector('.split-menu:not([hidden])')) return;
  // An account being typed is kept: only the figures are redrawn.
  const form = $('#home-account');
  const typing = form && (form.contains(document.activeElement) || [...form.querySelectorAll('input')].some(input => input.value));
  const grid = $('.live .live-grid');
  if (typing && grid && App.state.live?.running) { const fresh = document.createElement('div'); fresh.innerHTML = liveView(); const next = fresh.querySelector('.live-grid'); if (next) grid.replaceWith(next); }
  else App.render();
}
setInterval(refreshLive, 10000);
setTimeout(refreshLive, 1500);

// ---------------------------------------------------------------- console
App.state.consoleLog = [];
const CONSOLE_QUICK = ['server info', 'account onlinelist', 'saveall', 'playerbots rndbot stats'];
function consoleView() {
  const log = App.state.consoleLog.map(entry => `<div class="console-entry"><code class="console-cmd">${entry.realm ? realmEmblem(entry.realm, 16) : ''}AC&gt; ${esc(entry.command)}</code><pre class="${entry.error ? 'bad' : ''}">${esc(entry.output)}</pre></div>`).join('');
  const realm = App.state.consoleRealm || 'coa';
  if (!App.state.realms && App.state.server?.path) loadRealms();
  return `<div class="page classic">${realmPicker(realm, 'console-realm')}${createdRealms().length > 1 ? realmBanner(realm, t('realms.consoleOn', 'The commands go to this realm only.')) : ''}<section class="panel console-panel">
    <header><h2>${icon('terminal')}${esc(t('console.title', 'World console'))}</h2><div class="button-row">${CONSOLE_QUICK.map(command => `<button class="button ghost small" data-action="console-quick" data-command="${esc(command)}">${esc(command)}</button>`).join('')}</div></header>
    <p class="muted small">${esc(t('console.hint', 'The server commands, as in World_Console.bat (the worldserver must run). Up and down arrows bring back the last commands.'))}</p>
    <div class="console-log" id="console-log">${log || `<p class="muted">${esc(t('console.empty', 'Type a command below, for example server info.'))}</p>`}</div>
    <form class="console-form" id="console-form"><span>AC&gt;</span><input id="console-input" autocomplete="off" spellcheck="false" maxlength="500" placeholder="server info"><button class="button primary small" type="submit">${esc(t('console.send', 'Send'))}</button></form>
  </section></div>`;
}
let consoleHistory = [];
let consoleIndex = -1;
async function consoleSend(command) {
  command = String(command || '').trim();
  if (!command) return;
  if (/^\.?server (shutdown|restart)/i.test(command) && !(await confirmDialog({ title: t('console.stopTitle', 'Stop the server?'), body: esc(t('console.stopBody', 'This command stops the worldserver for everyone connected.')), confirm: t('console.stopConfirm', 'Send it'), danger: true }))) return;
  consoleHistory = [command, ...consoleHistory.filter(item => item !== command)].slice(0, 30);
  consoleIndex = -1;
  const realm = App.state.consoleRealm && App.state.consoleRealm !== 'coa' ? App.state.consoleRealm : '';
  const entry = { command, output: t('console.waiting', '…'), realm: realm || 'coa' };
  App.state.consoleLog = [...App.state.consoleLog, entry].slice(-60);
  App.render();
  try { entry.output = (await App.api.consoleRun(command, realm)) || t('console.noOutput', '(no answer)'); }
  catch (error) { entry.output = translateError(error.message); entry.error = true; }
  if (App.state.tab === 'console') App.render();
}
App.pages.console = {
  render: consoleView,
  mount() {
    const log = $('#console-log');
    if (log) log.scrollTop = log.scrollHeight;
    const input = $('#console-input');
    if (!input || input.dataset.bound) return;
    input.dataset.bound = '1';
    input.focus();
    $('#console-form').addEventListener('submit', event => { event.preventDefault(); const value = input.value; input.value = ''; consoleSend(value); });
    input.addEventListener('keydown', event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      consoleIndex = Math.max(-1, Math.min(consoleHistory.length - 1, consoleIndex + (event.key === 'ArrowUp' ? 1 : -1)));
      input.value = consoleIndex >= 0 ? consoleHistory[consoleIndex] : '';
    });
  },
};
Object.assign(App.actions, { 'console-quick': button => consoleSend(button.dataset.command) });

// The community server beside the news: who is online when its widget is public, and a join button.
function discordPanel() {
  const discord = App.state.feed?.discord;
  if (!discord) return '';
  const live = discord.live;
  const members = (live?.members || []).map(member => `<li><i class="presence ${esc(member.status)}"></i>${esc(member.name)}</li>`).join('');
  return `<aside class="discord-card">
    <header>${icon('discord')}<div><strong>${esc(discord.name || live?.name || 'Discord')}</strong><small>${live ? `<i class="presence online"></i>${esc(t('home.discordOnline', '{n} online', { n: live.online }))}` : esc(t('home.discordCommunity', 'Community'))}</small></div></header>
    ${members ? `<ul class="discord-members">${members}</ul>` : `<p>${esc(discord.text || t('home.discordText', 'Help, news, bug reports and ideas: join the players of the realm.'))}</p>`}
    ${discord.invite || live?.invite ? `<button class="button primary" data-action="feed-open" data-kind="discord">${icon('external')}${esc(t('home.discordJoin', 'Join the Discord'))}</button>` : ''}
  </aside>`;
}

// A new launcher downloaded and verified: one click restarts into it.
function launcherBanner() {
  const update = App.state.launcherUpdate;
  if (update?.phase === 'downloaded') return `<div class="update-banner"><i class="dot"></i><span>${esc(t('home.launcherReady', 'A new version of the launcher ({version}) is ready.', { version: update.version || '' }))}</span><button class="button primary small" data-action="launcher-install">${esc(t('home.launcherRestart', 'Restart and update'))}</button></div>`;
  if (update?.phase === 'downloading') return `<div class="update-banner"><i class="dot"></i><span>${esc(t('home.launcherDownloading', 'Downloading the new launcher… {percent}%', { percent: update.percent || 0 }))}</span></div>`;
  // A failed launcher update says so (it used to leave the bar empty) and can be tried again.
  if (update?.phase === 'error') return `<div class="update-banner bad">${icon('warning')}<span>${esc(t('home.launcherFailed', 'The new launcher could not be prepared: {message}', { message: update.message || '' }))}</span><button class="button ghost small" data-action="launcher-check">${esc(t('common.retry', 'Try again'))}</button></div>`;
  return '';
}

App.pages.home = {
  render: homeView,
  mount() {
    if (!App.state.server) App.api.serverInfo().then(info => { App.state.server = info; App.refresh('home'); }).catch(() => {});
    if (!App.state.dashboard) refreshDashboard();
    if (!App.state.network && App.state.server?.path) App.api.networkInfo().then(data => { App.state.network = data.network; if (App.state.tab === 'home') App.render(); }).catch(() => {});
    if (!App.state.verify && !App.state.verifying && App.state.server?.path) runVerify(false);
  },
};

// A very small Markdown reader for changelogs: headings, bullets, bold; everything else is plain text.
function markdownLite(text) {
  const inline = line => esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = [];
  let list = false;
  let paragraph = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*] (.*)$/);
    if (list && !bullet && !/^\s{2,}\S/.test(line)) { out.push('</ul>'); list = false; }
    if (/^#{1,2} /.test(line)) out.push(`<h3>${inline(line.replace(/^#+ /, ''))}</h3>`);
    else if (/^#{3,} /.test(line)) out.push(`<h4>${inline(line.replace(/^#+ /, ''))}</h4>`);
    else if (bullet) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(bullet[1])}</li>`); }
    else if (list && /^\s{2,}\S/.test(line)) out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
    // Lines of the same paragraph (wrapped in the file) are joined back.
    else if (line.trim() && paragraph) out[out.length - 1] = out[out.length - 1].replace(/<\/p>$/, ` ${inline(line.trim())}</p>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    paragraph = !!line.trim() && !bullet && !/^#/.test(line) && !list;
  }
  if (list) out.push('</ul>');
  return out.join('');
}

function showNews(area) {
  const item = (App.state.news || []).find(entry => entry.area === area);
  if (!item) return;
  const label = { client: t('classic.newsGame', 'Game'), server: t('classic.newsServer', 'Server'), bots: t('classic.newsBots', 'Bots') }[area] || area;
  const date = item.publishedAt ? new Date(item.publishedAt).toLocaleString(I18N.lang, { dateStyle: 'long', timeStyle: 'short' }) : '';
  const facts = item.files ? t('news.facts', '{files} files, {size} in all (only the changed ones are downloaded)', { files: formatNumber(item.files), size: formatBytes(item.bytes) }) : '';
  dialog.open(`${dialog.header(item.version, `${label}${date ? ` · ${date}` : ''}`)}<div class="dialog-content patch-notes">
    ${item.notes.length ? `<h3>${esc(t('news.notes', 'In this release'))}</h3><ul>${item.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : `<p class="muted">${esc(t('classic.noNotes', 'No notes for this release.'))}</p>`}
    ${facts ? `<p class="muted small">${esc(facts)}</p>` : ''}
    ${item.changelog ? `<div class="changelog"><p class="eyebrow">${esc(t('news.changelog', 'Changelog of the installed bots'))}</p>${markdownLite(item.changelog)}</div>` : ''}
  </div>`, 'wide');
}

async function refreshDashboard() {
  try { App.state.dashboard = await App.api.dashboardStatus(); } catch { App.state.dashboard = { available: false }; }
  if (App.state.tab === 'home') App.render();
}

Object.assign(App.actions, {
  'verify-run': () => runVerify(false),
  'feed-open': target => guard(async () => {
    const result = await App.api.openFeedLink(target.dataset.kind);
    toast(result?.copied ? t('feed.copied', 'Your browser could not be opened: the link is copied, paste it in your browser.') : t('feed.opened', 'Opened in your browser.'), 'success');
  }, target),
  'home-import': () => { App.state.srvTab = 'install'; App.go('server'); App.actions['repack-import']?.(document.createElement('button')); },
  'launcher-install': button => guard(() => App.api.installLauncher(), button),
  'world-force-stop': button => guard(async () => {
    if (!await confirmDialog({ title: t('home.forceStop', 'Force the world to stop'), body: esc(t('home.forceStopBody', 'Only the worldserver of this server is ended; the database keeps everything saved. What players did since the last save may be lost. The rest of the server is then stopped normally.')), confirm: t('home.forceStop', 'Force the world to stop'), danger: true })) return;
    App.state.server = await App.api.forceStopWorld();
    App.state.live = null;
    toast(t('home.forceStopped', 'The server is stopped. You can start it again.'), 'success');
    App.render();
  }, button),
  // Settings > About: look for a new launcher now (the result also shows on the home page banner).
  'crashes-archive': button => guard(async () => {
    const moved = await App.api.archiveCrashes();
    toast(t('verify.crashesArchived', '{n} crash file(s) put away in Crashes\\archive.', { n: moved }), 'success');
    runVerify(false);
  }, button),
  'launcher-check': button => guard(async () => {
    toast(t('settings.launcherChecking', 'Looking for a new launcher…'));
    const status = await App.api.checkLauncher();
    App.state.launcherUpdate = status;
    const kind = status?.phase === 'error' ? 'error' : 'success';
    toast(status?.phase === 'downloading' || status?.phase === 'downloaded' ? t('settings.launcherFound', 'A new launcher is being downloaded: the home page tells when it is ready.') : status?.message || t('settings.launcherUpToDate', 'Your launcher is up to date.'), kind);
  }, button),
  'feed-news': target => {
    const item = App.state.feed?.news?.[Number(target.dataset.index)];
    if (!item) return;
    dialog.open(`${dialog.header(item.title, item.date)}<div class="dialog-content patch-notes">${markdownLite(item.text)}</div>${item.url ? `<footer class="dialog-foot"><button class="button primary" data-action="feed-news-link" data-index="${esc(target.dataset.index)}">${icon('external')}${esc(t('home.readMore', 'Read more'))}</button></footer>` : ''}`, 'wide');
  },
  'note-open': target => {
    const item = App.state.notes?.[Number(target.dataset.index)];
    if (!item) return;
    dialog.open(`${dialog.header(item.title, item.date)}<div class="dialog-content patch-notes">${markdownLite(item.text)}</div>${item.url ? `<footer class="dialog-foot"><button class="button primary" data-action="note-link" data-index="${esc(target.dataset.index)}">${icon('external')}${esc(t('home.readMore', 'Read more'))}</button></footer>` : ''}`, 'wide');
  },
  'note-link': target => guard(() => App.api.openNote(target.dataset.index)),
  'feed-news-link': target => guard(() => App.api.openFeedLink(`news:${target.dataset.index}`)),
  'repack-newer': () => {
    const repack = App.state.feed?.repack;
    if (!repack) return;
    dialog.open(`${dialog.header(t('home.newRepack', 'New repack available'), repack.name || repack.release)}<div class="dialog-content">
      ${repack.notes ? `<p>${esc(repack.notes)}</p>` : ''}
      <ol class="notes"><li>${esc(t('home.newRepack1', 'Download the zip (Proton link).'))}</li><li>${esc(t('home.newRepack2', 'Import it: it goes into a new folder, your current server stays as it is.'))}</li><li>${esc(t('home.newRepack3', 'Bring your players over: Management > Installation > Bring players over from another repack.'))}</li></ol>
    </div><footer class="dialog-foot"><button class="button ghost" data-action="home-import">${icon('folder')}${esc(t('home.haveZip', 'I have the zip: import it'))}</button><button class="button primary" data-action="feed-open" data-kind="repack">${icon('download')}${esc(t('home.download', 'Download the server'))}</button></footer>`);
  },
  'news-open': target => showNews(target.dataset.area),
  // "install:bots-install": open Management > Installation, then run that action there.
  'verify-run-in': button => {
    const [tab, action] = button.dataset.id.split(':');
    App.state.srvTab = tab;
    App.go('server');
    loadServerTab(true);
    const target = document.createElement('button');
    App.actions[action]?.(target);
  },
  'verify-deep': () => runVerify(true),
  'verify-copy': button => guard(async () => { await App.api.copyVersions(); toast(t('verify.copied', 'Versions copied: paste them on Discord.'), 'success'); }, button),
  'verify-fix': button => guard(async () => {
    const id = button.dataset.id;
    const ok = await confirmDialog({ title: t('verify.fixTitle', 'Apply this fix?'), body: esc(t('verify.fixBody', 'Only the setting or file named in the check is changed; a copy of any edited file is kept next to it.')), confirm: t('verify.fix', 'Fix') });
    if (!ok) return;
    App.state.verify = await App.api.verifyFix(id);
    toast(t('verify.fixed', 'Fixed. The checks were run again.'), 'success');
    App.render();
  }, button),
  'dashboard-start': button => guard(async () => { toast(t('home.dashboardStarting', 'Starting the dashboard…')); App.state.dashboard = await App.api.startDashboard(); await App.api.openDashboard(); App.render(); }, button),
  'dashboard-open': button => guard(() => App.api.openDashboard(), button),
  // Start, wait until it answers, then open its window.
  'dashboard-launch': button => guard(async () => {
    toast(t('home.dashboardStarting', 'Starting the dashboard…'));
    App.state.dashboard = await App.api.startDashboard();
    for (let i = 0; i < 20 && !App.state.dashboard?.running; i++) { await new Promise(resolve => setTimeout(resolve, 1000)); App.state.dashboard = await App.api.dashboardStatus(); }
    if (App.state.dashboard?.running) await App.api.openDashboard();
    App.render();
  }, button),
  'dashboard-stop': button => guard(async () => { App.state.dashboard = await App.api.stopDashboard(); App.render(); }, button),
  // Who can join: this PC only, or other PCs. Kept by the launcher and written again after every update.
  'network-open': button => guard(async () => {
    const data = await App.api.networkInfo();
    App.state.network = data.network;
    const n = data.network;
    const authPort = data.ports?.auth || 3724;
    const worldPort = data.ports?.world || 8085;
    const suffix = authPort !== 3724 ? `:${authPort}` : '';
    const chips = data.lan.map(ip => `<button class="chip" data-action="network-ip" data-ip="${esc(ip)}">${icon('globe')}<span>${esc(ip)}</span></button>`).join('');
    dialog.open(`${dialog.header(t('net.title', 'Who can join'), t('net.subtitle', 'Kept by the launcher: written again after every update of the server'))}<div class="dialog-content">
      <label class="toggle-row"><input type="radio" name="net-mode" value="local" ${n.mode === 'local' ? 'checked' : ''}><span><strong>${esc(t('net.local', 'This PC only'))}</strong><small>${esc(t('net.localHint', 'The game on this PC connects to 127.0.0.1{suffix}. Nobody else can join.', { suffix }))}</small></span></label>
      <label class="toggle-row"><input type="radio" name="net-mode" value="open" ${n.mode === 'open' ? 'checked' : ''}><span><strong>${esc(t('net.open', 'Other PCs too (home network or Internet)'))}</strong><small>${esc(t('net.openHint', 'The server listens on every network card and gives the address below to the players.'))}</small></span></label>
      <div class="field-pair"><div class="field"><span>${esc(t('net.address', 'Address given to the players'))}</span><input id="net-address" value="${esc(n.address)}" spellcheck="false"><small>${esc(t('net.addressHint', 'Home: the IP of this PC. Internet: your public IP, ports {auth} and {world} forwarded to this PC.', { auth: authPort, world: worldPort }))}</small>${chips ? `<div class="button-row">${chips}</div>` : ''}</div>
      <div class="field"><span>${esc(t('net.name', 'Realm name'))}</span><input id="net-name" value="${esc(n.name)}" maxlength="32"></div></div>
      <div class="line-action">${icon('shield')}<span>${esc(t('net.firewall', 'Windows Firewall: open ports {auth} and {world} (administrator).', { auth: authPort, world: worldPort }))}</span><button class="button ghost small" data-action="network-firewall">${esc(t('net.firewallButton', 'Open the firewall'))}</button></div>
      <div class="line-action" title="Data\\enUS\\realmlist.wtf">${icon('user')}<span>${esc(t('net.friends', 'Your friends, in their realmlist.wtf:'))}<code id="net-friends" data-suffix="${esc(suffix)}">set realmlist ${esc(n.address)}${esc(suffix)}</code></span><button class="button ghost small" data-action="network-copy">${icon('copy')}${esc(t('common.copy', 'Copy'))}</button></div>
    </div><footer class="dialog-foot"><button class="button ghost" data-action="dialog-close">${esc(t('common.cancel', 'Cancel'))}</button><button class="button primary" data-action="network-save">${esc(t('common.save', 'Save'))}</button></footer>`, 'wide');
  }, button),
  'network-ip': button => { const input = $('#net-address'); if (input) input.value = button.dataset.ip; const open = $('input[name=net-mode][value=open]'); if (open) open.checked = true; friendsLine(); },
  'network-copy': async () => {
    const line = friendsLine();
    try { await navigator.clipboard.writeText(line); toast(t('net.copied', 'Copied: {line}', { line }), 'success'); }
    catch { toast(line); }
  },
  'network-save': button => guard(async () => {
    const mode = $('input[name=net-mode]:checked')?.value || 'local';
    const result = await App.api.saveNetwork({ mode, address: $('#net-address')?.value || '', name: $('#net-name')?.value || '' });
    App.state.network = result.network;
    dialog.close();
    refreshAddon();
    toast(result.running ? t('net.savedRestart', 'Saved. Restart the server for it to take effect.') : t('net.saved', 'Saved: the server uses it at its next start.'), 'success');
    App.render();
  }, button),
  'network-firewall': button => guard(async () => { await App.api.openFirewall(); toast(t('net.firewallDone', 'Firewall rules added.'), 'success'); }, button),
  // A clean instance: an empty folder, the repack and its bots installed there; the others stay as they are.
  'instance-new': () => {
    dialog.open(`${dialog.header(t('instance.title', 'Create a new server'), t('instance.subtitle', 'A clean instance in a folder of its own'))}<div class="dialog-content">
      <p>${esc(t('instance.body', 'Choose an empty folder: the repack and its bots are installed there, with a fresh database. Your current server is not touched and stays in "My servers".'))}</p>
      <label class="toggle-row"><input type="checkbox" id="instance-ports"><span><strong>${esc(t('instance.ports', 'Other ports, to run it at the same time as another server'))}</strong><small>${esc(t('instance.portsHint', 'Free ports are chosen (for example 3308, 3725, 8086). Players then set their realmlist to 127.0.0.1:3725. Without this, only one server runs at a time.'))}</small></span></label>
    </div><footer class="dialog-foot"><button class="button ghost" data-action="dialog-close">${esc(t('common.cancel', 'Cancel'))}</button><button class="button primary" data-action="instance-create">${icon('folder')}${esc(t('instance.choose', 'Choose an empty folder'))}</button></footer>`);
  },
  'instance-create': button => guard(async () => {
    const result = await App.api.createInstance({ otherPorts: $('#instance-ports')?.checked === true });
    if (!result) return;
    dialog.close();
    Object.assign(App.state, { server: result.info, serverCheck: null, botsCheck: null, conf: null, backups: null, upgrade: null, verify: null, network: null, pending: {}, withBots: true, srvTab: 'install' });
    toast(result.ports ? t('instance.createdPorts', 'New server folder ready, on ports {mysql}/{auth}/{world}. Install it now.', { mysql: result.ports.mysqlPort, auth: result.ports.authPort, world: result.ports.worldPort }) : t('instance.created', 'New server folder ready. Install it now.'), 'success');
    App.go('server');
    refreshUpdates();
  }, button),
  'instance-pick': button => guard(async () => {
    const list = await App.api.instances();
    const rows = list.map(item => `<div class="history-row"><div><strong>${esc(item.path)}</strong><small>${esc([item.repack ? item.release || '?' : t('instance.empty', 'not installed yet'), item.bots ? `CoA Bots ${item.bots}` : '', item.ports?.auth ? t('instance.portsOf', 'ports {mysql}/{auth}/{world}', { mysql: item.ports.mysql, auth: item.ports.auth, world: item.ports.world }) : ''].filter(Boolean).join(' · '))}</small></div>${item.current ? `<span class="pill ok">${esc(t('instance.current', 'Current'))}</span>` : `<button class="button primary small" data-action="instance-switch" data-path="${esc(item.path)}" ${item.exists ? '' : 'disabled'}>${esc(t('instance.use', 'Use'))}</button><button class="button ghost small" data-action="instance-forget" data-path="${esc(item.path)}">${esc(t('instance.forget', 'Forget'))}</button>`}</div>`).join('');
    dialog.open(`${dialog.header(t('home.menuSwitch', 'My servers…').replace('…', ''), t('instance.listHint', 'Forgetting a server only removes it from this list: its folder stays on the disk.'))}<div class="dialog-content"><div class="history-list">${rows}</div></div><footer class="dialog-foot"><button class="button ghost" data-action="instance-add">${icon('folder')}${esc(t('home.menuAdd', 'Add a repack folder I unpacked…'))}</button><button class="button ghost" data-action="instance-new">${icon('download')}${esc(t('home.menuNew', 'Create a new server (clean instance)…'))}</button></footer>`, 'wide');
  }, button),
  // A repack unpacked by hand: its folder is chosen, checked, added to "My servers" and managed from now on.
  'instance-add': button => guard(async () => {
    const info = await App.api.chooseServer();
    if (!info) return;
    dialog.close();
    Object.assign(App.state, { server: info, serverCheck: null, botsCheck: null, conf: null, backups: null, upgrade: null, verify: null, network: null, botsError: '', pending: {} });
    toast(info.installed ? t('instance.switched', 'Now managing {path}.', { path: info.path }) : t('instance.notRepack', 'This folder is not a complete repack (Start_All_Server.bat, Core, mysql…): choose the folder that holds them.'), info.installed ? 'success' : 'error');
    App.go('home');
    refreshUpdates();
    if (info.installed) runVerify(false);
  }, button),
  'instance-switch': button => guard(async () => {
    const info = await App.api.switchInstance(button.dataset.path);
    dialog.close();
    Object.assign(App.state, { server: info, serverCheck: null, botsCheck: null, conf: null, backups: null, upgrade: null, verify: null, network: null, pending: {} });
    toast(t('instance.switched', 'Now managing {path}.', { path: info.path }), 'success');
    App.render();
    refreshUpdates();
    if (info.installed) runVerify(false);
  }, button),
  'instance-forget': button => guard(async () => { await App.api.forgetInstance(button.dataset.path); App.actions['instance-pick'](button); }, button),
});

// The line the friends put in their game: follows the address typed in "Who can join".
function friendsLine() {
  const code = $('#net-friends');
  const line = `set realmlist ${($('#net-address')?.value || '').trim() || '127.0.0.1'}${code?.dataset.suffix || ''}`;
  if (code) code.textContent = line;
  return line;
}
document.addEventListener('input', event => { if (event.target.id === 'net-address') friendsLine(); });

// "main-20261018-0ab739f5" reads "main-20261018" on the home cards (the full id stays in Verification).
function shortRelease(release) { return String(release || '').replace(/-[0-9a-f]{7,40}$/i, ''); }
