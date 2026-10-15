'use strict';
// "Is there something newer?" for the local server: the core (repack) and the bots.
// Only the signed manifests are read; nothing is downloaded. Unknown installs never raise the flag.

function isNewer(installed, release) {
  if (!installed?.version || !release?.version || release.version === installed.version) return false;
  if (installed.publishedAt && release.publishedAt) return release.publishedAt > installed.publishedAt;
  return true;
}

async function peekUpdates({ folder, repack, bots }) {
  const out = { core: null, bots: null };
  if (!folder) return out;
  const look = async (updater, root) => {
    try {
      const [installed, release] = await Promise.all([updater.installedState(root), updater.peek()]);
      return isNewer(installed, release) ? release.version : null;
    } catch { return null; }
  };
  if (repack) out.core = await look(repack, folder);
  if (bots && (await bots.info(folder)).installed) out.bots = await look(bots.updater, bots.folder(folder));
  return out;
}

module.exports = { isNewer, peekUpdates };
