#!/usr/bin/env node
// Publishes a game client (or, with --profile server, a server repack) as a signed release.
//
//   node tools/publish-client.mjs <source folder> <output folder> --version 2026-09-29 --key keys/release.private.pem
//        [--profile client|server] [--components components.json] [--notes "line"] [--notes "line"]
//        [--require Ascension.exe] [--exclude regex] [--copy] [--prune]
//
// Output: <output>/latest.json, latest.json.sig and objects/<sha256>, served as-is over HTTP(S).
// Unchanged files are stored once: every version shares the same objects.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, walk, sha256, storeObject, storeCompressed, loadPrivateKey, writeSigned, pruneObjects, releaseFormat, formatBytes } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { notes: 'list', prune: 'bool', exclude: 'list', copy: 'bool', gzip: 'bool' });
const [source, output] = args._;
if (!source || !output || !args.version) {
  console.log('Usage: node tools/publish-client.mjs <source> <output> --version <v> [--key private.pem] [--profile client|server] [--components file.json] [--notes text] [--require exe] [--exclude regex] [--prune]');
  process.exit(1);
}
const profile = args.profile === 'server' ? 'server' : 'client';
const required = args.require || (profile === 'server' ? 'worldserver.exe' : 'Wow.exe');
const key = loadPrivateKey(args.key);
if (!key) console.warn('WARNING: no --key given, the release is NOT signed. Launchers with a releaseKey will refuse it.');

// components.json: { "components": [{ "id", "name", "description", "group", "default" }],
//                    "rules": [{ "component": "hd", "match": "^Data/patch-[H-J]\\.MPQ$" }],
//                    "preserve": ["^configs/.*\\.conf$"] }
const spec = args.components ? JSON.parse(fs.readFileSync(args.components, 'utf8')) : {};
const rules = (spec.rules || []).map(rule => ({ component: rule.component, match: new RegExp(rule.match, 'i') }));
const preserve = (spec.preserve || []).map(pattern => new RegExp(pattern, 'i'));
const excludes = [/(^|\/)\.coa-launcher(\/|$)/i, /(^|\/)Thumbs\.db$/i, /(^|\/)desktop\.ini$/i, ...(spec.exclude || []).map(pattern => new RegExp(pattern, 'i')), ...(args.exclude || []).map(pattern => new RegExp(pattern, 'i'))];

const files = [];
let skipped = 0;
let stored = 0;
let bytes = 0;
for (const relative of await walk(path.resolve(source))) {
  const preserved = preserve.some(rule => rule.test(relative));
  if (excludes.some(rule => rule.test(relative)) || releaseFormat.isProtected(relative, profile, { allowSeed: preserved })) { skipped++; continue; }
  releaseFormat.checkPath(relative);
  const full = path.join(source, ...relative.split('/'));
  const size = fs.statSync(full).size;
  const hash = await sha256(full);
  // --copy: never hard-link files that keep changing after publication (a live database).
  if (await storeObject(full, path.join(output, 'objects'), hash, { copy: args.copy })) stored++;
  const entry = { path: relative, size, sha256: hash };
  const component = rules.find(rule => rule.match.test(relative))?.component;
  if (component) entry.component = component;
  if (preserved) entry.preserve = true;
  // --gzip: a compressed copy for the launchers (objects/<sha256>.gz), announced by its size.
  if (args.gzip && size > 4096) { const packed = await storeCompressed(path.join(output, 'objects'), hash, size); if (packed) entry.gz = packed; }
  // alternates: where the player's folder may already hold this very file (a disabled copy, for instance).
  const alternates = spec.alternates?.[relative];
  if (alternates?.length) entry.alt = alternates;
  files.push(entry);
  bytes += size;
  if (files.length % 200 === 0) process.stdout.write(`\r${files.length} files, ${formatBytes(bytes)}…`);
}
const manifest = {
  schema: 1,
  version: args.version,
  publishedAt: new Date().toISOString(),
  notes: args.notes || [],
  components: spec.components || [],
  files: files.sort((a, b) => a.path.localeCompare(b.path)),
  ...(spec.retire?.length ? { retire: spec.retire } : {}),
};
// Refuse to publish what the launcher would refuse to install.
releaseFormat.validateManifest(manifest, required, profile);
await writeSigned(path.join(output, 'latest.json'), manifest, key);
console.log(`\rPublished ${profile} ${args.version}: ${files.length} files, ${formatBytes(bytes)}, ${stored} new object(s), ${skipped} skipped (protected or excluded).${key ? ' Signed.' : ''}`);
if (args.prune) console.log(`Pruned ${await pruneObjects(path.join(output, 'objects'), new Set(files.map(file => file.sha256)))} unused object(s).`);
