#!/usr/bin/env node
// Lists every translatable text of the launcher and what each locale still misses.
//   node tools/i18n-check.mjs            -> summary per language
//   node tools/i18n-check.mjs fr --todo  -> JSON of the missing French keys with their English text
//   node tools/i18n-check.mjs --english  -> JSON of every key with its English text
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../launcher/public');
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
})(path.join(root, 'js'));

const english = new Map();
// Keys built at run time (t(`realms.${state}`, …)): every key under such a prefix counts as used.
const built = new Set(['srv.step.', 'srv.tab.', 'err:', 'check.', 'verify.group.', 'verify.action.', 'update.step.', 'update.err.', 'update.changed.', 'race.']);
const pattern = /\bt\(\s*[`']([A-Za-z0-9_.${}]+)[`']\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g;
let everything = '';
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  everything += source;
  for (const match of source.matchAll(pattern)) {
    if (match[1].includes('${')) { built.add(match[1].split('${')[0]); continue; }
    english.set(match[1], (match[2] ?? match[3] ?? match[4]).replace(/\\(['"`])/g, '$1'));
  }
  for (const match of source.matchAll(/\bt\(\s*`([A-Za-z0-9_.]+)\$\{/g)) built.add(match[1]);
}
// The main process names keys too (notices sent to the page with their key).
for (const name of fs.readdirSync(path.join(root, '../src'))) if (name.endsWith('.cjs')) everything += fs.readFileSync(path.join(root, '../src', name), 'utf8');
// A key written whole as a string elsewhere (a table of [key, English] pairs, a key passed to a helper) is used too.
const quoted = key => everything.includes(`'${key}'`) || everything.includes(`"${key}"`) || everything.includes(`\`${key}\``);

const args = process.argv.slice(2);
if (args.includes('--english')) {
  console.log(JSON.stringify(Object.fromEntries([...english].sort()), null, 2));
  process.exit(0);
}
const locales = fs.readdirSync(path.join(root, 'locales')).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
const only = args.find(arg => !arg.startsWith('--'));
for (const lang of only ? [only] : locales) {
  const dict = JSON.parse(fs.readFileSync(path.join(root, 'locales', `${lang}.json`), 'utf8'));
  const missing = [...english.keys()].filter(key => !(key in dict)).sort();
  const unused = Object.keys(dict).filter(key => !english.has(key) && ![...built].some(prefix => prefix && key.startsWith(prefix)) && !quoted(key));
  if (args.includes('--todo')) { console.log(JSON.stringify(Object.fromEntries(missing.map(key => [key, english.get(key)])), null, 2)); continue; }
  console.log(`${lang}: ${english.size - missing.length}/${english.size} translated${missing.length ? `, missing: ${missing.join(', ')}` : ''}${unused.length ? `\n    unknown keys: ${unused.join(', ')}` : ''}`);
}
