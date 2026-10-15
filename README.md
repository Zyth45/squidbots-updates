# SquidBots Updates

The launcher and the updates of the **CoA Bots repack** (Conquest of Azeroth + playerbots). Download the full repack
once; after that the launcher brings every new version of the core, the bots, the SquidBots addon and the dashboard.

**Players:** download the launcher from the [launcher release](https://github.com/Zyth45/squidbots-updates/releases/tag/launcher)
(`SquidBots-Server-Setup-x.y.z.exe`), install it, then import the full repack zip or point it at an unpacked repack.

## How updates work

1. **Published here.** Each repack update is a release (`v2.3`, …): a zip of the update package and `update.json`,
   signed with the project's Ed25519 key. The release text is the patch note shown in the launcher.
2. **Detected.** The launcher reads `releases/latest/download/update.json` at start and every 30 minutes, checks its
   signature and compares it with the repack's `RELEASE.json`.
3. **Installed.** One click: download (sha256 checked), then the package's own `coa_update.py`: checks, full backup,
   clean stop, new files with your settings kept, bot database, addon, test start. **Undo** puts the backup back; an
   update cut by a crash is finished or undone at the next start.
4. **The launcher itself** updates from the `launcher` pre-release: `latest.yml` + `launcher.json` (signed SHA-512).
   It installs nothing that does not match the signature.

## What is in this repository

- `launcher/` — the Electron app (SquidBots Server edition: `editions/server/`).
  - `src/` main process: repack updates (`repack-update.cjs`), modules (`modules.cjs`), addon sync, console and live
    stats, checks, backups, settings; `public/` the pages; `test/` the tests (`node --test test/`).
- `tools/` — publishing: `keygen.mjs`, `publish-update.mjs` (update package → zip + signed `update.json`),
  `publish-launcher.mjs`, `publish-feed.mjs`.

## Build

```
cd launcher
npm install
node --test test/
node scripts/build-edition.cjs server     # → dist/server/SquidBots-Server-Setup-<version>.exe
```

## Publish (maintainers)

```
node tools/publish-update.mjs <CoA-Update-2.x folder or zip> out/ --key keys/squidbots-release.private.pem --notes CHANGELOG.md
gh release create v2.x out/CoA-Update-2.x.zip out/update.json out/update.json.sig --notes-file CHANGELOG.md --latest
```

The private key never leaves the maintainer's machine (`keys/` is ignored).

## Credits

- CoA Bots / SquidBots: Zyth45 — [mod-playerbots](https://github.com/Zyth45/mod-playerbots)
- Multirace: Ilusixn — [azerothcore-wotlk-coa](https://github.com/ilusixn/azerothcore-wotlk-coa)
- Auction house bot: [AzerothCore mod-ahbot](https://github.com/azerothcore/mod-ahbot)

## License

MIT
