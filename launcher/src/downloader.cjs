'use strict';
// Content-addressed download: objects/<sha256>, resumed with HTTP Range, verified before use.
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { statOrNull, hashFile } = require('./release-format.cjs');

const STALL_MS = 30000;

// gz: the compressed size when objects/<sha256>.gz exists. The .gz is downloaded (resumable, checked by its
// size), unpacked, and only a result with the right sha256 is kept.
async function downloadObject(options) {
  const { url, size, sha256, destination, signal, gz } = options;
  if (!gz) return downloadFile(options);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if ((await statOrNull(destination))?.size === size && await hashFile(destination, signal) === sha256) { options.onBytes?.(gz); return destination; }
  const packed = destination + '.gz';
  await downloadFile({ ...options, url: new URL(`${url.href || url}.gz`), size: gz, sha256: null, destination: packed });
  const temp = destination + '.unpack';
  const hash = crypto.createHash('sha256');
  let written = 0;
  await pipeline(createReadStream(packed), zlib.createGunzip(), async function* (source) {
    for await (const chunk of source) {
      written += chunk.length;
      if (written > size) throw new Error('The unpacked file is larger than announced.');
      hash.update(chunk);
      yield chunk;
    }
  }, createWriteStream(temp), { signal });
  await fs.unlink(packed).catch(() => {});
  if (written !== size || hash.digest('hex') !== sha256) { await fs.unlink(temp).catch(() => {}); throw new Error('The downloaded file failed verification.'); }
  await fs.rename(temp, destination);
  return destination;
}

// sha256 null: the file is only checked by its size (a compressed object, verified once unpacked).
async function downloadFile({ url, size, sha256, destination, signal, fetchImpl = fetch, onBytes = () => {}, redirect = 'error' }) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const part = destination + '.part';
  const verified = async file => sha256 === null || await hashFile(file, signal) === sha256;
  if ((await statOrNull(destination))?.size === size && await verified(destination)) { onBytes(size); return destination; }
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    signal.throwIfAborted();
    const existing = await statOrNull(part);
    let have = existing?.size || 0;
    if (have > size) { await fs.unlink(part); have = 0; }
    if (existing && have === size) {
      if (await verified(part)) { await fs.rename(part, destination); onBytes(size); return destination; }
      await fs.unlink(part); have = 0;
    }
    const stall = new AbortController();
    let timer = setTimeout(() => stall.abort(new Error('Download stalled.')), STALL_MS);
    let handle;
    try {
      const response = await fetchImpl(url, {
        redirect,
        headers: { 'Accept-Encoding': 'identity', ...(have ? { Range: `bytes=${have}-` } : {}) },
        signal: AbortSignal.any([signal, stall.signal]),
      });
      if (response.status !== 200 && response.status !== 206) throw new Error(`Download failed (HTTP ${response.status}).`);
      const encoding = response.headers.get('content-encoding');
      if (encoding && encoding !== 'identity') throw new Error('The download server must send uncompressed files.');
      if (response.status === 206) {
        if (response.headers.get('content-range') !== `bytes ${have}-${size - 1}/${size}`) throw new Error('The download server returned an invalid range.');
      } else {
        have = 0;
      }
      handle = await fs.open(part, have ? 'a' : 'w');
      onBytes(have);
      for await (const chunk of response.body) {
        clearTimeout(timer);
        timer = setTimeout(() => stall.abort(new Error('Download stalled.')), STALL_MS);
        signal.throwIfAborted();
        if (have + chunk.length > size) throw new Error('The downloaded file is larger than announced.');
        await handle.write(chunk);
        have += chunk.length;
        onBytes(have);
      }
      await handle.sync();
      await handle.close();
      handle = null;
      if (have !== size) throw new Error('The download was incomplete.');
      if (!(await verified(part))) { await fs.unlink(part); throw new Error('The downloaded file failed verification.'); }
      await fs.rename(part, destination);
      return destination;
    } catch (error) {
      lastError = error;
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : error;
      await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
      if (handle) await handle.close().catch(() => {});
    }
  }
  throw lastError;
}

module.exports = { downloadObject };
