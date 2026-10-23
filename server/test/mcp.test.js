// MCP integration test against a real Postgres (same TEST_DATABASE_URL as api.test.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = url;
process.env.MCP_TOKEN = 'test-token-123';

let server;
let base;
let pool;

async function connect(path, headers = {}) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + path), { requestInit: { headers } }));
  return client;
}

async function run(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  return { error: res.isError ? res.content[0].text : null, data: res.isError ? null : JSON.parse(res.content[0].text) };
}

before(async () => {
  if (!url) return;
  const db = await import('../db.js');
  pool = db.pool;
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
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
  await pool.end();
});

test('mcp call loop', { skip: !url && 'TEST_DATABASE_URL not set' }, async () => {
  // Auth: no token and a wrong token are refused.
  assert.equal((await fetch(base + '/mcp', { method: 'POST' })).status, 401);
  assert.equal((await fetch(base + '/mcp/wrong', { method: 'POST' })).status, 401);

  // Seed a user, a pipeline and a lead through the app's own API.
  const reg = await fetch(base + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Ro', email: 'ro@x.com', password: 'password1' }),
  });
  const cookie = reg.headers.get('set-cookie').split(';')[0];
  const api = (method, path, body) => fetch(base + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body),
  }).then((r) => r.json());
  const { pipeline } = await api('POST', '/pipelines', { name: 'Cold Calls', template: 'cold_call' });
  await api('POST', '/contacts/import', {
    pipelineId: pipeline.id,
    rows: [{ name: 'West Coast Drywall', phone: '(619) 555-0142', website: 'wcdrywall.com' }, { name: 'Acme Roofing', phone: '405-555-0199' }],
  });

  const client = await connect('/mcp/test-token-123');
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'add_action_item', 'add_note', 'complete_task', 'find_leads', 'get_lead', 'list_pipelines', 'list_tasks', 'log_call', 'move_lead', 'update_lead',
  ]);
  const header = await connect('/mcp', { Authorization: 'Bearer test-token-123' });
  assert.equal((await run(header, 'list_pipelines')).data.pipelines[0].name, 'Cold Calls');

  // Look up by phone in a different format.
  const found = await run(client, 'find_leads', { query: '619.555.0142' });
  assert.equal(found.data.count, 1);
  const lead = found.data.leads[0];
  assert.equal(lead.name, 'West Coast Drywall');
  assert.equal(lead.columns[0].stage, 'Not Contacted');

  // Log a call and move the lead in one step.
  const logged = await run(client, 'log_call', {
    lead_id: lead.id, outcome: 'connected', notes: 'Spoke with Robert, the owner. Buys from two suppliers.',
    move_to_column: 'follow', follow_up_at: '2026-10-27T15:00:00-05:00',
  });
  assert.equal(logged.error, null);
  assert.equal(logged.data.lead.call_count, 1);
  assert.equal(logged.data.lead.last_outcome, 'connected');
  assert.equal(logged.data.lead.columns[0].stage, 'Follow-up');

  // Ambiguous and unknown columns get a helpful error and change nothing.
  assert.match((await run(client, 'move_lead', { lead_id: lead.id, column: 'ed' })).error, /more than one/);
  assert.match((await run(client, 'move_lead', { lead_id: lead.id, column: 'Nope' })).error, /Options:/);

  assert.equal((await run(client, 'move_lead', { lead_id: lead.id, column: 'meeting booked' })).data.lead.columns[0].stage, 'Meeting Booked');
  await run(client, 'add_note', { lead_id: lead.id, body: 'Prefers email over phone.' });
  const item = await run(client, 'add_action_item', { lead_id: lead.id, title: 'Email pricing sheet to Robert', due_at: '2026-10-24T09:00:00-05:00' });
  await run(client, 'update_lead', { lead_id: lead.id, contact_person: 'Robert', email: 'robert@wcdrywall.com' });

  const full = (await run(client, 'get_lead', { lead_id: lead.id })).data;
  assert.equal(full.contact_person, 'Robert');
  assert.equal(full.email, 'robert@wcdrywall.com');
  assert.equal(full.recent_calls.length, 1);
  assert.equal(full.notes.length, 1);
  assert.equal(full.open_tasks.length, 2); // follow-up from log_call + the action item
  assert.equal(new Date(full.next_follow_up_at).toISOString(), '2026-10-24T14:00:00.000Z');

  // The app's own REST views see the same history the UI shows.
  const timeline = await api('GET', `/contacts/${lead.id}/timeline`);
  const types = timeline.activity.map((a) => a.type);
  for (const t of ['call.logged', 'stage.changed', 'contact.updated']) assert.ok(types.includes(t), t);

  await run(client, 'complete_task', { task_id: item.data.task.id });
  assert.equal((await run(client, 'list_tasks', { lead_id: lead.id })).data.count, 1);

  // A lead not yet on any pipeline is added when moved (only one pipeline exists).
  const { contact } = await api('POST', '/contacts', { name: 'Loose Lead' });
  const moved = await run(client, 'move_lead', { lead_id: contact.id, column: 'Voicemail Left' });
  assert.equal(moved.data.lead.columns[0].stage, 'Voicemail Left');

  assert.match((await run(client, 'get_lead', { lead_id: '00000000-0000-0000-0000-000000000000' })).error, /not found/);
  await client.close();
  await header.close();
});
