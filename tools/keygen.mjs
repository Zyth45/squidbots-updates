#!/usr/bin/env node
// Creates the Ed25519 key pair that signs your releases.
//   node tools/keygen.mjs keys/release
// -> keys/release.private.pem  KEEP IT SECRET: never commit it, back it up.
// -> keys/release.public.txt   the public key for launcher.config.json ("releaseKey") and the server profile.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2];
if (!base) { console.log('Usage: node tools/keygen.mjs <path/name>'); process.exit(1); }
const privateFile = `${base}.private.pem`;
if (fs.existsSync(privateFile)) { console.error(`${privateFile} already exists; refusing to overwrite a signing key.`); process.exit(1); }
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(path.dirname(path.resolve(privateFile)), { recursive: true });
fs.writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
// The DER public key is a fixed 12-byte header followed by the 32 raw key bytes.
const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64');
fs.writeFileSync(`${base}.public.txt`, raw + '\n');
console.log(`Private key: ${privateFile}  (keep it secret and backed up)`);
console.log(`Public key : ${raw}`);
