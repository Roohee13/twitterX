# X clone backend

A minimal X (Twitter) clone REST API built with Spring Boot 4, PostgreSQL, and Cloudflare R2 for images.

Features: JWT auth (access + rotating refresh tokens), profiles, posts with up to 4 images, replies, likes, follows, blocking, a home timeline, and user search.

## Running locally

Requirements: Java 17+ and a local PostgreSQL.

```bash
createdb -U postgres xclone          # once
createdb -U postgres xclone_test     # once, used by the tests
./mvnw spring-boot:run
```

The schema is managed by Flyway (`src/main/resources/db/migration`) and applied on startup; Hibernate only validates it. **Any entity change needs a new `V<n>__*.sql` migration.** Configuration comes from environment variables; see `.env.example`. The defaults connect to `localhost:5432/xclone` as `postgres`/`postgres`. **`JWT_SECRET` (at least 32 bytes) is required**, so export one before running, e.g. `export JWT_SECRET=$(openssl rand -hex 32)`.

### Redis

Redis backs shared state (rate limits, caches, counters) so the API can run as several instances. Locally run
`docker compose up -d redis`; in production set `REDIS_URL` (Upstash: the `rediss://` TLS URL). The app connects lazily.

### Rate limiting

Redis-backed fixed-window limits (`ratelimit/RateLimitRules.java`), answering `429` with `Retry-After`:

| Scope | Limit |
|---|---|
| Login, per IP | 10 / min |
| Register, per IP | 10 / hour |
| Forgot / reset password, per IP | 5 / 10 per hour |
| Other `/auth` calls, per IP | 60 / min |
| Create post / thread, per user | 100 / hour, 20 / hour |
| Send message (REST), per user | 60 / min |
| Media upload URL, per user | 30 / min |
| Follow, per user | 100 / hour |
| Report user / post, per user | 20 / hour |
| Any other write (`POST/PUT/PATCH/DELETE`), per user | 120 / min |

Reads are not limited. If Redis is unreachable the limiter fails open and retries Redis after 30 s. Behind a load balancer set
`FORWARD_HEADERS_STRATEGY=framework` so limits use the real client IP; leave it unset otherwise (the header is spoofable).
**Important:** on a managed host (Render, Fly, Railway, a cloud load balancer) the app sits behind a proxy, so without that setting every user shares the proxy's IP and therefore one login limit. Set it there, and only if clients cannot reach the app except through the proxy.
`RATE_LIMIT_ENABLED=false` turns it off. Messages sent over the WebSocket are not covered yet.

### Real-time (WebSocket / STOMP)

Connect to `ws://<host>/ws` and send the access token in the STOMP `CONNECT` frame header `Authorization: Bearer <token>`
(browsers cannot set headers on the handshake). Subscribe to per-user queues:

| Destination | Payload |
|---|---|
| `/user/queue/notifications` | a new notification, same shape as items from `GET /notifications`. Pushed after the action commits; none for blocked pairs or self-actions |
| `/user/queue/messages` | a direct message received |
| `/user/queue/sent` | ack of a message you sent over WebSocket |
| `/user/queue/errors` | errors from messages you sent over WebSocket |

Send messages to `/app/conversations/{id}/messages`. Pushes are best-effort: a client that is offline or reconnecting misses them, so
on connect (and reconnect) fetch `GET /notifications/unread-count` and the latest page over REST, then increment from pushes.

**Running several instances.** Pushes (notifications and messages) are published to the Redis channel `ws:user-push` and every instance
delivers them to the sessions it holds, so a user receives them on whichever instance they are connected to. This is on by default
(`WS_REDIS_RELAY=false` turns it off for a single instance). Redis does not have to be up at boot: the app starts, delivers pushes to
its own sessions only, and joins the relay as soon as Redis is reachable. Put the load balancer in front with no sticky sessions
requirement for pushes; the WebSocket itself stays on the instance that accepted it. Messages sent *over* the socket are handled by
the instance holding that socket and relayed to the recipient the same way.

### Neon

Use Neon's pooled connection string (host contains `-pooler`) as `DB_URL` and its direct string as `MIGRATION_DB_URL`, both with `?sslmode=require`; see `.env.example`. Use an **empty** database: V1 creates the whole schema. Keep the app in the **same cloud region** as the Neon project: every query is a network round trip that holds a pooled connection, so per-instance throughput is about `DB_POOL_SIZE / (queries per request x latency)` (see `loadtest/README.md`). Neon's pooler accepts many client connections, so `DB_POOL_SIZE` can be raised (30-50) when you run few instances.

A database that already has the complete schema from the older `ddl-auto` setup (e.g. a local `xclone`) must be adopted once with `FLYWAY_BASELINE_ON_MIGRATE=true`; a non-empty database without it fails at startup rather than being half-adopted.

R2 is optional for local development. Without `R2_ACCOUNT_ID`/`R2_ACCESS_KEY`/`R2_SECRET_KEY`, everything works except media endpoints, which return `503`.

Run the tests with `./mvnw test`. They need the `xclone_test` database, and R2 is mocked.

## Docker and CI

```bash
docker build -t xclone-backend .
docker run -p 8080:8080 --env-file .env xclone-backend   # JWT_SECRET is required; see .env.example
```

The image is a two-stage build (JDK builds, JRE runs as a non-root user). `docker-compose.yml` only starts a local Redis.
GitHub Actions (`.github/workflows/ci.yml`) runs `./mvnw verify` against Postgres and Redis service containers on every push to
`main` and every pull request, then checks that the Docker image builds. Tests need no secrets.

## Health checks

