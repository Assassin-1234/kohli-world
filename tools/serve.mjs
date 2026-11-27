// Local preview with the same security headers as production, so CSP problems show up here first.
// Run:  node tools/serve.mjs   (or: npm run dev)   ->  http://127.0.0.1:5178
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 5178;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json'
};
const SEC = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY'
};
// never served: source-only folders, docs, dotfiles (except .well-known)
const PRIVATE = /^\/(tools|deploy|docs|node_modules)(\/|$)|\.md$|^\/package(-lock)?\.json$|\/\.(?!well-known\/)/;
// stand-in for the Umami tracker: logs what would be sent instead of sending it
const UMAMI_STUB = 'window.umami = { track(a) { console.log("[umami]", typeof a === "function" ? JSON.stringify(a({ url: location.pathname, title: document.title })) : (a || "pageview")); } };';

http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, SEC); return res.end(); }
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400, SEC); return res.end(); }
  if (PRIVATE.test(p)) { res.writeHead(404, SEC); return res.end('not found'); }
  if (p === '/u/k.js') { res.writeHead(200, { ...SEC, 'content-type': 'text/javascript' }); return res.end(UMAMI_STUB); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403, SEC); return res.end(); }
  try {
    const body = await readFile(file);
    const headers = { ...SEC, 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' };
    if (p.startsWith('/vault/')) {
      headers['X-Shield'] = 'engaged; weak-point=surface';
      headers['Link'] = '</.well-known/security.txt>; rel="help"';
      headers['X-Robots-Tag'] = 'noindex, nofollow';
    }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, SEC);
    res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`KOHLI●WORLD on http://127.0.0.1:${PORT}`));
