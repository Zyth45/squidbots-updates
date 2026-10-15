#!/usr/bin/env node
// Publishes a signed addon catalog from one or more folders of addons.
//
//   node tools/publish-addons.mjs <output folder> --source C:\COA-JS\COA-AddonPack --source C:\path\to\more
//        [--meta tools/addons.meta.json] [--key keys/release.private.pem] [--prune]
//
// Folders are grouped into packages (Details + Details_*, all DBM-* ...), dependencies come
// from the .toc files, and names/categories can be fixed in the meta file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, walk, sha256, storeObject, loadPrivateKey, writeSigned, pruneObjects, releaseFormat, formatBytes } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { source: 'list', prune: 'bool' });
const [output] = args._;
if (!output || !args.source?.length) {
  console.log('Usage: node tools/publish-addons.mjs <output> --source <addons folder> [--source ...] [--meta file.json] [--key private.pem] [--prune]');
  process.exit(1);
}
const metaFile = args.meta || path.join(path.dirname(fileURLToPath(import.meta.url)), 'addons.meta.json');
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
const key = loadPrivateKey(args.key);
if (!key) console.warn('WARNING: no --key given, the catalog is NOT signed.');

const clean = text => String(text || '').replace(/\|c[0-9a-f]{8}|\|r/gi, '').replace(/\s+/g, ' ').trim();
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);

function readToc(folder, name) {
  const toc = fs.readdirSync(folder).find(file => file.toLowerCase() === `${name.toLowerCase()}.toc`) || fs.readdirSync(folder).find(file => file.toLowerCase().endsWith('.toc'));
  if (!toc) return null;
  const fields = {};
  for (const line of fs.readFileSync(path.join(folder, toc), 'utf8').split(/\r?\n/)) {
    const match = /^##\s*([^:]+):\s*(.*)$/.exec(line);
    if (match) fields[match[1].trim().toLowerCase()] = match[2].trim();
  }
  const list = value => String(value || '').split(/[\s,;]+/).filter(Boolean);
  return {
    title: clean(fields.title) || name, notes: clean(fields.notes), version: clean(fields.version), author: clean(fields.author),
    category: clean(fields['x-category']), website: clean(fields['x-website']),
    dependencies: [...new Set([...list(fields.dependencies), ...list(fields.requireddeps), ...list(fields.dependancies)])],
  };
}

// 1. Every addon folder, from every source (later sources win on name clashes).
const folders = new Map();
for (const source of args.source) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory() || /^Blizzard_/i.test(entry.name)) continue;
    const toc = readToc(path.join(source, entry.name), entry.name);
    if (!toc) { console.warn(`skip ${entry.name}: no .toc file`); continue; }
    folders.set(entry.name.toLowerCase(), { name: entry.name, root: path.join(source, entry.name), toc });
  }
}

// 2. Grouping: meta.families prefixes first, then "Name_Module" / "Name-Module" joins "Name".
const familyOf = name => {
  for (const [prefix, primary] of Object.entries(meta.families || {})) if (name.toLowerCase().startsWith(prefix.toLowerCase())) return primary;
  let best = name;
  for (const other of folders.values()) {
    if (other.name.length < best.length && other.name !== name && new RegExp(`^${other.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[_-]`, 'i').test(name)) best = other.name;
  }
  return best === name ? name : familyOf(best);
};
const groups = new Map();
for (const folder of folders.values()) {
  const primary = familyOf(folder.name);
  const id = slug(meta.ids?.[primary] || primary);
  if (!groups.has(id)) groups.set(id, { id, primary, folders: [] });
  groups.get(id).folders.push(folder);
}
const packageOfFolder = new Map();
for (const group of groups.values()) for (const folder of group.folders) packageOfFolder.set(folder.name.toLowerCase(), group.id);

