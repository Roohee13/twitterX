# Frontend plan

A single-page app in `frontend/` talking to the existing REST + WebSocket API. Built one milestone at a time: for each one we
first discuss the details, then I build it with tests, you review it, and only then is it committed.

## Decisions

| Area | Choice | Why |
|---|---|---|
| Framework | React 19 + Vite + TypeScript | Plain SPA: no server to run, deploys as static files, backend CORS already allows `localhost:5173` |
| Styling | Tailwind CSS | Quick to build the X look (dark theme, cards), no separate CSS files to keep in sync |
| Routing | React Router (library mode) | Standard, enough for ~12 routes |
| Server data | TanStack Query | Cursor pages map directly to infinite queries; caching, retries and optimistic like/repost |
| Other state | React context for the signed-in user only | No global state library; filters live in the URL |
| Real-time | `@stomp/stompjs` | The backend speaks STOMP over `/ws` |
| Icons | `lucide-react` | |
| Forms | Plain controlled inputs | The backend already validates and returns `errors.<field>` |
| Tests | Vitest + Testing Library + MSW; a few Playwright flows at the end | Unit/component tests mock the API; e2e hits a real backend |
| Dev setup | Vite proxy `/api` and `/ws` to `localhost:8080` | No CORS problems in development |
| Location | `frontend/` in this repo, with its own CI job | One repo and one push |

## How sign-in tokens are handled (the one part worth deciding carefully)

The API returns `accessToken` and `refreshToken` in the response body (no cookies).
- The access token is kept **in memory** only.
- The refresh token is kept in **localStorage**. Simple, but readable by any script on the page, so the app must never render untrusted HTML.
- On a `401` the client refreshes once, **single-flight** (all concurrent requests wait for the same refresh). This matters because
  the backend rotates refresh tokens and treats reuse of an old one as theft: it revokes every session. Two parallel refreshes would log the user out.
- If the refresh fails, clear everything and go to the login page.
- A `429` shows "slow down" using the `Retry-After` header.

## Structure

```
frontend/src/
  lib/            api client, token handling, STOMP client, types mirroring the API DTOs
  components/ui/  buttons, avatar, modal, spinner, toast
  features/       auth, posts, users, notifications, messages, search (pages + hooks per feature)
  routes.tsx
```

## Milestones

Each ends with a working, tested slice you can click through.

| # | Milestone | Contents |
|---|---|---|
| **0** | Scaffold | Vite + React + TS + Tailwind, lint/format, Vitest, dev proxy, typed API client with the refresh logic above, `frontend` job in CI, README on running both apps |
| **1** | Auth + app shell | Register, login, logout, forgot/reset password, verify-email page, protected routes, layout (left nav, main column, right column), dark theme |
| **2** | Core feed (first usable version) | Home timeline with infinite scroll, composer (text, up to 4 images through R2 presigned upload), post card (like, repost, quote, reply, bookmark, edit, delete), post detail with thread and replies, hashtag and @mention links |
| **3** | Profiles and people | Profile page (posts / replies / likes tabs), edit profile with avatar and banner, follow / unfollow, followers and following lists, block and mute, protected-account behavior (lock icon, "requested", 403 screens) |
| **4** | Discovery | Search (people and posts), hashtag page, trending, who-to-follow, bookmarks |
| **5** | Notifications and real-time | Notifications page with unread badge, live updates over one shared STOMP connection (`lib/socket.ts`, reused by Messages), moderation notices; follow-request approve/deny lives on its own page, linked from the notification |
| **6** | Messages | Inbox (preview + unread per conversation), chat thread with older messages on request, send with retry, live delivery over the shared socket, unread badge, Message button on profiles |
| **7** | Settings and polish | Account settings (username, email, password, deactivate, delete, protection toggle), muted and blocked lists, empty/loading/error states, rate-limit messages, keyboard and screen-reader basics, mobile layout |
| **8** | Quality and deploy | Playwright flows (register, post, follow, DM), production build, deploy guide (static hosting + production CORS and R2 bucket CORS), final review |

## Backend things the frontend will need (small, tracked here)

- Production CORS origin and the R2 bucket CORS rule for browser uploads (configuration, not code).
- Local development needs `RATE_LIMIT_ENABLED=false` or the 10 logins/min limit gets in the way.
- No OpenAPI spec exists, so the API types are written by hand from the DTOs and kept in `lib/types`. If that becomes painful, adding OpenAPI to the backend is the fix.
- The timeline has no "new posts available" push; milestone 2 can simply refetch on focus and on a pull-to-refresh button.
- Polls are not built yet; the frontend leaves room for them.

## Working agreement

1. Before each milestone: a short discussion of the screens and any open choices.
2. Then I build it, run tests and click through it against the real backend.
3. I show you the result and summary; nothing is committed until you say so.
