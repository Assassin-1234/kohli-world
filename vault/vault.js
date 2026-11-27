// KOHLI●WORLD / vault. The dossier is AES-256-GCM encrypted; only the key from the breach opens it.
import { V } from './data.js';

const $ = s => document.querySelector(s);
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const keyEl = $('#key'), go = $('#go'), msg = $('#msg');
let attempts = 0;

async function open(raw) {
  const k = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (k.length !== 12) throw new Error('shape');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(k), 'PBKDF2', false, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(V.salt), iterations: V.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(V.iv) }, aes, b64(V.ct));
  return { data: JSON.parse(new TextDecoder().decode(pt)), key: k };
}

function grant({ data, key }, instant) {
  try { localStorage.setItem('kw.clearance', 'granted'); localStorage.setItem('kw.key', key); } catch (e) { /* storage blocked */ }
  document.title = 'Clearance granted · KOHLI●WORLD';
  document.body.classList.add('granted');
  $('#h1').textContent = 'Clearance';
  $('#h2').textContent = 'granted.';
  $('#label').textContent = 'Vault / open';
  $('#cTR').textContent = 'Status / open';
  $('#gate').hidden = true;

  const lines = $('#lines');
  lines.textContent = '';
  data.lines.forEach(t => {
    const p = document.createElement('p');
    p.className = 'd-line';
    const bar = document.createElement('span'); bar.className = 'bar';
    const tx = document.createElement('span'); tx.className = 'tx'; tx.textContent = t;
    p.append(bar, tx);
    lines.appendChild(p);
  });
  const mail = $('#mail');
  mail.textContent = data.email;
  mail.href = 'mailto:' + data.email;
  $('#sign').textContent = data.sign;

  const card = $('#dossier');
  card.hidden = false;
  card.querySelectorAll('.bar').forEach((b, i) => b.style.setProperty('--d', (instant ? 0 : 0.35 + i * 0.28) + 's'));
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('open')));
}

async function attempt() {
  const raw = keyEl.value;
  if (!raw.trim()) return;
  go.disabled = true;
  msg.classList.remove('bad');
  msg.textContent = 'Authenticating';
  const wait = new Promise(r => setTimeout(r, 900));
  let res = null;
  try { res = await open(raw); } catch (e) { res = null; }
  await wait;
  go.disabled = false;
  if (res) {
    msg.textContent = ''; grant(res, false);
    try { window.umami && window.umami.track('vault-opened'); } catch (e) { /* tracker unavailable */ }
    return;
  }
  attempts++;
  msg.classList.add('bad');
  msg.textContent = `Denied / attempt ${String(attempts).padStart(2, '0')}`;
  const row = $('.row');
  row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
  keyEl.select();
}

go.addEventListener('click', attempt);
keyEl.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
keyEl.addEventListener('input', () => {
  const k = keyEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  keyEl.value = k.match(/.{1,4}/g)?.join('-') ?? '';
});

console.log('%cACCESS DENIED', 'color:#F3E8D2;background:#E0241B;font:700 12px/1.6 monospace;padding:4px 10px');
console.log('%cThe page says nothing. The response said more.', 'color:#a99;font:italic 11px monospace');

// returning with clearance: open straight away
(async () => {
  let k = null;
  try { k = localStorage.getItem('kw.key'); } catch (e) { /* storage blocked */ }
  if (!k) { keyEl.focus({ preventScroll: true }); return; }
  try { grant(await open(k), true); } catch (e) { /* stale key */ }
})();
