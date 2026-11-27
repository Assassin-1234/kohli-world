# Security

## Reporting a vulnerability

If you find a real security issue in kohli.world or in this code, email **angad@kohli.world** with what you found and how to reproduce it. Please don't open a public issue for it. I'll reply as soon as I can.

## Not a vulnerability

- **The vault.** `/vault/` is an easter egg, and finding the way in is the point. Its key is derived in the open, in `main.js`. If you solved it from the source, well done; feel free to write anyway.
- **The analytics endpoint** (`POST /u/api/send`). It is meant to accept page views from anyone, and it is rate limited.

## What is in place

The site is static and accepts no input apart from the analytics beacon. Production serves it with a strict Content Security Policy (`'self'` only, no inline scripts or styles, no `eval`), HSTS with preload, COOP/COEP/CORP, a locked-down Permissions-Policy and `X-Frame-Options: DENY`. Everything, including fonts and libraries, is self-hosted. See [`deploy/nginx/`](deploy/nginx/) for the exact headers.
