// k6 load test for the XClone API.
//   SCENARIO=create|timeline|like|mixed   (default mixed)
//   BASE=http://localhost:8080  USERS=100  RATE=200 (requests/s for the arrival-rate scenarios)  DURATION=60s
// The server must run with RATE_LIMIT_ENABLED=false, otherwise registration and writes are throttled (429).
// Run: docker run --rm -i --network host -v "$PWD/loadtest:/t" grafana/k6 run -e SCENARIO=create /t/k6.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:8080';
const USERS = parseInt(__ENV.USERS || '100');
const RATE = parseInt(__ENV.RATE || '200');
const DURATION = __ENV.DURATION || '60s';
const SCENARIO = __ENV.SCENARIO || 'mixed';
const serverErrors = new Counter('server_errors');

function arrival(exec, rate) {
  return { executor: 'constant-arrival-rate', exec, rate, timeUnit: '1s', duration: DURATION,
           preAllocatedVUs: 50, maxVUs: 500 };
}
const all = {
  create: arrival('createPost', RATE),
  timeline: arrival('readTimeline', RATE),
  like: arrival('toggleLike', RATE),
};
export const options = {
  setupTimeout: '10m',
  scenarios: SCENARIO === 'mixed'
    ? { create: arrival('createPost', Math.round(RATE * 0.2)),
        timeline: arrival('readTimeline', Math.round(RATE * 0.7)),
        like: arrival('toggleLike', Math.round(RATE * 0.1)) }
    : { [SCENARIO]: all[SCENARIO] },
  // Per-scenario sub-metrics (the always-true limits just make k6 print them), so setup traffic is not mixed in.
  thresholds: Object.assign({},
    ...(SCENARIO === 'mixed' ? ['create', 'timeline', 'like'] : [SCENARIO]).map((n) => ({
      [`http_req_duration{scenario:${n}}`]: ['p(95)<500', 'p(99)<100000'],
      [`http_req_failed{scenario:${n}}`]: ['rate<0.01'],
      [`http_reqs{scenario:${n}}`]: ['count>=0'],
    }))),
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const json = { 'Content-Type': 'application/json' };
const auth = (t) => ({ headers: { ...json, Authorization: `Bearer ${t}` }, tags: {} });

export function setup() {
  const run = Math.random().toString(36).slice(2, 8);
  const users = [];
  for (let i = 0; i < USERS; i++) {
    const username = `lt${run}${i}`.slice(0, 15);
    const res = http.post(`${BASE}/api/auth/register`, JSON.stringify({
      username, email: `${username}@load.test`, password: 'password123', displayName: `Load ${i}`,
    }), { headers: json });
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(`register failed: ${res.status} ${res.body} (is RATE_LIMIT_ENABLED=false?)`);
    }
    users.push({ username, token: res.json('accessToken') });
  }
  // Each user follows up to 20 others so timelines have content, and everyone posts once.
  for (let i = 0; i < USERS; i++) {
    const reqs = [];
    for (let k = 1; k <= Math.min(20, USERS - 1); k++) {
      const target = users[(i + k) % USERS].username;
      reqs.push(['POST', `${BASE}/api/users/${target}/follow`, null, auth(users[i].token)]);
    }
    http.batch(reqs);
    http.post(`${BASE}/api/posts`, JSON.stringify({ content: `hello from ${users[i].username} #seed` }),
      auth(users[i].token));
  }
  const hot = http.post(`${BASE}/api/posts`, JSON.stringify({ content: 'the hot post everyone likes' }),
    auth(users[0].token)).json('id');
  return { users, hot };
}

const pick = (d) => d.users[Math.floor(Math.random() * d.users.length)];
const tags = ['#java', '#spring', '#loadtest', '#xclone', '#postgres'];

export function createPost(d) {
  const u = pick(d);
  let content = `load post ${Math.random().toString(36).slice(2, 10)}`;
  if (Math.random() < 0.3) content += ' ' + tags[Math.floor(Math.random() * tags.length)];
  if (Math.random() < 0.1) content += ' @' + pick(d).username;
  const r = http.post(`${BASE}/api/posts`, JSON.stringify({ content }), auth(u.token));
  if (r.status >= 500) serverErrors.add(1);
  check(r, { 'created': (x) => x.status === 201 });
}

export function readTimeline(d) {
  const r = http.get(`${BASE}/api/timeline?limit=20`, auth(pick(d).token));
  if (r.status >= 500) serverErrors.add(1);
  check(r, { 'timeline ok': (x) => x.status === 200 });
}

// Everyone likes/unlikes the SAME post: worst case for the likeCount row lock.
export function toggleLike(d) {
  const u = pick(d);
  const method = Math.random() < 0.5 ? 'POST' : 'DELETE';
  const r = http.request(method, `${BASE}/api/posts/${d.hot}/like`, null, auth(u.token));
  if (r.status >= 500) serverErrors.add(1);
  check(r, { 'like ok': (x) => x.status === 204 || x.status === 200 });
}
