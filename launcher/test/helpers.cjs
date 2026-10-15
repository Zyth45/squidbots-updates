'use strict';
// Test fixtures: a temporary release folder served over HTTP, published with the real tools.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

// The files of a release are plain static files: any web server works. This one supports Range.
async function sendFile(req, res, root, relative) {
  const file = path.resolve(root, relative);
  if (!file.startsWith(path.resolve(root) + path.sep)) { res.writeHead(403); res.end(); return; }
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile()) { res.writeHead(404); res.end(); return; }
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : stat.size - 1;
    if (start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
    res.writeHead(206, { 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

async function tempDir(prefix = 'coa-test-') {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

function keys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, publicRaw: publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64') };
}

async function write(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, content);
  }
}

const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

// Builds latest.json (+ .sig) and objects/ from { path: content | { content, component, preserve } }.
async function publish(outDir, version, files, { key, components = [], name = 'latest.json', publishedAt = new Date().toISOString() } = {}) {
  const entries = [];
  for (const [relative, value] of Object.entries(files)) {
    const content = Buffer.from(typeof value === 'object' && !Buffer.isBuffer(value) ? value.content : value);
    const hash = sha(content);
    await fsp.mkdir(path.join(outDir, 'objects'), { recursive: true });
    await fsp.writeFile(path.join(outDir, 'objects', hash), content);
    const entry = { path: relative, size: content.length, sha256: hash };
    if (value.component) entry.component = value.component;
    if (value.preserve) entry.preserve = true;
    entries.push(entry);
  }
  const bytes = Buffer.from(JSON.stringify({ schema: 1, version, publishedAt, notes: [], components, files: entries }));
  await fsp.writeFile(path.join(outDir, name), bytes);
  if (key) await fsp.writeFile(path.join(outDir, `${name}.sig`), crypto.sign(null, bytes, key).toString('base64'));
  return entries;
}

// Static server with Range support; `hooks.before(req)` may return a status to fail a request.
async function serve(root, hooks = {}) {
  const log = [];
  const server = http.createServer(async (req, res) => {
    log.push({ url: req.url, range: req.headers.range || '' });
    const forced = hooks.before?.(req);
    if (forced) { res.writeHead(forced); res.end(); return; }
    try { await sendFile(req, res, root, decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1))); }
    catch (error) { res.writeHead(error.status || 500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, log, close: () => new Promise(resolve => server.close(resolve)) };
}

const read = (root, relative) => fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8');
const exists = (root, relative) => fs.existsSync(path.join(root, ...relative.split('/')));

module.exports = { tempDir, keys, write, publish, serve, read, exists, sha };
