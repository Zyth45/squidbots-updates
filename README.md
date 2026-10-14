# SquidBots Updates

The updater of the **CoA Bots repack** (Conquest of Azeroth + playerbots): it keeps the repack, the SquidBots addon
and the bots dashboard up to date. Download the full repack once; after that, every new version comes from here.

## How it works

1. The launcher checks this repository's latest release every 30 minutes and shows when a new version is out.
2. One click: it downloads the update and checks its signature (Ed25519) and the fingerprint of every file.
3. The update itself is the same tool as the manual one (`coa_update.py`):
   - checks first, nothing is written while one fails;
   - a full backup (database and files);
   - a clean stop of the server;
   - the new files, your settings kept (missing settings added);
   - the bot database, the addon, then a test start.
4. Something went wrong? **Undo** puts the backup back. An update cut by a crash or a power loss is finished or
   undone at the next start.

## Releases

Each release holds the update in a few archives, a signed `latest.json` that lists them, and the launcher
installer. Files are only installed when their signature and fingerprint match.

## Status

Work in progress for CoA Bots 2.4. The launcher source will be published here.

## License

MIT