`GET /actuator/health` (public, no details) is the only actuator endpoint exposed.
- `/actuator/health/liveness`: the process is running. Use it to decide when to restart (the Docker `HEALTHCHECK` uses it).
- `/actuator/health/readiness`: the database is reachable. Use it as the load balancer / orchestrator readiness probe. While the
  database is unreachable the probe does not answer 200 (it can hang until the connection timeout, so configure a probe timeout).

Redis is deliberately not part of health: rate limiting and WebSocket relay degrade gracefully without it, so a Redis outage should not
take instances out of rotation.

## Cloudflare R2 setup

1. Create a bucket and an R2 API token with Object Read & Write access.
2. Enable public access (the r2.dev subdomain or a custom domain) and set `R2_PUBLIC_BASE_URL` to it.
3. Add a CORS policy on the bucket so browsers can upload directly:

```json
[{ "AllowedOrigins": ["http://localhost:5173"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type", "content-length"], "MaxAgeSeconds": 3600 }]
```

### Image upload flow

1. `POST /api/media/upload-url` `{ "contentType": "image/png", "contentLength": 12345 }` returns `{ key, uploadUrl, headers, publicUrl, expiresAt }`.
2. `PUT` the file bytes to `uploadUrl` with the returned `headers` (Content-Type must match).
3. Use `key` in `mediaKeys` when creating a post, or as `avatarKey`/`bannerKey` in `PATCH /api/users/me`.

Allowed types are jpeg, png, webp and gif, up to 5 MB by default. The server only accepts keys under the caller's own `users/{id}/` prefix that actually exist in the bucket.

## API

All endpoints are under `/api`. Send `Authorization: Bearer <accessToken>` for authenticated calls. Errors use RFC 9457 problem JSON.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | – | `{username, email, password, displayName}` |
| POST | `/auth/login` | – | `{usernameOrEmail, password}` |
| POST | `/auth/refresh` | – | `{refreshToken}`; rotates the token, and reusing an old one revokes all sessions |
| POST | `/auth/logout` | – | `{refreshToken}` |
| POST | `/auth/verify-email` | – | `{token}` from the emailed link; 400 if invalid, expired or already used (204 on success) |
| POST | `/users/me/verify-email` | ✓ | resend the verification email; 409 if already verified |
| POST | `/auth/forgot-password` | – | `{email}`; always 204 so it can't be used to find accounts; emails a reset link (valid 1h) to active accounts |
| POST | `/auth/reset-password` | – | `{token, newPassword}`; sets the password and signs out every session; 400 if invalid, expired or already used |
| GET / PATCH | `/users/me` | ✓ | PATCH `{displayName?, bio?, avatarKey?, bannerKey?}`; `""` clears |
| GET | `/users/search?q=` | – | prefix match on username / display name |
| GET | `/users/me/blocks` | ✓ | users you blocked, paged |
| GET | `/users/{username}` | optional | profile + counts + `followedByMe` + `blockedByMe` |
| POST / DELETE | `/users/{username}/follow` | ✓ | idempotent |
| POST / DELETE | `/users/{username}/block` | ✓ | idempotent; removes follows both ways. Blocked pairs can't follow, like or reply to each other or see each other's posts (403), and are hidden from each other's reply and follower lists |
| GET | `/users/{username}/followers`, `/following` | – | paged |
| GET | `/users/{username}/posts`, `/replies`, `/likes` | optional | paged |
| POST | `/posts` | ✓ | `{content?, mediaKeys?, replyToId?, quotedPostId?, replyPolicy?}`. `replyPolicy` (`EVERYONE` default, `FOLLOWING` = accounts the author follows, `MENTIONED` = accounts @mentioned in the post) is set on top-level posts only (400 on replies and quotes). Replying against it is 403; the author can always reply |
| POST | `/posts/thread` | ✓ | `{posts: [{content?, mediaKeys?}, ...], replyPolicy?}`, 2–25 posts created atomically; each replies to the previous |
| PATCH | `/posts/{id}/reply-policy` | ✓ | `{replyPolicy}`; author-only, top-level posts only; applies to future replies |
| GET | `/posts/{id}/thread` | optional | the conversation's top-level post plus the author's own chained posts, oldest first (others' replies excluded) |
| GET / DELETE | `/posts/{id}` | optional / ✓ | delete is author-only (soft delete) |
| GET | `/posts/{id}/replies` | optional | paged, oldest first. Every post response includes `conversationId`, `replyPolicy` and `canReply` (for the viewer) |
| POST / DELETE | `/posts/{id}/like` | ✓ | idempotent |
| GET | `/posts/{id}/likes` | – | users who liked, paged |
| GET | `/notifications` | ✓ | follow / like / reply / mention notifications, newest first, paged; hides blocked or inactive actors |
| GET | `/notifications/unread-count` | ✓ | |
| POST | `/notifications/read`, `/notifications/{id}/read` | ✓ | mark all / one as read |
| DELETE | `/notifications/{id}` | ✓ | |
| GET | `/timeline` | ✓ | your posts + people you follow, newest first |
| POST | `/media/upload-url` | ✓ | see above |

**Pagination.** Paged endpoints accept `?cursor=&limit=` (default 20, max 50) and return `{ items, nextCursor }`. Pass `nextCursor` back to get the next page; `null` means there are no more pages.

## Email

Registering and changing your email send a verification link (`emailVerified` in the user response; accounts that
existed before this feature count as verified). Nothing is blocked for unverified users yet. Links point to
`FRONTEND_URL/verify-email?token=…` and `FRONTEND_URL/reset-password?token=…`. Set `SPRING_MAIL_HOST` (plus
`_PORT`, `_USERNAME`, `_PASSWORD`) to send real email; without it the app logs the email, link included, instead.
