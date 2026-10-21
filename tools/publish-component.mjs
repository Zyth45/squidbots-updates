#!/usr/bin/env node
// Prepares a component published on its own (release "components" of squidbots-updates): nothing is sent.
//   node tools/publish-component.mjs <addon|dashboard> <zip> <out folder> --key <private.pem> [--notes file.md]
//     [--url-base http://127.0.0.1:8777] [--repo Zyth45/squidbots-updates] [--min-launcher 0.3.27] [--min-bots 2.6]
//   --min-bots: the CoA Bots version the server needs (an addon talks to the bots module of its version).
// Writes <out>/<name>-<version>.zip, <name>.json and <name>.json.sig. The version is read inside the zip (the
// addon's SquidBotsLite.toc, the dashboard's VERSION): a beta is refused, it must not replace a final version.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs, loadPrivateKey, writeSigned } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const [name, source, out] = args._;
if (!['addon', 'dashboard'].includes(name) || !source || !out || !args.key) {
  console.log('Usage: node tools/publish-component.mjs <addon|dashboard> <zip> <out folder> --key <private.pem> [--notes file.md] [--url-base url] [--min-launcher x.y.z] [--min-bots x.y]');
  process.exit(1);
}
const repo = args.repo || 'Zyth45/squidbots-updates';
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const listing = execFileSync(tar, ['-tf', source], { maxBuffer: 64 << 20 }).toString().split(/\r?\n/).filter(Boolean);
const read = entry => execFileSync(tar, ['-xOf', source, entry], { maxBuffer: 16 << 20 }).toString('utf8');

let version;
if (name === 'addon') {
  if (listing.some(entry => entry.split('/')[0] !== 'SquidBotsLite')) throw new Error('The addon zip must hold only the SquidBotsLite folder at its top.');
  version = /^##\s*Version:\s*(.+)$/m.exec(read('SquidBotsLite/SquidBotsLite.toc'))?.[1].trim();
} else {
  if (!listing.includes('VERSION')) throw new Error('The dashboard zip must have its files (and VERSION) at its top.');
  version = read('VERSION').trim();
}
if (!/^\d+(\.\d+){0,3}$/.test(version || '')) throw new Error(`Version "${version}" is not a final version (a beta is never published here).`);

fs.mkdirSync(out, { recursive: true });
const zipName = `${name}-${version}.zip`;
const zip = path.join(out, zipName);
fs.copyFileSync(source, zip);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
const size = fs.statSync(zip).size;
const url = args['url-base'] ? `${String(args['url-base']).replace(/\/$/, '')}/${zipName}` : `https://github.com/${repo}/releases/download/components/${zipName}`;
const list = { product: 'coa-component', name, version, url, sha256, size, publishedAt: new Date().toISOString(), notes: args.notes ? fs.readFileSync(args.notes, 'utf8') : '', ...(args['min-launcher'] ? { minLauncher: String(args['min-launcher']) } : {}), ...(args['min-bots'] ? { minBots: String(args['min-bots']) } : {}) };
if (name === 'addon' && !list.minBots) console.warn('Warning: no --min-bots: this addon will be offered to every server, old ones included.');
await writeSigned(path.join(out, `${name}.json`), list, loadPrivateKey(args.key));
console.log(`${name} ${version} ready in ${out}: ${zipName} ${(size / 1024).toFixed(0)} KB, sha256 ${sha256.slice(0, 16)}…`);
console.log(`Publish (after your OK): gh release upload components --repo ${repo} --clobber "${zip}" "${path.join(out, `${name}.json`)}" "${path.join(out, `${name}.json.sig`)}"  (first time: gh release create components --prerelease --title "Components" --notes "Addon and dashboard published on their own")`);
