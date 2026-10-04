# XClone frontend

React + Vite + TypeScript + Tailwind single-page app for the XClone API. Plan and feature list: `../docs/frontend-plan.md`.

## Run it

You need Postgres, Docker (for Redis) and Java 17+.

**Backend** on :8080. In IntelliJ run `XcloneBackendApplication` with the environment variables
`JWT_SECRET=<at least 32 characters, e.g. from openssl rand -hex 32>` and `DB_URL=jdbc:postgresql://localhost:5432/<an empty database>`;
start Redis with `docker compose up -d redis` from the repository root (the app also starts without it).

**Frontend** on :5173. The dev server proxies `/api` and `/ws` to the backend, so there is no CORS to configure:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Point the proxy elsewhere with `VITE_BACKEND_URL`. For a production build set `VITE_API_BASE` to the API origin
(the backend's `CORS_ALLOWED_ORIGINS` must then include the site's origin).

Until the composer exists, fill the app with demo data (users `demo_ava`, `demo_ben`, `demo_cleo`, `demo_dan`, password `password123`;
safe to run again) and sign in as `demo_ava` to see a timeline with hashtags, mentions, a quote, a repost and a protected account:

```bash
API_BASE=http://localhost:8080 npm run seed
```

Emails (verification, password reset): the easy way is the local Mailpit inbox. Run `docker compose up -d mailpit` from the repository root,
start the backend with `SPRING_MAIL_HOST=localhost` and `SPRING_MAIL_PORT=1025`, and read the emails at http://localhost:8025 (see the
Email section of the main README). Without any mail setting the backend only logs the link: look for `Email not sent (no SMTP configured)`
in its console.

## Checks

```bash
npm run lint          # oxlint
npm test              # Vitest + Testing Library + MSW (API client, auth screens and guards, helpers)
npm run build         # type-check + production bundle
npm run e2e:install   # once: downloads Chromium for Playwright

# Browser tests run against their own backend (:8090) and Vite server (:5174, reached as 127.0.0.1), so they never touch what you run on 8080/5173:
./scripts/e2e-backend.sh   # terminal 1: scratch database + Redis + backend; its log is also written to e2e/backend.log
npm run e2e                # terminal 2: starts Vite itself; screenshots land in e2e/screenshots/ (git-ignored)
```

The e2e specs read verification and reset links from `e2e/backend.log`, so the backend must be the one started by that script.
The admin specs make a test user an admin with one `psql` update on `xclone_e2e` (see `setAdmin` in `e2e/support.ts`), so `psql` must be installed;
connection settings default to the ones the script uses and can be overridden with `PGHOST`, `PGUSER`, `PGPASSWORD`, `E2E_DB`.

## Layout

```
src/lib/          API client (single-flight token refresh, 429 handling), token store, DTO types, cursor-query hook
src/components/ui Avatar, Button, Modal, Toast, Spinner, InfiniteList, empty/error states
src/features/     auth (context, guards, login, register, verify-email, password reset), shell (layout, nav, trends panel),
                  posts (card, actions, menu and dialogs, post page), compose (composer, image upload, dialog), home (timeline);
                  profile (profile page and tabs, follow/mute/block, edit profile, follower lists, follow requests),
                  explore (search, trending, hashtag page, who to follow), bookmarks, admin (report review, remove post, suspend or remove account); more are added per step
e2e/              Playwright specs and helpers
```

## Sign-in tokens

The access token is kept in memory; the refresh token in `localStorage`. The backend rotates refresh tokens and revokes every session if an
old one is reused, so refreshes never overlap: requests in a tab share one refresh and tabs take turns through the Web Locks API
(`e2e/foundation.spec.ts` fails without that lock).
