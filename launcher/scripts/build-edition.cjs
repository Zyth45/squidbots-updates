// Builds the installer of an edition: node scripts/build-edition.cjs server
// The edition's launcher.config.json and its builder settings (name, id, icon, update address) replace the
// default ones for the time of the build only; the working copy is restored afterwards.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const edition = process.argv[2];
const root = path.join(__dirname, '..');
const folder = path.join(root, 'editions', edition || '');
if (!edition || !fs.existsSync(path.join(folder, 'launcher.config.json'))) {
  console.error('Usage: node scripts/build-edition.cjs <edition>  (editions/<edition>/launcher.config.json + builder.json)');
  process.exit(1);
}
const live = path.join(root, 'launcher.config.json');
const saved = fs.readFileSync(live);
const builder = JSON.parse(fs.readFileSync(path.join(folder, 'builder.json'), 'utf8'));
const config = path.join(root, 'dist', `builder-${edition}.json`);
fs.mkdirSync(path.dirname(config), { recursive: true });
const base = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build;
fs.writeFileSync(config, JSON.stringify({ ...base, ...builder, directories: { output: `dist/${edition}`, buildResources: `editions/${edition}` } }, null, 2));
try {
  fs.copyFileSync(path.join(folder, 'launcher.config.json'), live);
  execFileSync(process.execPath, [path.join(root, 'scripts', 'copy-fonts.cjs')], { stdio: 'inherit', cwd: root });
  const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
  execFileSync(process.execPath, [cli, '--win', 'nsis', '--publish', 'never', '--config', config], { stdio: 'inherit', cwd: root });
} finally {
  fs.writeFileSync(live, saved);
}
