#!/usr/bin/env node
// Prepares a repack update for the squidbots-updates releases (nothing is sent: gh release create does that).
//   node tools/publish-update.mjs <CoA-Update-2.x folder or its zip> <out folder> --key <private.pem> [--notes CHANGELOG.md]
//     [--repo Zyth45/squidbots-updates]
// Writes <out>/CoA-Update-<version>.zip, update.json and update.json.sig. The launcher reads
// releases/latest/download/update.json, checks its signature, downloads the zip, checks its sha256, then runs the
// package's own coa_update.py (check, apply). Version, target release and accepted releases come from the
// package's update/update.json, so the list can never say something the tool does not do.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs, loadPrivateKey, writeSigned } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { 'allow-draft': 'bool' });
const [source, out] = args._;
if (!source || !out || !args.key) {
  console.log('Usage: node tools/publish-update.mjs <CoA-Update-2.x folder or zip> <out folder> --key <private.pem> [--notes file.md] [--repo owner/name]');
  process.exit(1);
}
const repo = args.repo || 'Zyth45/squidbots-updates';
fs.mkdirSync(out, { recursive: true });
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

// The package folder (from the folder, or read inside the zip).
let folder = source;
let zipSource = null;
if (fs.statSync(source).isFile()) {
  zipSource = source;
  const listing = execFileSync(tar, ['-tf', source], { maxBuffer: 64 << 20 }).toString().split(/\r?\n/);
  const top = listing.find(name => /^CoA-Update-[^/]+\/update\/update\.json$/.test(name));
  if (!top) throw new Error('The zip does not hold CoA-Update-x/update/update.json at its top.');
  folder = path.join(out, '.probe', top.split('/')[0]);
  fs.mkdirSync(path.dirname(folder), { recursive: true });
  execFileSync(tar, ['-xf', source, '-C', path.dirname(folder), top]);
}
const name = path.basename(path.resolve(folder));
if (!/^CoA-Update-[0-9A-Za-z.-]{1,20}$/.test(name)) throw new Error(`The package folder must be named CoA-Update-<version> (found ${name}).`);
const spec = JSON.parse(fs.readFileSync(path.join(folder, 'update', 'update.json'), 'utf8'));
// A draft is refused, except for a local test (--allow-draft with --url-base: it never reaches GitHub).
if (spec.draft && !(args['allow-draft'] && args['url-base'])) throw new Error('This package is a DRAFT (update.json "draft": true): it is not published.');
for (const key of ['version', 'targetRelease', 'fromReleases']) if (!spec[key]) throw new Error(`update.json has no ${key}.`);

// The zip: the one given, or the folder packed (its own name at the top, like the manual zip).
const zipName = `${name}.zip`;
const zip = path.join(out, zipName);
if (zipSource) fs.copyFileSync(zipSource, zip);
else { fs.rmSync(zip, { force: true }); execFileSync(tar, ['-a', '-cf', zip, '-C', path.dirname(path.resolve(folder)), name]); }
fs.rmSync(path.join(out, '.probe'), { recursive: true, force: true });
const bytes = fs.statSync(zip).size;
const hash = crypto.createHash('sha256');
for (const chunk of [fs.readFileSync(zip)]) hash.update(chunk);
const sha256 = hash.digest('hex');

const manifest = {
  product: 'coa-bots-repack',
  version: spec.version,
  release: spec.targetRelease,
  from: spec.fromReleases,
  publishedAt: new Date().toISOString(),
  notes: args.notes ? fs.readFileSync(args.notes, 'utf8') : '',
  // --url-base: where the zip is served instead of the GitHub release (a local test server).
  package: { url: args['url-base'] ? `${String(args['url-base']).replace(/\/$/, '')}/${zipName}` : `https://github.com/${repo}/releases/download/v${spec.version}/${zipName}`, sha256, size: bytes, folder: name },
};
await writeSigned(path.join(out, 'update.json'), manifest, loadPrivateKey(args.key));
console.log(`Update ${spec.version} (${spec.targetRelease}) ready in ${out}: ${zipName} ${(bytes / 1048576).toFixed(1)} MB, sha256 ${sha256.slice(0, 16)}…, from ${spec.fromReleases.length} release(s).`);
console.log(`Publish (after your OK): gh release create v${spec.version} --repo ${repo} --title "CoA Bots ${spec.version}" --notes-file <notes> "${zip}" "${path.join(out, 'update.json')}" "${path.join(out, 'update.json.sig')}"`);