// 3. Files, objects, dependencies and descriptions.
const guess = text => {
  const value = text.toLowerCase();
  if (/bot|squid/.test(value)) return 'Playerbots';
  if (/auction|gold|mail|market|trade/.test(value)) return 'Economy';
  if (/raid|boss|threat|damage|meter|heal|combat|dps/.test(value)) return 'Combat & Raids';
  if (/bag|inventory|bank/.test(value)) return 'Bags & Inventory';
  if (/item|gear|stat|loot/.test(value)) return 'Items & Gear';
  if (/quest|guide/.test(value)) return 'Questing';
  if (/profession|craft/.test(value)) return 'Professions';
  if (/map|frame|bar|interface|ui|chat|tooltip|nameplate|skin/.test(value)) return 'Interface';
  return 'Utility';
};
// Authors write X-Category freely; map the usual spellings onto one short list.
const CATEGORY_ALIASES = {
  combat: 'Combat & Raids', 'combat & raids': 'Combat & Raids', raid: 'Combat & Raids', 'action bars': 'Interface', 'interface enhancements': 'Interface',
  'chat/communication': 'Chat', chat: 'Chat', profession: 'Professions', professions: 'Professions', quests: 'Questing', quest: 'Questing',
  inventory: 'Bags & Inventory', 'bags & inventory': 'Bags & Inventory', 'unit frames': 'Interface', map: 'Interface', auction: 'Economy',
};
const normalizeCategory = value => (value ? CATEGORY_ALIASES[value.toLowerCase()] || value : '');
const packages = [];
let stored = 0;
let total = 0;
for (const group of [...groups.values()].sort((a, b) => a.id.localeCompare(b.id))) {
  const primary = group.folders.find(folder => folder.name === group.primary) || group.folders[0];
  const files = [];
  for (const folder of group.folders.sort((a, b) => a.name.localeCompare(b.name))) {
    for (const relative of await walk(folder.root)) {
      const logical = `Interface/AddOns/${folder.name}/${relative}`;
      releaseFormat.checkPath(logical);
      const full = path.join(folder.root, ...relative.split('/'));
      const hash = await sha256(full);
      if (await storeObject(full, path.join(output, 'objects'), hash)) stored++;
      const size = fs.statSync(full).size;
      files.push({ path: logical, size, sha256: hash });
      total += size;
    }
  }
  const dependencies = new Set();
  for (const folder of group.folders) {
    for (const dep of folder.toc.dependencies) {
      const owner = packageOfFolder.get(dep.toLowerCase());
      if (owner && owner !== group.id) dependencies.add(owner);
      else if (!owner) console.warn(`${group.id}: ${folder.name} needs ${dep}, which is not in the catalog (it must already be installed).`);
    }
  }
  const override = meta.packages?.[group.id] || {};
  const name = override.name || primary.toc.title;
  packages.push({
    id: group.id,
    name,
    description: override.description || primary.toc.notes || group.folders.find(folder => folder.toc.notes)?.toc.notes || '',
    version: primary.toc.version,
    category: override.category || normalizeCategory(primary.toc.category) || guess(`${name} ${primary.toc.notes}`),
    author: override.author || primary.toc.author,
    website: override.website || primary.toc.website,
    recommended: override.recommended === true,
    folders: group.folders.map(folder => folder.name),
    dependencies: [...dependencies].sort(),
    files,
  });
  process.stdout.write(`\r${packages.length} packages, ${formatBytes(total)}…`);
}
await writeSigned(path.join(output, 'catalog.json'), { schema: 1, generatedAt: new Date().toISOString(), packages }, key);
console.log(`\rPublished ${packages.length} addon packages (${folders.size} folders, ${formatBytes(total)}), ${stored} new object(s).${key ? ' Signed.' : ''}`);
if (args.prune) console.log(`Pruned ${await pruneObjects(path.join(output, 'objects'), new Set(packages.flatMap(pkg => pkg.files.map(file => file.sha256))))} unused object(s).`);
