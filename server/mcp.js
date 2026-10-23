// MCP server so an AI assistant can work the cold-call loop: look up a lead, log the call with
// detailed notes, move the lead to the right column, and record action items as tasks.
// Stateless Streamable HTTP at /mcp. Enabled only when MCP_TOKEN is set; the token is accepted
// as "Authorization: Bearer <token>" or as the last path segment (/mcp/<token>) for clients that
// can't send headers. Writes are made as the user named by MCP_USER_EMAIL (default: first admin).
import crypto from 'node:crypto';
import { Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { query, tx } from './db.js';
import { HttpError, broadcast, notFound } from './util.js';
import { OUTCOMES, addNote, logCall } from './routes/activity.js';
import { addEntries, moveEntry } from './routes/pipelines.js';
import { contactSchema, updateContact } from './routes/contacts.js';

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

function tokenOk(req) {
  const expected = process.env.MCP_TOKEN;
  if (!expected) return false;
  const header = req.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : req.params.token;
  return Boolean(given) && crypto.timingSafeEqual(digest(given), digest(expected));
}

async function actingUser() {
  const email = process.env.MCP_USER_EMAIL?.trim().toLowerCase();
  const { rows } = email
    ? await query('SELECT id, name, email FROM users WHERE email = $1', [email])
    : await query(`SELECT id, name, email FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`);
  return rows[0] || null;
}

const iso = z.string().datetime({ offset: true });
const leadId = z.string().uuid().describe('Lead (contact) id from find_leads');
const stageHint = 'Column name on the pipeline board, e.g. "Voicemail Left" or "Meeting Booked" (case-insensitive; a unique partial match works)';
const pipelineHint = 'Pipeline name or id. Optional when the lead is on exactly one pipeline, or only one pipeline exists';

const LEAD_COLUMNS = `c.id, c.name, c.phone, c.email, c.website, c.contact_person, c.contact_title, c.city, c.state,
  c.company_type, c.trades, c.tags, c.call_count, c.last_called_at, c.last_outcome, c.next_follow_up_at,
  (SELECT u.name FROM users u WHERE u.id = c.owner_id) AS owner,
  COALESCE((SELECT json_agg(json_build_object('entry_id', e.id, 'pipeline', p.name, 'pipeline_id', p.id, 'stage', s.name))
    FROM pipeline_entries e JOIN pipelines p ON p.id = e.pipeline_id JOIN stages s ON s.id = e.stage_id
    WHERE e.contact_id = c.id), '[]') AS columns`;

// Match a name (or id) against a list: exact id, exact name, then a unique partial match.
function pick(list, wanted, what) {
  const w = String(wanted).trim().toLowerCase();
  const found = list.find((x) => x.id === wanted) || list.find((x) => x.name.toLowerCase() === w);
  if (found) return found;
  const partial = list.filter((x) => x.name.toLowerCase().includes(w));
  if (partial.length === 1) return partial[0];
  const names = list.map((x) => x.name).join(', ');
  throw new HttpError(400, partial.length ? `"${wanted}" matches more than one ${what}: ${partial.map((x) => x.name).join(', ')}` : `No ${what} called "${wanted}". Options: ${names}`);
}

async function resolvePipeline(db, contactId, pipeline) {
  const { rows: pipelines } = await db.query('SELECT id, name FROM pipelines ORDER BY position, created_at');
  if (!pipelines.length) throw new HttpError(400, 'There are no pipelines yet');
  if (pipeline) return pick(pipelines, pipeline, 'pipeline');
  const { rows: on } = await db.query(
    'SELECT p.id, p.name FROM pipeline_entries e JOIN pipelines p ON p.id = e.pipeline_id WHERE e.contact_id = $1',
    [contactId],
  );
  if (on.length === 1) return on[0];
  if (!on.length && pipelines.length === 1) return pipelines[0];
  const among = on.length ? on : pipelines;
  throw new HttpError(400, `Say which pipeline: ${among.map((p) => p.name).join(', ')}`);
}

// Find (or create, at the first column) the lead's entry on a pipeline and resolve the target column.
async function resolveMove(db, contactId, stage, pipeline, userId) {
  const p = await resolvePipeline(db, contactId, pipeline);
  const { rows: stages } = await db.query('SELECT id, name FROM stages WHERE pipeline_id = $1 ORDER BY position', [p.id]);
  const target = pick(stages, stage, `column on ${p.name}`);
  let { rows: entry } = await db.query('SELECT id FROM pipeline_entries WHERE pipeline_id = $1 AND contact_id = $2', [p.id, contactId]);
  if (!entry[0]) {
    await addEntries(db, p.id, [contactId], null, userId);
    ({ rows: entry } = await db.query('SELECT id FROM pipeline_entries WHERE pipeline_id = $1 AND contact_id = $2', [p.id, contactId]));
  }
  return { entryId: entry[0].id, stageId: target.id };
}

async function assertLead(db, id) {
  const { rows } = await db.query('SELECT id, name FROM contacts WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Lead');
  return rows[0];
}

async function leadSummary(db, id) {
  const { rows } = await db.query(`SELECT ${LEAD_COLUMNS} FROM contacts c WHERE c.id = $1`, [id]);
  return rows[0];
}

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });

