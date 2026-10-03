# XClone frontend

React + Vite + TypeScript + Tailwind single-page app for the XClone API. Plan and feature list: `../docs/frontend-plan.md`.

## Run it

```bash
# 1. Backend on :8080 (scratch database, local Redis, rate limits off). Needs Postgres, Docker and Java 17+.
./scripts/e2e-backend.sh

# 2. Frontend on :5173. The dev server proxies /api and /ws to the backend, so there is no CORS to configure.
npm install
npm run dev
```

Open http://localhost:5173. Point the proxy elsewhere with `VITE_BACKEND_URL`. For a production build set `VITE_API_BASE` to the API origin
(the backend's `CORS_ALLOWED_ORIGINS` must then include the site's origin).

## Checks

```bash
npm run lint          # oxlint
npm test              # Vitest + Testing Library + MSW (API client, auth guards, helpers)
npm run build         # type-check + production bundle
npm run e2e:install   # once: downloads Chromium for Playwright
npm run e2e           # browser tests against the real backend (start it first); screenshots land in e2e/screenshots/
```

## Layout

```
src/lib/          API client (single-flight token refresh, 429 handling), token store, DTO types, cursor-query hook
src/components/ui Avatar, Button, Modal, Toast, Spinner, InfiniteList, empty/error states
src/features/     auth (context + route guards), shell (layout, nav, trends panel); more are added per step
e2e/              Playwright specs and helpers
```

## Sign-in tokens

The access token is kept in memory; the refresh token in `localStorage`. The backend rotates refresh tokens and revokes every session if an
old one is reused, so refreshes never overlap: requests in a tab share one refresh and tabs take turns through the Web Locks API
(`e2e/foundation.spec.ts` fails without that lock).
