// HIDDEN_USERS: a hidden user sees a not-found page everywhere; nobody else is affected.
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/rrcrm_test npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = url;

let server;
let root;

async function call(jar, method, path, body) {
  const res = await fetch(root + path, {
    method,
    headers: { 'Content-Type': 'application/json', cookie: jar.cookie || '' },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie');
  if (set) jar.cookie = set.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, body: json, text };
}

before(async () => {
  if (!url) return;
  const { pool, migrate } = await import('../db.js');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  const { initAuth } = await import('../auth.js');
  await initAuth();
  const { createApp } = await import('../index.js');
  server = createApp().listen(0);
  root = `http://localhost:${server.address().port}`;
});

after(async () => {
  if (!url) return;
  server.close();
  delete process.env.HIDDEN_USERS;
  const { pool } = await import('../db.js');
  await pool.end();
});

test('hidden users get a not-found page, others are untouched', { skip: !url && 'TEST_DATABASE_URL not set' }, async () => {
  const owner = {};
  const guest = {};
  const other = {};
  await call(owner, 'POST', '/api/auth/register', { name: 'Ro', email: 'ro@x.com', password: 'password1' });
  const { body: { code } } = await call(owner, 'GET', '/api/workspace/invite');
  await call(guest, 'POST', '/api/auth/register', { name: 'Guest Person', email: 'g@x.com', password: 'password1', inviteCode: code });
  await call(other, 'POST', '/api/auth/register', { name: 'Other', email: 'o@x.com', password: 'password1', inviteCode: code });
  assert.equal((await call(guest, 'GET', '/api/auth/me')).status, 200);

  process.env.HIDDEN_USERS = 'guest person, ro@x.com';
  const me = await call(guest, 'GET', '/api/auth/me');
  assert.equal(me.status, 404);
  assert.deepEqual(me.body, { error: 'Not found' });
  assert.equal((await call(guest, 'GET', '/api/contacts')).status, 404);
  const page = await call(guest, 'GET', '/contacts');
  assert.equal(page.status, 404);
  assert.match(page.text, /<pre>Cannot GET \/contacts<\/pre>/);

  // Signing in again: still not found.
  const fresh = {};
  const login = await call(fresh, 'POST', '/api/auth/login', { email: 'g@x.com', password: 'password1' });
  assert.equal(login.status, 404);
  assert.equal((await call(fresh, 'GET', '/api/auth/me')).status, 404);

  // The owner can't be hidden, other members are unaffected, and the account still exists.
  assert.equal((await call(owner, 'GET', '/api/auth/me')).status, 200);
  assert.equal((await call(other, 'GET', '/api/contacts')).status, 200);
  const users = await call(owner, 'GET', '/api/users');
  assert.ok(users.body.users.some((u) => u.email === 'g@x.com'));
  assert.equal((await call({}, 'GET', '/api/health')).status, 200);

  // Undo: clear the variable and the same session works again.
  delete process.env.HIDDEN_USERS;
  assert.equal((await call(guest, 'GET', '/api/auth/me')).status, 200);
});