export function buildServer(user) {
  const server = new McpServer({ name: 'rr-crm', version: '1.0.0' });
  const changed = () => broadcast({ path: '/mcp', method: 'POST', by: 'mcp' });

  const tool = (name, description, inputSchema, run, { write = false } = {}) => {
    server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: !write, destructiveHint: false } }, async (args) => {
      try {
        const result = write ? await tx((db) => run(db, args)) : await run({ query }, args);
        if (write) changed();
        return ok(result);
      } catch (err) {
        const message = err instanceof HttpError ? err.message : err.code === '22P02' ? 'Invalid id' : 'Something went wrong';
        if (!(err instanceof HttpError)) console.error('MCP tool error', name, err);
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    });
  };

  tool(
    'find_leads',
    'Search leads by company name, phone number (any format), website, email, contact person or city. Returns each lead with its phone, website, call history summary and current pipeline column.',
    { query: z.string().trim().min(1).describe('Name, phone, website, email, person or city'), limit: z.number().int().min(1).max(50).optional() },
    async (db, { query: q, limit }) => {
      const digits = q.replace(/\D/g, '');
      const params = [`%${q}%`, q];
      let phone = '';
      if (digits.length >= 4) {
        params.push(`%${digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits}%`);
        phone = ` OR regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') LIKE $3`;
      }
      const { rows } = await db.query(
        `SELECT ${LEAD_COLUMNS} FROM contacts c
         WHERE c.name ILIKE $1 OR c.website ILIKE $1 OR c.email ILIKE $1 OR c.contact_person ILIKE $1 OR c.city ILIKE $1 OR c.phone ILIKE $1${phone}
         ORDER BY (lower(c.name) = lower($2)) DESC, lower(c.name) LIMIT ${limit || 10}`,
        params,
      );
      return { count: rows.length, leads: rows };
    },
  );

  tool(
    'get_lead',
    'Everything about one lead: contact details, current columns, recent calls, notes and open tasks.',
    { lead_id: leadId },
    async (db, { lead_id }) => {
      await assertLead(db, lead_id);
      const [lead, calls, notes, tasks, extra] = await Promise.all([
        leadSummary(db, lead_id),
        db.query(`SELECT cl.id, cl.called_at, cl.outcome, cl.duration_sec, cl.notes, u.name AS by FROM calls cl LEFT JOIN users u ON u.id = cl.user_id
                  WHERE cl.contact_id = $1 ORDER BY cl.called_at DESC LIMIT 10`, [lead_id]),
        db.query(`SELECT n.id, n.created_at, n.body, n.pinned, u.name AS by FROM notes n LEFT JOIN users u ON u.id = n.user_id
                  WHERE n.contact_id = $1 ORDER BY n.pinned DESC, n.created_at DESC LIMIT 20`, [lead_id]),
        db.query(`SELECT id, title, due_at, done FROM tasks WHERE contact_id = $1 AND NOT done ORDER BY due_at NULLS LAST`, [lead_id]),
        db.query('SELECT description, employees, est_revenue, custom FROM contacts WHERE id = $1', [lead_id]),
      ]);
      return { ...lead, ...extra.rows[0], recent_calls: calls.rows, notes: notes.rows, open_tasks: tasks.rows };
    },
  );

  tool(
    'list_pipelines',
    'List pipelines and their columns (stages) in board order, with how many leads sit in each.',
    {},
    async (db) => {
      const { rows } = await db.query(`
        SELECT p.id, p.name, COALESCE((SELECT json_agg(json_build_object('name', s.name, 'kind', s.kind,
          'leads', (SELECT count(*)::int FROM pipeline_entries e WHERE e.stage_id = s.id)) ORDER BY s.position)
          FROM stages s WHERE s.pipeline_id = p.id), '[]') AS columns
        FROM pipelines p ORDER BY p.position, p.created_at`);
      return { pipelines: rows };
    },
  );

  tool(
    'log_call',
    `Log a cold call on a lead, exactly like the call logger in the app: records the outcome and notes, bumps the call count and last outcome, optionally moves the lead to a column and sets a follow-up (which also creates a "Follow up with ..." task). Write notes as detailed as possible: who you spoke with, what was said, objections, current suppliers or tools, budget, timing, next steps. Outcomes: ${OUTCOMES.join(', ')}.`,
    {
      lead_id: leadId,
      outcome: z.enum(OUTCOMES),
      notes: z.string().trim().max(20000).describe('Detailed call notes'),
      move_to_column: z.string().trim().min(1).optional().describe(stageHint),
      pipeline: z.string().trim().min(1).optional().describe(pipelineHint),
      follow_up_at: iso.optional().describe('ISO 8601 date-time with timezone offset for the next follow-up'),
      duration_sec: z.number().int().min(0).max(86400).optional(),
      called_at: iso.optional().describe('When the call happened; defaults to now'),
    },
    async (db, a) => {
      const lead = await assertLead(db, a.lead_id);
      const move = a.move_to_column ? await resolveMove(db, lead.id, a.move_to_column, a.pipeline, user.id) : {};
      const call = await logCall(db, lead.id, {
        outcome: a.outcome, notes: a.notes, durationSec: a.duration_sec, calledAt: a.called_at,
        entryId: move.entryId, stageId: move.stageId, followUpAt: a.follow_up_at,
      }, user.id);
      return { logged_call_id: call.id, lead: await leadSummary(db, lead.id) };
    },
    { write: true },
  );

  tool(
    'add_note',
    'Add a note to a lead (shows on the lead page and the board card). Use for details that are not a call, or extra context after a call.',
    { lead_id: leadId, body: z.string().trim().min(1).max(50000), pinned: z.boolean().optional().describe('Pin to the top of the lead\'s notes') },
    async (db, { lead_id, body, pinned }) => {
      await assertLead(db, lead_id);
      const note = await addNote(db, lead_id, { body, pinned }, user.id);
      return { note_id: note.id, created_at: note.created_at };
    },
    { write: true },
  );

  tool(
    'move_lead',
    'Move a lead to a column on a pipeline board. Adds the lead to the pipeline first if it is not on it.',
    { lead_id: leadId, column: z.string().trim().min(1).describe(stageHint), pipeline: z.string().trim().min(1).optional().describe(pipelineHint) },
    async (db, { lead_id, column, pipeline }) => {
      await assertLead(db, lead_id);
      const { entryId, stageId } = await resolveMove(db, lead_id, column, pipeline, user.id);
      await moveEntry(db, entryId, stageId, user.id);
      return { lead: await leadSummary(db, lead_id) };
    },
    { write: true },
  );

  tool(
    'add_action_item',
    'Record an action item from a call (send an email, book a meeting, send a quote, call back) as a task on the lead, assigned to the CRM user. With a due date it also sets the lead\'s next follow-up unless set_follow_up is false.',
    {
      lead_id: leadId,
      title: z.string().trim().min(1).max(500).describe('e.g. "Email pricing sheet to Mike (mike@acme.com)"'),
      due_at: iso.optional().describe('ISO 8601 date-time with timezone offset'),
      set_follow_up: z.boolean().optional(),
    },
    async (db, { lead_id, title, due_at, set_follow_up }) => {
      await assertLead(db, lead_id);
      const { rows } = await db.query(
        'INSERT INTO tasks (contact_id, title, due_at, assignee_id, created_by) VALUES ($1, $2, $3, $4, $4) RETURNING id, title, due_at',
        [lead_id, title, due_at ?? null, user.id],
      );
      if (due_at && set_follow_up !== false) {
        await db.query('UPDATE contacts SET next_follow_up_at = $2, updated_at = now() WHERE id = $1', [lead_id, due_at]);
      }
      return { task: rows[0] };
    },
    { write: true },
  );

  tool(
    'list_tasks',
    'List tasks (action items), open by default, optionally for one lead.',
    { lead_id: leadId.optional(), status: z.enum(['open', 'done', 'all']).optional() },
    async (db, { lead_id, status = 'open' }) => {
      const params = [];
      const where = [];
      if (lead_id) where.push(`t.contact_id = $${params.push(lead_id)}`);
      if (status !== 'all') where.push(status === 'open' ? 'NOT t.done' : 't.done');
      const { rows } = await db.query(
        `SELECT t.id, t.title, t.due_at, t.done, t.done_at, c.id AS lead_id, c.name AS lead, c.phone, c.email, u.name AS assignee
         FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.assignee_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.done, t.due_at NULLS LAST, t.created_at DESC LIMIT 200`,
        params,
      );
      return { count: rows.length, tasks: rows };
    },
  );

  tool(
    'complete_task',
    'Mark a task done (or reopen it with done: false).',
    { task_id: z.string().uuid(), done: z.boolean().optional() },
    async (db, { task_id, done = true }) => {
      const { rows } = await db.query(
        `UPDATE tasks SET done = $2, done_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1 RETURNING id, title, done, done_at`,
        [task_id, done],
      );
      if (!rows[0]) throw notFound('Task');
      return { task: rows[0] };
    },
    { write: true },
  );

  // Plain schemas for the tool's input (JSON Schema can't express the app's transforms);
  // values are then validated by the app's own contact schema.
  const text = z.string().trim().max(10000).nullable().optional();
  const editable = {
    phone: text, email: text, website: text, contact_person: text, contact_title: text,
    city: text, state: text, description: text,
    tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  };
  tool(
    'update_lead',
    'Update a lead\'s details learned on a call, such as the decision maker\'s name, title or email. Only the fields given change; the change is recorded on the lead\'s timeline. Tags replace the existing tag list.',
    { lead_id: leadId, ...editable },
    async (db, { lead_id, ...fields }) => {
      await assertLead(db, lead_id);
      if (!Object.keys(fields).length) throw new HttpError(400, 'Nothing to update');
      await updateContact(db, lead_id, contactSchema.partial().parse(fields), user.id);
      return { lead: await leadSummary(db, lead_id) };
    },
    { write: true },
  );

  return server;
}

export const mcpRouter = Router();

async function handle(req, res) {
  if (!process.env.MCP_TOKEN) return res.status(404).json({ error: 'MCP is not enabled' });
  if (!tokenOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').json({ error: 'Method not allowed' });
  const user = await actingUser();
  if (!user) return res.status(503).json({ error: 'No CRM user to act as. Set MCP_USER_EMAIL to an existing user.' });
  const server = buildServer(user);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

mcpRouter.all('/', handle);
mcpRouter.all('/:token', handle);
