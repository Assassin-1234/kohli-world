// Builds the hacker trail's encrypted vault (vault/data.js) and /.well-known/security.txt.
// Run:  node tools/build-vault.mjs   (or: npm run vault)
//
// The vault's plain text lives in tools/vault.private.json, which is git-ignored so the
// repo never spoils the prize. Without it, tools/vault.example.json is used.
import { webcrypto as crypto } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const SITE = 'https://kohli.world';

// --- what the vault reveals ---
const privateFile = new URL('./vault.private.json', import.meta.url);
const source = existsSync(privateFile) ? privateFile : new URL('./vault.example.json', import.meta.url);
const VAULT = JSON.parse(readFileSync(source, 'utf8'));
if (source !== privateFile) console.warn('tools/vault.private.json not found, using the example note.');

// --- the crater's coordinates, computed exactly as main.js does ---
const STEP = 1.9;
const ROT0 = -Math.PI / 4 - 4 * STEP;
const deg = r => r * 180 / Math.PI, rad = d => d * Math.PI / 180;
const SURF = deg(ROT0 + 2 * STEP + Math.PI / 2);
const la = rad(22), lo = rad(SURF + 8);
const v = [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
const lat = deg(Math.asin(v[1])), lon = deg(Math.atan2(v[2], v[0]));
const label = `${Math.abs(lat).toFixed(2)}${lat >= 0 ? 'N' : 'S'}/${Math.abs(lon).toFixed(2)}${lon >= 0 ? 'E' : 'W'}`;

// --- the key, derived exactly as main.js does at the breach ---
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('breach/' + label)));
let key = ''; for (let i = 0; i < 12; i++) key += ALPHA[d[i] % 32];

// --- encrypt: PBKDF2-SHA256 -> AES-256-GCM ---
const ITER = 310000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), 'PBKDF2', false, ['deriveKey']);
const aes = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(VAULT))));
const b64 = u => Buffer.from(u).toString('base64');
writeFileSync(new URL('../vault/data.js', import.meta.url),
  `// Encrypted. The key is out there, at the weak point in the shield.\nexport const V = ${JSON.stringify({ iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) })};\n`);

// --- security.txt (RFC 9116) with the trail's next step tucked in a comment ---
const pretty = label.replace(/(\d)([NS])\//, '$1°$2 ').replace(/(\d)([EW])$/, '$1°$2');
const hint = Buffer.from(`where the shield is thinnest: ${pretty}. knock there.`).toString('base64');
writeFileSync(new URL('../.well-known/security.txt', import.meta.url), `# KOHLI●WORLD
# You read the headers. Good.
# Every shield has a weak point. This one is written down:
# ${hint}

Contact: ${SITE}/vault/
Expires: 2027-11-23T00:00:00.000Z
Preferred-Languages: en
Canonical: ${SITE}/.well-known/security.txt
`);

console.log('crater:', label, '| key:', key.match(/.{4}/g).join('-'));
