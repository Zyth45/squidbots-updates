#!/usr/bin/env node
// Copies a launcher build (electron-builder output) to the download folder served to players.
//   node tools/publish-launcher.mjs launcher/dist server/data/downloads/launcher --key keys/my-realm.private.pem
// electron-updater in every installed launcher reads latest.yml and downloads the installer.
// launcher.json (+ .sig) repeats its version and SHA-512 under the realm owner's Ed25519 key:
// the launcher installs nothing that does not match it (launcherUpdateKey in launcher.config.json).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs, loadPrivateKey, writeSigned } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const [dist, output] = args._;
if (!dist || !output || !args.key) {
  console.log('Usage: node tools/publish-launcher.mjs <launcher/dist> <downloads/launcher> --key <private.pem>');
  process.exit(1);
}
const key = loadPrivateKey(args.key);
const latest = path.join(dist, 'latest.yml');
if (!fs.existsSync(latest)) { console.error('latest.yml not found: run "npm run dist" in launcher/ first.'); process.exit(1); }
const yml = fs.readFileSync(latest, 'utf8');
const installer = /^path:\s*(.+)$/m.exec(yml)?.[1].trim();
const version = /^version:\s*(.+)$/m.exec(yml)?.[1].trim();
const listed = /^sha512:\s*(.+)$/m.exec(yml)?.[1].trim();
if (!installer || installer.includes('/') || installer.includes('\\') || !version || !listed) { console.error('latest.yml does not name an installer, a version and a SHA-512.'); process.exit(1); }

const hash = crypto.createHash('sha512');
for await (const chunk of fs.createReadStream(path.join(dist, installer))) hash.update(chunk);
const sha512 = hash.digest('base64');
if (sha512 !== listed) { console.error(`${installer} does not match the SHA-512 in latest.yml: rebuild the launcher.`); process.exit(1); }

fs.mkdirSync(output, { recursive: true });
// Installer first, then the signed launcher.json, latest.yml last: a launcher never sees a
// version whose files are not all there yet.
for (const file of [installer, `${installer}.blockmap`]) {
  if (fs.existsSync(path.join(dist, file))) fs.copyFileSync(path.join(dist, file), path.join(output, file));
}
await writeSigned(path.join(output, 'launcher.json'), { schema: 1, version, file: installer, sha512, size: fs.statSync(path.join(dist, installer)).size }, key);
fs.copyFileSync(latest, path.join(output, 'latest.yml.tmp'));
fs.renameSync(path.join(output, 'latest.yml.tmp'), path.join(output, 'latest.yml'));
console.log(`Published launcher ${version} (${installer}, signed launcher.json) to ${output}`);
