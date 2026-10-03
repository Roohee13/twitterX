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
