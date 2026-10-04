# Deploying XClone

Four pieces, each deployed on its own:

| Piece | What | Where it can run |
|---|---|---|
| Database | Postgres | Neon (see README, *Neon*) |
| Cache / rate limits / WebSocket relay | Redis | Upstash or any Redis (`rediss://` for TLS) |
| Images | S3-compatible bucket | Cloudflare R2 (README, *Cloudflare R2 setup*) |
| Backend | the Docker image built from `Dockerfile` | any container host (Fly.io, Render, Railway, a VM, Kubernetes) |
| Frontend | static files from `frontend/dist` | any static host (Cloudflare Pages, Netlify, Vercel, S3 + CDN, nginx) |

The frontend and the backend live on **different origins** (for example `https://app.example.com` and `https://api.example.com`). The built app
talks to the API directly, over HTTPS for requests and WSS for the live connection. The browser tests run against exactly that arrangement
(production build on one port, API on another), so it is a tested setup, not just a documented one.

## 1. Backend

Build and run the image (`docker build -t xclone-backend .`), or let your host build it from the `Dockerfile`. Everything is configured with
environment variables; `.env.example` lists them all. The ones that must be right for production:

| Variable | Production value |
|---|---|
| `JWT_SECRET` | at least 32 random bytes (`openssl rand -hex 32`). Required, the app will not start without it. Changing it signs everyone out |
| `DB_URL`, `DB_USER`, `DB_PASSWORD` | the Neon **pooled** host (`-pooler`), `sslmode=require` |
| `MIGRATION_DB_URL` | the Neon **direct** host. Flyway runs migrations (V1 to V5) at start-up through it |
| `REDIS_URL` | the `rediss://` URL. Redis may be down at boot: the app starts and joins the relay later |
| `CORS_ALLOWED_ORIGINS` | the frontend origin(s), exactly, comma separated: `https://app.example.com`. **Also applies to the WebSocket handshake**, so a missing origin breaks live updates, not only REST |
| `FRONTEND_URL` | `https://app.example.com`. Verify-email and reset-password links point here |
| `R2_*` | account id, keys, bucket, and `R2_PUBLIC_BASE_URL` (the public address images are served from) |
| `SPRING_MAIL_HOST`, `_PORT`, `_USERNAME`, `_PASSWORD`, `MAIL_FROM` | a transactional email provider's SMTP settings (README, *Email*, *Production*); a personal Gmail account is for development only. Without it emails are only logged, so nobody can verify their address or reset a password. After deploying, use **Settings > Email delivery > Send test email** as an admin to confirm it works |
| `FORWARD_HEADERS_STRATEGY` | `framework` when the app sits behind a proxy or load balancer, so rate limits see the real client address |
| `RATE_LIMIT_ENABLED` | `true` (the default) |

Behind a load balancer: use `/actuator/health/readiness` as the readiness probe, no sticky sessions are needed (pushes go through Redis), and make
sure it allows WebSocket upgrades on `/ws` and does not close idle connections too eagerly (the browser reconnects by itself, but a 60 second
idle limit makes it do so constantly).

The first admin is made in the database, once (Neon SQL editor or `psql`):

```sql
update users set is_admin = true where username = 'your_username';
```

## 2. Frontend

```bash
cd frontend
npm ci
VITE_API_BASE=https://api.example.com npm run build   # writes frontend/dist
```

`VITE_API_BASE` is read **at build time** and is the only setting. The WebSocket address is derived from it (`https://` becomes `wss://`, plus `/ws`).
Leave it unset only when something proxies `/api` and `/ws` to the backend on the same origin.

Upload `frontend/dist` to the static host. Two things the host must do:

1. **Serve `index.html` for every path** that is not a file (the app has its own routes: `/u/alice`, `/messages/12` ...). The build already contains
   `_redirects` with `/* /index.html 200`, which Cloudflare Pages and Netlify read. Elsewhere:
   - Vercel: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }` in `vercel.json`
   - nginx: `location / { try_files $uri /index.html; }`
2. **Cache sensibly**: files under `assets/` have a content hash in their name, so they can be cached for a year (`Cache-Control: public, max-age=31536000, immutable`);
   `index.html` must not be cached (`no-cache`), or visitors keep an old page that points at files that no longer exist.

Email links open `/verify-email?token=...` and `/reset-password?token=...`; those routes work signed in or out, on any device.

## 3. Image uploads (R2 bucket CORS)

The full Cloudflare walkthrough (bucket, public access, API token, settings) is in the README, *Cloudflare R2 setup*. After deploying, an admin can confirm everything with **Settings > Image storage > Check image storage**, which also tests the CORS rule from the browser.

Browsers upload straight to the bucket with a presigned URL, so the bucket needs a CORS rule for the **frontend** origin:

```json
[{ "AllowedOrigins": ["https://app.example.com"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type", "content-length"], "MaxAgeSeconds": 3600 }]
```

Keep the `http://localhost:5173` entry too if you also develop against this bucket.

## 4. Optional hardening

- **Content-Security-Policy.** Not enabled by default, and not tested here. A starting point to try with `Content-Security-Policy-Report-Only` first:
  `default-src 'self'; connect-src 'self' https://api.example.com wss://api.example.com; img-src 'self' data: blob: https://<your R2_PUBLIC_BASE_URL host>; style-src 'self' 'unsafe-inline'`
  (`'unsafe-inline'` for styles because a few elements set widths with `style=""`). The theme script is a separate file (`/theme-init.js`), so `script-src 'self'` is enough; no inline script is needed.
- Other headers worth adding at the static host: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.
- The refresh token is kept in `localStorage`, so the app must never render untrusted HTML. It does not (post text is always escaped), and a CSP is a good second line of defence.

## 5. After deploying: a five-minute check

1. `https://api.example.com/actuator/health` answers `{"status":"UP"}`.
2. Open the app, register. The verification email arrives and its link opens the app (checks `FRONTEND_URL` and SMTP).
3. Post with a picture (checks R2 and the bucket CORS rule).
4. Open a second browser as another user, follow the first and like a post: the notification badge changes **without reloading** (checks the WebSocket, `CORS_ALLOWED_ORIGINS` and the Redis relay).
5. Reload a deep link such as `/u/yourname` (checks the single-page fallback on the static host).
6. Sign in as the admin and open `/admin/reports` (checks `is_admin`).

## 6. Rolling out changes

Database migrations are forward-only and run at start-up (Flyway). Deploy the backend first, then the frontend: a new backend keeps answering the old
frontend, but a new frontend may use endpoints the old backend does not have. If a migration must run before any instance of the new version starts,
run one instance first and scale up afterwards.
