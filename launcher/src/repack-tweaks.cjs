'use strict';
// Small fixes of the repack's own settings, applied before every start (never over a choice of the player).
// - Logger.entities.player: since the maps of CoA Bots 2.5 the core logs "Wrong area flag ... PLAYER_EXPLORED_ZONES"
//   on every pass through 63 CoA sub-zones (about a third of Server.log, 50 MB/h with 1000 bots, slowing the server).
//   The line keeps only the fatal messages of that logger. Settings\worldserver.conf.template is read by both
//   servers (manage.py writes Core\configs\worldserver.conf from it, the bots' server copies that file).
const fs = require('node:fs/promises');
const path = require('node:path');

const TEMPLATE = 'Settings/worldserver.conf.template';
const LINE = 'Logger.entities.player=1,Console Server';

async function quietPlayerLogger(root) {
  const file = path.join(root, TEMPLATE);
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  if (text === null || /^\s*Logger\.entities\.player\s*=/m.test(text)) return false;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  // Next to the other Logger lines (after Logger.diff, else after the last Logger line).
  let at = lines.findIndex(line => /^\s*Logger\.diff\s*=/.test(line));
  if (at < 0) at = lines.map(line => /^\s*Logger\./.test(line)).lastIndexOf(true);
  if (at < 0) return false;
  lines.splice(at + 1, 0, LINE);
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, lines.join(eol));
  await fs.rename(temporary, file);
  return true;
}

module.exports = { quietPlayerLogger, LINE };
