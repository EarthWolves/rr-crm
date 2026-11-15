// Website contact form -> CRM. Needs TEST_DATABASE_URL (see api.test.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = url;
let server, base;

before(async () => {
  if (!url) return;
  const { pool, migrate } = await import('../db.js');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  const { initAuth } = await import('../auth.js');
  await initAuth();
  const { createApp } = await import('../index.js');
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}/api/public/contact`;
});
after(async () => {
  if (!url) return;
  server.close();
  const { pool } = await import('../db.js');
  await pool.end();
});

const post = (body, origin = 'https://rraval.com') =>
  fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });

test('website contact form creates a lead with a note', { skip: !url && 'TEST_DATABASE_URL not set' }, async () => {
  const { query } = await import('../db.js');

  const pre = await fetch(base, { method: 'OPTIONS', headers: { Origin: 'https://rraval.com' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://rraval.com');

  assert.equal((await post({ name: 'A', email: 'a@x.com', message: 'hi' }, 'https://evil.com')).status, 403);
  assert.equal((await post({ name: 'A', email: 'not-an-email', message: 'hi' })).status, 400);

  const r = await post({ name: 'Ada', email: 'Ada@x.com', message: 'Love Merlo', topic: 'Merlo' });
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { ok: true });

  // Same email again attaches to the same contact.
  assert.equal((await post({ name: 'Ada L', email: 'ada@x.com', message: 'Follow-up', topic: 'Investing' })).status, 201);
  const { rows } = await query(`SELECT c.name, c.tags, (SELECT count(*)::int FROM notes n WHERE n.contact_id = c.id) AS notes FROM contacts c`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Ada');
  assert.deepEqual(rows[0].tags.sort(), ['investing', 'merlo', 'website']);
  assert.equal(rows[0].notes, 2);

  // Honeypot is accepted but ignored.
  assert.equal((await post({ name: 'Bot', email: 'bot@x.com', message: 'spam', company: 'x' })).status, 202);
  assert.equal((await query(`SELECT count(*)::int AS n FROM contacts`)).rows[0].n, 1);
});
