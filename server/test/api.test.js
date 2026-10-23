// Integration tests against a real Postgres. Point TEST_DATABASE_URL at a throwaway database:
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/rrcrm_test npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = url;

let server;
let base;
let cookie = '';

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => null) };
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
  base = `http://localhost:${server.address().port}/api`;
});

after(async () => {
  if (!url) return;
  server.close();
  const { pool } = await import('../db.js');
  await pool.end();
});

test('cold-calling workflow', { skip: !url && 'TEST_DATABASE_URL not set' }, async () => {
  assert.equal((await call('GET', '/contacts')).status, 401);
  const reg = await call('POST', '/auth/register', { name: 'Ro', email: 'ro@x.com', password: 'password1' });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.role, 'admin');

  const { body: { pipeline } } = await call('POST', '/pipelines', { name: 'Cold', template: 'cold_call' });
  const imp = await call('POST', '/contacts/import', {
    pipelineId: pipeline.id,
    rows: [
      { name: 'Acme', phone: '(508) 634-1800', stage: 'Attempted', note: 'VM', call_count: 2 },
      { name: 'Acme dup', phone: '508.634.1800' },
      { name: 'Beta', website: 'https://beta.com', stage: 'Brand New Stage' },
    ],
  });
  assert.deepEqual([imp.body.created, imp.body.skipped, imp.body.notes, imp.body.stagesCreated], [2, 1, 1, 1]);

  const list = await call('GET', '/contacts?sort=name&dir=asc');
  assert.equal(list.body.total, 2);
  const acme = list.body.contacts[0];
  assert.equal(acme.call_count, 2);

  const { body: { pipelines } } = await call('GET', '/pipelines');
  const meeting = pipelines[0].stages.find((s) => s.name === 'Meeting Booked');
  const logged = await call('POST', `/contacts/${acme.id}/calls`, {
    outcome: 'meeting_booked', notes: 'Booked for Tue', entryId: acme.entries[0].id, stageId: meeting.id,
    followUpAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(logged.status, 201);
  const after = (await call('GET', `/contacts/${acme.id}`)).body.contact;
  assert.equal(after.call_count, 3);
  assert.equal(after.last_outcome, 'meeting_booked');
  assert.equal(after.entries[0].stage_id, meeting.id);
  assert.equal((await call('GET', '/tasks')).body.tasks.length, 1);

  const dash = await call('GET', '/dashboard?days=1');
  assert.equal(dash.body.totals.meetings, 1);
  assert.equal(dash.body.totals.calls, 1);

  // Dragging a card on the board counts on the leaderboard too: once per lead per day, scored by
  // the column it ends up in.
  const beta = list.body.contacts[1];
  const voicemail = pipelines[0].stages.find((s) => s.name === 'Voicemail Left');
  assert.equal((await call('PATCH', `/entries/${beta.entries[0].id}`, { stageId: voicemail.id })).status, 200);
  assert.equal((await call('PATCH', `/entries/${beta.entries[0].id}`, { stageId: meeting.id })).status, 200);
  const dash2 = (await call('GET', '/dashboard?days=1')).body;
  assert.deepEqual([dash2.totals.calls, dash2.totals.connects, dash2.totals.meetings, dash2.totals.contacts_called], [2, 2, 2, 2]);
  assert.deepEqual([dash2.byUser[0].calls, dash2.byUser[0].connects, dash2.byUser[0].meetings], [2, 2, 2]);
  assert.equal(dash2.daily.at(-1).calls, 2);

  // Joining requires the invite code.
  cookie = '';
  assert.equal((await call('POST', '/auth/register', { name: 'Jo', email: 'jo@x.com', password: 'password1' })).status, 403);
});
