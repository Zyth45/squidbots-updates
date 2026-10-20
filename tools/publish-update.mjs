#!/usr/bin/env node
// Prepares a repack update for the squidbots-updates releases (nothing is sent: gh release create does that).
//   node tools/publish-update.mjs <CoA-Update-2.x folder or its zip> <out folder> --key <private.pem> [--notes CHANGELOG.md]
//     [--repo Zyth45/squidbots-updates] [--channel beta]
// Writes <out>/CoA-Update-<version>.zip, update.json and update.json.sig. The launcher reads
// releases/latest/download/update.json, checks its signature, downloads the zip, checks its sha256, then runs the
// package's own coa_update.py (check, apply). Version, target release and accepted releases come from the
// package's update/update.json, so the list can never say something the tool does not do.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs, loadPrivateKey, writeSigned } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { 'allow-draft': 'bool', part: 'list' });
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
// Read in pieces: a package may be close to 2 GiB.
const sha256Of = file => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
});
const LIMIT = 2 * 1024 ** 3;
const bytes = fs.statSync(zip).size;
if (bytes >= LIMIT) throw new Error(`${zipName} is ${bytes} bytes: GitHub takes files under 2 GiB. Split the package (--part).`);
const sha256 = await sha256Of(zip);

// --part <zip> (repeatable): more zips of the same package, each holding the same CoA-Update-x folder at its top.
// --part <zip>=<release>,<release>: a part only the servers on these releases download (launcher 0.3.32 or newer).
const parts = [];
for (const partArg of args.part || []) {
  const [partSource, fromList] = partArg.split('=');
  const partFrom = fromList ? fromList.split(',').map(item => item.trim()).filter(Boolean) : null;
  const listing = execFileSync(tar, ['-tf', partSource], { maxBuffer: 256 << 20 }).toString().split(/\r?\n/).filter(Boolean);
  if (!listing.length || listing.some(entry => entry.split('/')[0] !== name)) throw new Error(`${path.basename(partSource)} must hold only the ${name} folder at its top.`);
  const partName = path.basename(partSource);
  const target = path.join(out, partName);
  if (path.resolve(target) !== path.resolve(partSource)) fs.copyFileSync(partSource, target);
  const size = fs.statSync(target).size;
  if (size >= LIMIT) throw new Error(`${partName} is ${size} bytes: GitHub takes files under 2 GiB.`);
  parts.push({ name: partName, file: target, size, sha256: await sha256Of(target), from: partFrom });
}

// --channel beta: signed as a beta and served from the fixed "beta" pre-release (testers only).
const channel = args.channel === 'beta' ? 'beta' : 'stable';
// --url-base: where the files are served instead of the GitHub release (a local test server).
const fileUrl = file => (args['url-base'] ? `${String(args['url-base']).replace(/\/$/, '')}/${file}` : `https://github.com/${repo}/releases/download/${channel === 'beta' ? 'beta' : `v${spec.version}`}/${file}`);
const manifest = {
  product: 'coa-bots-repack',
  version: spec.version,
  channel,
  release: spec.targetRelease,
  from: spec.fromReleases,
  publishedAt: new Date().toISOString(),
  notes: args.notes ? fs.readFileSync(args.notes, 'utf8') : '',
  // A notice shown before the click (a big update, files replaced...) and the free space it needs, from the package.
  ...(spec.notice ? { notice: spec.notice } : {}),
  ...(Number(spec.diskBytes) > 0 ? { diskBytes: Number(spec.diskBytes) } : {}),
  // The oldest launcher that can install this package (a newer one is asked for first).
  ...((args['min-launcher'] || spec.minLauncher) ? { minLauncher: String(args['min-launcher'] || spec.minLauncher) } : {}),
  package: { url: fileUrl(zipName), sha256, size: bytes, folder: name, ...(parts.length ? { parts: parts.map(part => ({ url: fileUrl(part.name), sha256: part.sha256, size: part.size, ...(part.from ? { from: part.from } : {}) })) } : {}) },
};
await writeSigned(path.join(out, 'update.json'), manifest, loadPrivateKey(args.key));
console.log(`Update ${spec.version} (${spec.targetRelease}) ready in ${out}: ${zipName} ${(bytes / 1048576).toFixed(1)} MB, sha256 ${sha256.slice(0, 16)}…, from ${spec.fromReleases.length} release(s).`);
for (const part of parts) console.log(`  part ${part.name} ${(part.size / 1048576).toFixed(1)} MB, sha256 ${part.sha256.slice(0, 16)}…`);
const assets = [zip, ...parts.map(part => part.file)].map(file => `"${file}"`).join(' ');
if (channel === 'beta') console.log(`Publish the beta (after your OK): gh release upload beta --repo ${repo} --clobber ${assets} "${path.join(out, 'update.json')}" "${path.join(out, 'update.json.sig')}"  (first time: gh release create beta --prerelease --title "CoA Bots beta" --notes "Beta versions for testers")`);
else console.log(`Publish (after your OK): gh release create v${spec.version} --repo ${repo} --title "CoA Bots ${spec.version}" --notes-file <notes> ${assets} "${path.join(out, 'update.json')}" "${path.join(out, 'update.json.sig')}"`);
