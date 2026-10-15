#!/usr/bin/env node
// Signs the news feed of the launcher: download links (repack, client), known repack releases, news.
//   node tools/publish-feed.mjs <feed.json you edit> <out folder> --key keys/release.private.pem
// Writes <out>/feed.json and feed.json.sig. The launcher reads them at start and every 30 minutes.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs, loadPrivateKey, writeSigned } from './lib.mjs';

const require = createRequire(import.meta.url);
const { cleanFeed } = require('../launcher/src/feed.cjs');
const args = parseArgs(process.argv.slice(2), {});
const [source, out] = args._;
if (!source || !out || !args.key) {
  console.log('Usage: node tools/publish-feed.mjs <feed.json> <out folder> --key <private.pem>');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(source, 'utf8'));
raw.publishedAt = new Date().toISOString();
// What the launcher would keep: a link that is not https, a news item without a title... is dropped there,
// so it is reported here.
const clean = cleanFeed(raw);
for (const kind of ['repack', 'client']) if (raw[kind] && !clean[kind]) console.warn(`WARNING: "${kind}" is ignored: its url must start with https://`);
if ((raw.news || []).length !== clean.news.length) console.warn('WARNING: some news items have no title and are ignored.');
fs.mkdirSync(out, { recursive: true });
await writeSigned(path.join(out, 'feed.json'), clean, loadPrivateKey(args.key));
console.log(`Feed signed: repack ${clean.repack ? clean.repack.name || clean.repack.release : '-'}, client ${clean.client ? 'yes' : '-'}, ${clean.repacks.length} known release(s), ${clean.news.length} news item(s).`);
