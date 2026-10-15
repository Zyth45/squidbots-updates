#!/usr/bin/env node
// Publishes the signed list of known repack releases (known.json + .sig): only the sha256 of each zip,
// never the zip. The launcher tells the player whether the zip they downloaded is one of them.
//
//   node tools/publish-known-repacks.mjs <out folder> --key keys/release.private.pem \
//        --zip "CoA-Repack-main-20260930-df4dea11.zip" --name "CoA Repack 30/09 (df4dea11)" --notes "By Jealous, core main df4dea11"
//
// Every run adds (or updates) one zip in the existing list.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, sha256, loadPrivateKey, writeSigned } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), {});
const [out] = args._;
if (!out || !args.zip || !args.key) {
  console.log('Usage: node tools/publish-known-repacks.mjs <out folder> --key <private.pem> --zip <file.zip> [--name text] [--notes text] [--release id]');
  process.exit(1);
}
const file = path.join(out, 'known.json');
const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { schema: 1, repacks: [] };
const hash = await sha256(args.zip);
const entry = {
  sha256: hash,
  file: path.basename(args.zip),
  size: fs.statSync(args.zip).size,
  name: String(args.name || path.basename(args.zip, '.zip')),
  release: String(args.release || (path.basename(args.zip).match(/main-\d{8}-[0-9a-f]+/) || [''])[0]),
  notes: String(args.notes || ''),
  added: new Date().toISOString(),
};
list.repacks = [entry, ...list.repacks.filter(item => item.sha256 !== hash)];
fs.mkdirSync(out, { recursive: true });
await writeSigned(file, list, loadPrivateKey(args.key));
console.log(`${entry.name}: ${hash} (${list.repacks.length} known release(s)). Signed.`);
