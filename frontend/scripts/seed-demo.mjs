#!/usr/bin/env node
// Fills a running backend with demo users and posts so the app has something to show before the composer exists.
// Safe to run again: accounts are reused and posts are only created for accounts that have none.
//   API_BASE=http://localhost:8080 node scripts/seed-demo.mjs        (or: npm run seed)
const BASE = process.env.API_BASE ?? 'http://localhost:8080'
const PASSWORD = 'password123'

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  return { status: res.status, json }
}

async function must(method, path, options) {
  const result = await call(method, path, options)
  if (result.status >= 400) throw new Error(`${method} ${path} -> ${result.status} ${JSON.stringify(result.json)}`)
  return result.json
}

async function account(username, displayName) {
  const register = await call('POST', '/api/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD, displayName },
  })
  if (register.status === 201) return { username, token: register.json.accessToken, created: true }
  if (register.status !== 409) throw new Error(`register ${username}: ${register.status} ${JSON.stringify(register.json)}`)
  const login = await must('POST', '/api/auth/login', { body: { usernameOrEmail: username, password: PASSWORD } })
  return { username, token: login.accessToken, created: false }
}

const hasPosts = async (u) => (await must('GET', `/api/users/${u.username}/posts?limit=1`, { token: u.token })).items.length > 0
const post = (u, content, extra = {}) => must('POST', '/api/posts', { token: u.token, body: { content, ...extra } })

const ava = await account('demo_ava', 'Ava Stone')
const ben = await account('demo_ben', 'Ben Carter')
const cleo = await account('demo_cleo', 'Cleo Park')
const dan = await account('demo_dan', 'Dan Private')

await must('PATCH', '/api/users/me', { token: dan.token, body: { protectedAccount: true } })
for (const [who, target] of [[ava, ben], [ava, cleo], [ben, ava], [cleo, ava]]) {
  await must('POST', `/api/users/${target.username}/follow`, { token: who.token })
}
// Following a protected account is a request that its owner approves.
await call('POST', `/api/users/${dan.username}/follow`, { token: ava.token })
await call('POST', `/api/users/me/follow-requests/${ava.username}/approve`, { token: dan.token })

if (!(await hasPosts(ben))) {
  const first = await post(ben, 'Just shipped a new feature 🚀 #buildinpublic #java')
  await post(ben, 'Reading about Spring Boot internals today https://spring.io/projects/spring-boot\nSecond line of the same post, to check that line breaks survive.')
  await post(ben, 'Hey @demo_ava, what do you think about this? #xclone')
  await post(ben, 'A very long unbroken word to check wrapping: ' + 'supercalifragilistic'.repeat(4))
  ben.first = first
}
if (!(await hasPosts(cleo))) {
  const coffee = await post(cleo, 'Coffee first, then code ☕ #morningroutine')
  const benFirst = (await must('GET', `/api/users/${ben.username}/posts?limit=50`, { token: cleo.token })).items.at(-1)
  await post(cleo, 'This is exactly what I needed to see today', { quotedPostId: benFirst.id })
  cleo.coffee = coffee
}
if (!(await hasPosts(dan))) {
  await post(dan, 'Private thoughts, only for my approved followers 🔒')
}
if (!(await hasPosts(ava))) {
  const coffee = (await must('GET', `/api/users/${cleo.username}/posts?limit=50`, { token: ava.token })).items.at(-1)
  await call('POST', `/api/posts/${coffee.id}/repost`, { token: ava.token })
  await post(ava, 'Hello world from Ava! #hello')
}

console.log(`Seeded ${BASE}`)
console.log('Sign in with any of these (password: password123):')
console.log('  demo_ava   follows ben, cleo and dan (protected): the richest timeline')
console.log('  demo_ben, demo_cleo, demo_dan (protected)')
