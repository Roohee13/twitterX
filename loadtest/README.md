# Load tests

`k6.js` drives the API with a constant arrival rate (`SCENARIO=create|timeline|like|mixed`). It registers users in `setup()`,
so run the server with `RATE_LIMIT_ENABLED=false` and a scratch database.

```bash
docker run --rm -i --network host -v "$PWD/loadtest:/t" grafana/k6 run \
  -e BASE=http://localhost:8080 -e SCENARIO=create -e RATE=200 -e DURATION=30s -e USERS=50 /t/k6.js
```

To simulate Neon's network latency, put [Toxiproxy](https://github.com/Shopify/toxiproxy) between the app and Postgres and add
a `latency` toxic (the app's `DB_URL` then points at the proxy port).

## Baseline (2026-10-03, one 12-core laptop running app + Postgres + k6; pool = 20, no Redis load)

| DB round trip | create post | timeline | capacity per instance |
|---|---|---|---|
| ~0 ms (loopback) | p95 15 ms at 1,500/s | p95 10 ms at 800/s | CPU-bound on this machine |
| +5 ms | ~47 ms avg | ~43 ms avg | ~400 req/s (pool / latency), at the limit |
| +20 ms | ~140-165 ms avg | ~160 ms avg | ~140 req/s; at 200/s latency jumps to ~3 s and requests drop |

A plain post creation is ~7 sequential round trips (JWT filter user check, author lookup, insert, two lookups that only build the
response, commit). Per-instance throughput is therefore `pool size / (round trips x latency)`: the connection is held for the whole
request. Keep the app in the same region as Neon, cut round trips per request, and scale instances horizontally.
Contention on one hot post's `like_count` was not visible up to 600 likes/s locally; re-test against Neon.

## After cutting round trips (same setup)

Changes: the JWT filter's "is the account active" check is cached for 10 s (`ACTIVE_USER_CACHE_TTL`), and a newly created post's
response is built in memory instead of three lookups. A plain post is now ~3 round trips (author lookup, insert, commit).

| DB round trip | create post | create @ 200/s | timeline @ 200/s |
|---|---|---|---|
| +5 ms | ~29 ms avg (was ~47) | fine | ~40 ms avg |
| +20 ms | ~97 ms avg at 60/s (was ~165) | ~109 ms avg, 3 dropped (was ~2.8 s, ~1,000 dropped) | still saturated: ~1.9 s avg (was ~2.5 s) |

Create capacity per instance at +20 ms went from ~140/s to above 200/s. The timeline still issues ~7 statements per request and is
the next thing to cut (batch the per-page lookups, cache hot timelines in Redis).
