// Sales funnel: migration seeding on an existing install, auto-adding new leads, custom steps,
// dashboard and MCP behaviour. Same TEST_DATABASE_URL as the other tests (it gets wiped).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = url;
process.env.MCP_TOKEN = 'test-token-123';

let server;
let base;
let db;
let cookie = '';

async function api(method, path, body) {
  const res = await fetch(base + '/api' + path, {
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
  db = await import('../db.js');
  await db.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  const { initAuth } = await import('../auth.js');
  await initAuth();
  const { createApp } = await import('../index.js');
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  if (!url) return;
  server.close();
  await db.pool.end();
});

const stageOf = async (pipelineId, contactName) => {
  const { rows } = await db.pool.query(
    `SELECT s.name FROM pipeline_entries e JOIN stages s ON s.id = e.stage_id JOIN contacts c ON c.id = e.contact_id
     WHERE e.pipeline_id = $1 AND c.name = $2`,
    [pipelineId, contactName],
  );
  return rows[0]?.name ?? null;
};

test('sales funnel', { skip: !url && 'TEST_DATABASE_URL not set' }, async () => {
  // A fresh install has no funnel.
  await api('POST', '/auth/register', { name: 'Ro', email: 'ro@x.com', password: 'password1' });
  const { body: { pipeline: cold } } = await api('POST', '/pipelines', { name: 'Cold Calls', template: 'cold_call' });
  await api('POST', '/contacts/import', {
    pipelineId: cold.id,
    rows: [
      { name: 'Rutherford', stage: 'Meeting Booked' },
      { name: 'Talked Co', stage: 'Connected' },
      { name: 'Later Co', stage: 'Follow-up' },
      { name: 'Nope Co', stage: 'Not Interested' },
      { name: 'Tried Co', stage: 'Attempted' },
      { name: 'Fresh Co' },
    ],
  });
  assert.equal((await api('GET', '/pipelines')).body.pipelines.length, 1);

  // Simulate an install from before the funnel existed, then run the migration again.
  await db.pool.query(`
    DELETE FROM schema_migrations WHERE version = 3;
    DROP TRIGGER pipeline_entries_funnel_sync ON pipeline_entries;
    DROP FUNCTION funnel_sync();
    ALTER TABLE pipelines DROP COLUMN kind;`);
  const before = (await db.pool.query('SELECT contact_id, stage_id FROM pipeline_entries ORDER BY contact_id')).rows;
  await db.migrate();

  const { body: { pipelines } } = await api('GET', '/pipelines');
  assert.deepEqual(pipelines.map((p) => [p.name, p.kind]), [['Cold Calls', 'board'], ['Sales Funnel', 'funnel']]);
  const funnel = pipelines[1];
  assert.deepEqual(funnel.stages.map((s) => s.name), ['Cold calling', 'Identifying ICP', 'Call with them', 'Design partner / pilot', 'Customer', 'Not a fit']);
  assert.deepEqual(funnel.stages.map((s) => s.kind), ['open', 'open', 'open', 'open', 'won', 'lost']);
  assert.equal(funnel.entry_count, 6);
  assert.equal(await stageOf(funnel.id, 'Rutherford'), 'Call with them');
  assert.equal(await stageOf(funnel.id, 'Talked Co'), 'Identifying ICP');
  assert.equal(await stageOf(funnel.id, 'Later Co'), 'Identifying ICP');
  assert.equal(await stageOf(funnel.id, 'Nope Co'), 'Not a fit');
  assert.equal(await stageOf(funnel.id, 'Tried Co'), 'Cold calling');
  assert.equal(await stageOf(funnel.id, 'Fresh Co'), 'Cold calling');
  // The cold-call board is untouched.
  const coldAfter = (await db.pool.query('SELECT contact_id, stage_id FROM pipeline_entries WHERE pipeline_id = $1 ORDER BY contact_id', [cold.id])).rows;
  assert.deepEqual(coldAfter, before);

  // New leads on the cold-call list join the funnel at the first stage, by any route.
  await api('POST', '/contacts/import', { pipelineId: cold.id, rows: [{ name: 'Imported Co', stage: 'Connected' }] });
  assert.equal(await stageOf(funnel.id, 'Imported Co'), 'Identifying ICP'); // joined, then moved up by its Connected column
  const { body: { contact } } = await api('POST', '/contacts', { name: 'Manual Co' });
  await api('POST', `/pipelines/${cold.id}/entries`, { contactIds: [contact.id] });
  assert.equal(await stageOf(funnel.id, 'Manual Co'), 'Cold calling');
  // Adding straight to the funnel doesn't put the lead on other pipelines.
  const { body: { contact: direct } } = await api('POST', '/contacts', { name: 'Direct Co' });
  await api('POST', `/pipelines/${funnel.id}/entries`, { contactIds: [direct.id] });
  assert.equal(await stageOf(cold.id, 'Direct Co'), null);

  // Cards on the cold-call board carry their funnel step; funnel cards don't point at themselves.
  const coldBoard = (await api('GET', `/pipelines/${cold.id}/board`)).body.entries;
  assert.equal(coldBoard.length, 8);
  const rCard = coldBoard.find((e) => e.name === 'Rutherford');
  assert.equal(rCard.funnel.pipeline_id, funnel.id);
  assert.equal(rCard.funnel.stage_id, funnel.stages.find((s) => s.name === 'Call with them').id);
  assert.ok((await api('GET', `/pipelines/${funnel.id}/board`)).body.entries.every((e) => e.funnel === null));
  // Logging a call from a contact page still defaults to the cold-call board (it's listed first).
  const rContact = (await api('GET', '/contacts?q=Rutherford')).body.contacts[0];
  assert.equal(rContact.entries[0].pipeline_id, cold.id);

  // Custom step inserted after a given stage.
  const icp = funnel.stages[1];
  const added = await api('POST', `/pipelines/${funnel.id}/stages`, { name: 'Demo scheduled', after: icp.id });
  assert.equal(added.status, 201);
  const names = (await api('GET', '/pipelines')).body.pipelines[1].stages.map((s) => s.name);
  assert.deepEqual(names, ['Cold calling', 'Identifying ICP', 'Demo scheduled', 'Call with them', 'Design partner / pilot', 'Customer', 'Not a fit']);

  // Moving a card along the funnel is not counted as a call on the dashboard.
  const entry = (await api('GET', `/pipelines/${funnel.id}/board`)).body.entries.find((e) => e.name === 'Tried Co');
  const customer = funnel.stages.find((s) => s.name === 'Customer');
  assert.equal((await api('PATCH', `/entries/${entry.id}`, { stageId: customer.id })).status, 200);
  const dash = (await api('GET', '/dashboard?days=1')).body;
  assert.deepEqual([dash.totals.calls, dash.totals.meetings], [0, 0]);

  // Progress on the cold-call board moves the funnel forward (never back, never out of won/lost).
  const coldStages = (await api('GET', '/pipelines')).body.pipelines[0].stages;
  const coldStage = (n) => coldStages.find((s) => s.name === n).id;
  const coldEntry = async (n) => (await api('GET', `/pipelines/${cold.id}/board`)).body.entries.find((e) => e.name === n).id;
  const moveCold = async (n, stage) => assert.equal((await api('PATCH', `/entries/${await coldEntry(n)}`, { stageId: coldStage(stage) })).status, 200);
  await moveCold('Talked Co', 'Meeting Booked');
  assert.equal(await stageOf(funnel.id, 'Talked Co'), 'Call with them');
  await moveCold('Fresh Co', 'Connected');
  assert.equal(await stageOf(funnel.id, 'Fresh Co'), 'Identifying ICP');
  await moveCold('Rutherford', 'Connected');
  assert.equal(await stageOf(funnel.id, 'Rutherford'), 'Call with them');
  await moveCold('Tried Co', 'Meeting Booked');
  assert.equal(await stageOf(funnel.id, 'Tried Co'), 'Customer');
  await moveCold('Nope Co', 'Meeting Booked');
  assert.equal(await stageOf(funnel.id, 'Nope Co'), 'Not a fit');
  await moveCold('Fresh Co', 'Attempted');
  assert.equal(await stageOf(funnel.id, 'Fresh Co'), 'Identifying ICP');
  await api('POST', '/contacts/import', { pipelineId: cold.id, rows: [{ name: 'Booked Co', stage: 'Meeting Booked' }] });
  assert.equal(await stageOf(funnel.id, 'Booked Co'), 'Call with them');
  const fresh = (await api('GET', '/contacts?q=Fresh Co')).body.contacts[0];
  const auto = (await api('GET', `/contacts/${fresh.id}/timeline`)).body.activity.find((a) => a.data.auto);
  assert.deepEqual([auto.user_id, auto.data.pipeline, auto.data.from, auto.data.to], [null, 'Sales Funnel', 'Cold calling', 'Identifying ICP']);
  // Only the person's own board moves count on the dashboard, not the automatic funnel moves.
  const dash3 = (await api('GET', '/dashboard?days=1')).body;
  assert.equal(dash3.totals.calls, 5);

  // Creating another funnel from the UI seeds it the same way.
  const second = await api('POST', '/pipelines', { name: 'Funnel 2', template: 'funnel' });
  assert.equal(second.body.pipeline.kind, 'funnel');
  assert.equal(await stageOf(second.body.pipeline.id, 'Talked Co'), 'Call with them');

  // MCP: moves pick the pipeline that has the column; new leads go on the cold-call list (and so the funnel).
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp/test-token-123')));
  const run = async (name, args) => {
    const res = await client.callTool({ name, arguments: args });
    return res.isError ? { error: res.content[0].text } : { data: JSON.parse(res.content[0].text) };
  };
  await api('DELETE', `/pipelines/${second.body.pipeline.id}`);
  const rid = (await run('find_leads', { query: 'Rutherford' })).data.leads[0].id;
  const moved = (await run('move_lead', { lead_id: rid, column: 'Design partner' })).data.lead.columns;
  assert.deepEqual(moved.map((c) => [c.pipeline, c.stage]).sort(), [['Cold Calls', 'Connected'], ['Sales Funnel', 'Design partner / pilot']]);
  const back = (await run('move_lead', { lead_id: rid, column: 'Follow-up' })).data.lead.columns;
  assert.deepEqual(back.map((c) => [c.pipeline, c.stage]).sort(), [['Cold Calls', 'Follow-up'], ['Sales Funnel', 'Design partner / pilot']]);
  const lead = (await run('create_lead', { name: 'Researched Co', phone: '619-555-0101' })).data.lead;
  assert.deepEqual(lead.columns.map((c) => [c.pipeline, c.stage]).sort(), [['Cold Calls', 'Not Contacted'], ['Sales Funnel', 'Cold calling']]);
  const pls = (await run('list_pipelines', {})).data.pipelines;
  assert.deepEqual(pls.map((p) => p.kind), ['board', 'funnel']);
  await client.close();
});
