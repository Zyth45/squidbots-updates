'use strict';
// "Support report": one zip a player can drop on the support Discord. It holds what helpers ask for
// (versions, server state, the recent logs, the client's crash reports) and nothing personal: lines
// that look like credentials are blanked, configuration files with passwords are never included.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');

const MAX_FILE = 2 * 1024 * 1024;
const SECRET_LINE = /(password|passwd|pwd|secret|token|apikey|api_key|DatabaseInfo|Authorization)\s*[=:]/i;

const redact = text => text.split(/\r?\n/).map(line => (SECRET_LINE.test(line) ? line.replace(/([=:]\s*).*/, '$1[removed]') : line)).join('\n');

// The end of a log is what matters: keep its last MAX_FILE bytes.
async function tail(file) {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return null;
  const handle = await fs.open(file, 'r');
  try {
    const size = Math.min(stat.size, MAX_FILE);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, stat.size - size);
    return redact(buffer.toString('utf8'));
  } finally { await handle.close(); }
}

async function newest(folder, count, pattern = /./) {
  const names = await fs.readdir(folder).catch(() => []);
  const files = [];
  for (const name of names.filter(item => pattern.test(item))) {
    const stat = await fs.stat(path.join(folder, name)).catch(() => null);
    if (stat?.isFile()) files.push({ name, time: stat.mtimeMs });
  }
  return files.sort((a, b) => b.time - a.time).slice(0, count).map(item => path.join(folder, item.name));
}

// A small zip writer (deflate, one central directory): enough for a report, no dependency.
function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const dos = date => {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return [time, day];
  };
  const [time, day] = dos(new Date());
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.content, 'utf8');
    const data = zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(day, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8); header.writeUInt16LE(8, 10);
    header.writeUInt16LE(time, 12); header.writeUInt16LE(day, 14); header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20); header.writeUInt32LE(raw.length, 24); header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

// summary: plain facts from the launcher; gameRoot / serverRoot may be empty.
async function buildReport({ summary, gameRoot, serverRoot }) {
  const entries = [{ name: 'report.txt', content: redact(summary) }];
  const add = async (file, name) => { const content = await tail(file); if (content !== null) entries.push({ name, content }); };
  if (gameRoot) {
    for (const file of await newest(path.join(gameRoot, 'Errors'), 5, /\.txt$/i)) await add(file, `client/Errors/${path.basename(file)}`);
    for (const file of await newest(path.join(gameRoot, 'Logs'), 5, /\.(log|txt)$/i)) await add(file, `client/Logs/${path.basename(file)}`);
  }
  if (serverRoot) {
    for (const file of await newest(path.join(serverRoot, 'logs'), 12, /^launcher-.*\.log$/i)) await add(file, `server/launcher/${path.basename(file)}`);
    for (const name of ['Errors.log', 'Server.log', 'Auth.log', 'world-console.log', 'supervisor.log', 'CoaBots.log']) await add(path.join(serverRoot, 'Core', 'Logs', name), `server/Core/Logs/${name}`);
    await add(path.join(serverRoot, 'mysql', 'logs', 'mysql-error.log'), 'server/mysql/mysql-error.log');
  }
  return zip(entries);
}

function systemSummary() {
  return [`Windows ${os.release()} ${os.arch()}`, `Memory: ${Math.round(os.totalmem() / 1024 ** 3)} GB (${Math.round(os.freemem() / 1024 ** 3)} GB free)`, `CPU: ${os.cpus()[0]?.model || '?'} x${os.cpus().length}`].join('\n');
}

module.exports = { buildReport, systemSummary, redact, zip };
