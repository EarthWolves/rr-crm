import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { getInviteCode, regenerateInviteCode, requireAdmin } from '../auth.js';
import { HttpError, logActivity, notFound, parse } from '../util.js';
import { moveEntry } from './pipelines.js';

export const router = Router();

export const OUTCOMES = [
  'no_answer', 'voicemail', 'gatekeeper', 'connected', 'callback', 'meeting_booked', 'not_interested', 'wrong_number',
];
const CONNECTED = ['connected', 'callback', 'meeting_booked', 'not_interested'];

const dt = z.string().datetime({ offset: true });

// ---------- Calls ----------

const callSchema = z.object({
  outcome: z.enum(OUTCOMES),
  notes: z.string().trim().max(20000).optional(),
  durationSec: z.number().int().min(0).max(86400).nullable().optional(),
  calledAt: dt.optional(),
  entryId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  followUpAt: dt.nullable().optional(),
});

// Log a call: insert it, roll up the contact's call stats, optionally move a pipeline entry and
// create a follow-up task. Shared by the REST route and the MCP server.
export async function logCall(db, contactId, body, userId) {
  const { rows: cr } = await db.query('SELECT * FROM contacts WHERE id = $1 FOR UPDATE', [contactId]);
  const contact = cr[0];
  if (!contact) throw notFound('Contact');
  let move = null;
  if (body.entryId && body.stageId) {
    const { rows: en } = await db.query('SELECT contact_id FROM pipeline_entries WHERE id = $1', [body.entryId]);
    if (en[0]?.contact_id !== contact.id) throw new HttpError(400, 'Entry does not belong to this contact');
    move = await moveEntry(db, body.entryId, body.stageId, userId);
  }
  const calledAt = body.calledAt || new Date().toISOString();
  const { rows } = await db.query(
    `INSERT INTO calls (contact_id, user_id, outcome, duration_sec, notes, pipeline_id, from_stage_id, to_stage_id, called_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [contact.id, userId, body.outcome, body.durationSec ?? null, body.notes || null,
      move?.entry.pipeline_id ?? null, move?.from ?? null, move?.entry.stage_id ?? null, calledAt],
  );
  await db.query(
    `UPDATE contacts SET call_count = call_count + 1,
       last_called_at = GREATEST(coalesce(last_called_at, $2::timestamptz), $2::timestamptz),
       last_outcome = CASE WHEN last_called_at IS NULL OR $2::timestamptz >= last_called_at THEN $3 ELSE last_outcome END,
       next_follow_up_at = CASE WHEN $4::boolean THEN $5::timestamptz ELSE next_follow_up_at END,
       updated_at = now()
     WHERE id = $1`,
    [contact.id, calledAt, body.outcome, body.followUpAt !== undefined, body.followUpAt ?? null],
  );
  if (body.followUpAt) {
    await db.query(
      `INSERT INTO tasks (contact_id, title, due_at, assignee_id, created_by) VALUES ($1, $2, $3, $4, $4)`,
      [contact.id, `Follow up with ${contact.name}`, body.followUpAt, userId],
    );
  }
  await logActivity(db, { contactId: contact.id, userId, type: 'call.logged', data: { outcome: body.outcome, callId: rows[0].id } });
  return rows[0];
}

router.post('/contacts/:id/calls', async (req, res) => {
  const body = parse(callSchema, req.body);
  const call = await tx((db) => logCall(db, req.params.id, body, req.user.id));
  res.status(201).json({ call });
});

const CALL_SELECT = `SELECT cl.*, u.name AS user_name, u.color AS user_color, c.name AS contact_name, c.phone AS contact_phone,
  fs.name AS from_stage_name, ts.name AS to_stage_name, ts.color AS to_stage_color
  FROM calls cl
  JOIN contacts c ON c.id = cl.contact_id
  LEFT JOIN users u ON u.id = cl.user_id
  LEFT JOIN stages fs ON fs.id = cl.from_stage_id
  LEFT JOIN stages ts ON ts.id = cl.to_stage_id`;

router.get('/contacts/:id/calls', async (req, res) => {
  const { rows } = await query(`${CALL_SELECT} WHERE cl.contact_id = $1 ORDER BY cl.called_at DESC`, [req.params.id]);
  res.json({ calls: rows });
});

router.get('/calls', async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.userId) {
    params.push(req.query.userId === 'me' ? req.user.id : req.query.userId);
    where.push(`cl.user_id = $${params.length}`);
  }
  if (req.query.outcome) {
    params.push(req.query.outcome);
    where.push(`cl.outcome = $${params.length}`);
  }
  if (req.query.from) {
    params.push(req.query.from);
    where.push(`cl.called_at >= $${params.length}`);
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const { rows } = await query(
    `${CALL_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY cl.called_at DESC LIMIT ${limit}`,
    params,
  );
  res.json({ calls: rows });
});

router.patch('/calls/:id', async (req, res) => {
  const body = parse(z.object({ outcome: z.enum(OUTCOMES).optional(), notes: z.string().max(20000).nullable().optional(), durationSec: z.number().int().min(0).nullable().optional() }), req.body);
  const { rows } = await query(
    `UPDATE calls SET outcome = coalesce($1, outcome), notes = CASE WHEN $2 THEN $3 ELSE notes END,
       duration_sec = CASE WHEN $4 THEN $5 ELSE duration_sec END
     WHERE id = $6 RETURNING *`,
    [body.outcome ?? null, body.notes !== undefined, body.notes ?? null, body.durationSec !== undefined, body.durationSec ?? null, req.params.id],
  );
  if (!rows[0]) throw notFound('Call');
  res.json({ call: rows[0] });
});

router.delete('/calls/:id', async (req, res) => {
  await tx(async (db) => {
    const { rows } = await db.query('DELETE FROM calls WHERE id = $1 RETURNING contact_id', [req.params.id]);
    if (!rows[0]) throw notFound('Call');
    await db.query(
      `UPDATE contacts SET call_count = GREATEST(call_count - 1, 0),
         last_called_at = (SELECT max(called_at) FROM calls WHERE contact_id = $1),
         last_outcome = (SELECT outcome FROM calls WHERE contact_id = $1 ORDER BY called_at DESC LIMIT 1)
       WHERE id = $1`,
      [rows[0].contact_id],
    );
    await db.query(`DELETE FROM activity WHERE type = 'call.logged' AND data->>'callId' = $1`, [req.params.id]);
  });
  res.json({ ok: true });
});

// ---------- Notes ----------

router.get('/contacts/:id/notes', async (req, res) => {
  const { rows } = await query(
    `SELECT n.*, u.name AS user_name, u.color AS user_color FROM notes n LEFT JOIN users u ON u.id = n.user_id
     WHERE n.contact_id = $1 ORDER BY n.pinned DESC, n.created_at DESC`,
    [req.params.id],
  );
  res.json({ notes: rows });
});

export async function addNote(db, contactId, { body, callId, pinned }, userId) {
  const { rows } = await db.query(
    'INSERT INTO notes (contact_id, call_id, user_id, body, pinned) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [contactId, callId ?? null, userId, body, pinned ?? false],
  );
  await db.query('UPDATE contacts SET updated_at = now() WHERE id = $1', [contactId]);
  return rows[0];
}

router.post('/contacts/:id/notes', async (req, res) => {
  const body = parse(z.object({ body: z.string().trim().min(1).max(50000), callId: z.string().uuid().optional() }), req.body);
  const note = await addNote({ query }, req.params.id, body, req.user.id);
  res.status(201).json({ note });
});

router.get('/notes', async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where = `WHERE n.body ILIKE $1 OR c.name ILIKE $1`;
  }
  const { rows } = await query(
    `SELECT n.*, u.name AS user_name, u.color AS user_color, c.name AS contact_name
     FROM notes n JOIN contacts c ON c.id = n.contact_id LEFT JOIN users u ON u.id = n.user_id
     ${where} ORDER BY n.created_at DESC LIMIT 200`,
    params,
  );
  res.json({ notes: rows });
});

router.patch('/notes/:id', async (req, res) => {
  const body = parse(z.object({ body: z.string().trim().min(1).max(50000).optional(), pinned: z.boolean().optional() }), req.body);
  const { rows } = await query(
    'UPDATE notes SET body = coalesce($1, body), pinned = coalesce($2, pinned), updated_at = now() WHERE id = $3 RETURNING *',
    [body.body ?? null, body.pinned ?? null, req.params.id],
  );
  if (!rows[0]) throw notFound('Note');
  res.json({ note: rows[0] });
});

router.delete('/notes/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM notes WHERE id = $1', [req.params.id]);
  if (!rowCount) throw notFound('Note');
  res.json({ ok: true });
});

// ---------- Tasks ----------

const taskSchema = z.object({
  title: z.string().trim().min(1).max(500),
  contactId: z.string().uuid().nullable().optional(),
  dueAt: dt.nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  done: z.boolean().optional(),
});

router.get('/tasks', async (req, res) => {
  const params = [];
  const where = [];
  const assignee = req.query.assignee || 'me';
  if (assignee !== 'all') {
    params.push(assignee === 'me' ? req.user.id : assignee);
    where.push(`t.assignee_id = $${params.length}`);
  }
  if (req.query.status === 'open') where.push('NOT t.done');
  if (req.query.status === 'done') where.push('t.done');
  if (req.query.contactId) {
    params.push(req.query.contactId);
    where.push(`t.contact_id = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT t.*, c.name AS contact_name, u.name AS assignee_name, u.color AS assignee_color
     FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.assignee_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.done, t.due_at NULLS LAST, t.created_at DESC LIMIT 500`,
    params,
  );
  res.json({ tasks: rows });
});

router.post('/tasks', async (req, res) => {
  const body = parse(taskSchema, req.body);
  const { rows } = await query(
    `INSERT INTO tasks (contact_id, title, due_at, assignee_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [body.contactId ?? null, body.title, body.dueAt ?? null, body.assigneeId === undefined ? req.user.id : body.assigneeId, req.user.id],
  );
  res.status(201).json({ task: rows[0] });
});

router.patch('/tasks/:id', async (req, res) => {
  const body = parse(taskSchema.partial(), req.body);
  const sets = [];
  const params = [];
  const set = (col, v) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (body.title !== undefined) set('title', body.title);
  if (body.dueAt !== undefined) set('due_at', body.dueAt);
  if (body.assigneeId !== undefined) set('assignee_id', body.assigneeId);
  if (body.contactId !== undefined) set('contact_id', body.contactId);
  if (body.done !== undefined) {
    set('done', body.done);
    sets.push(body.done ? 'done_at = now()' : 'done_at = NULL');
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  params.push(req.params.id);
  const { rows } = await query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  if (!rows[0]) throw notFound('Task');
  res.json({ task: rows[0] });
});

router.delete('/tasks/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  if (!rowCount) throw notFound('Task');
  res.json({ ok: true });
});

// ---------- Custom attributes ----------

const ATTR_TYPES = ['text', 'number', 'select', 'url', 'phone', 'email', 'date', 'checkbox'];
const attrSchema = z.object({
  label: z.string().trim().min(1).max(100),
  type: z.enum(ATTR_TYPES).default('text'),
  options: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
});

router.get('/attributes', async (req, res) => {
  const { rows } = await query('SELECT * FROM attributes ORDER BY position, created_at');
  res.json({ attributes: rows });
});

router.post('/attributes', async (req, res) => {
  const body = parse(attrSchema, req.body);
  const base = body.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'field';
  const { rows: existing } = await query('SELECT key FROM attributes WHERE key LIKE $1', [`${base}%`]);
  let key = base;
  for (let n = 2; existing.some((r) => r.key === key); n++) key = `${base}_${n}`;
  const { rows: pos } = await query('SELECT coalesce(max(position), -1) + 1 AS p FROM attributes');
  const { rows } = await query(
    'INSERT INTO attributes (key, label, type, options, position) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [key, body.label, body.type, JSON.stringify(body.options || []), pos[0].p],
  );
  res.status(201).json({ attribute: rows[0] });
});

router.patch('/attributes/:id', async (req, res) => {
  const body = parse(attrSchema.partial(), req.body);
  const { rows } = await query(
    'UPDATE attributes SET label = coalesce($1, label), type = coalesce($2, type), options = coalesce($3, options) WHERE id = $4 RETURNING *',
    [body.label ?? null, body.type ?? null, body.options ? JSON.stringify(body.options) : null, req.params.id],
  );
  if (!rows[0]) throw notFound('Attribute');
  res.json({ attribute: rows[0] });
});

router.delete('/attributes/:id', async (req, res) => {
  await tx(async (db) => {
    const { rows } = await db.query('DELETE FROM attributes WHERE id = $1 RETURNING key', [req.params.id]);
    if (!rows[0]) throw notFound('Attribute');
    await db.query('UPDATE contacts SET custom = custom - $1 WHERE custom ? $1', [rows[0].key]);
  });
  res.json({ ok: true });
});

// ---------- Team ----------

router.get('/users', async (req, res) => {
  const { rows } = await query('SELECT id, name, email, role, color, created_at FROM users ORDER BY created_at');
  res.json({ users: rows });
});

router.patch('/users/:id', async (req, res) => {
  const body = parse(z.object({
    name: z.string().trim().min(1).max(100).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    role: z.enum(['admin', 'member']).optional(),
  }), req.body);
  const self = req.params.id === req.user.id;
  if (!self && req.user.role !== 'admin') throw new HttpError(403, 'Admins only');
  if (body.role && req.user.role !== 'admin') throw new HttpError(403, 'Admins only');
  if (body.role === 'member' && self) throw new HttpError(400, "You can't demote yourself");
  const { rows } = await query(
    'UPDATE users SET name = coalesce($1, name), color = coalesce($2, color), role = coalesce($3, role) WHERE id = $4 RETURNING id, name, email, role, color',
    [body.name ?? null, body.color ?? null, body.role ?? null, req.params.id],
  );
  if (!rows[0]) throw notFound('User');
  res.json({ user: rows[0] });
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) throw new HttpError(400, "You can't remove yourself");
  const { rowCount } = await query('DELETE FROM users WHERE id = $1', [req.params.id]);
  if (!rowCount) throw notFound('User');
  res.json({ ok: true });
});

router.get('/workspace/invite', async (req, res) => {
  res.json({ code: await getInviteCode() });
});

router.post('/workspace/invite/regenerate', requireAdmin, async (req, res) => {
  res.json({ code: await regenerateInviteCode() });
});

// ---------- Dashboard & feed ----------

const SINCE = `date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1 - make_interval(days => $2::int - 1)`;

// Every lead a teammate worked, one row per (user, lead, day). Logged calls count as themselves;
// dragging a card on a board counts as one call too (its column decides whether it was a
// conversation or a meeting), unless the same user already logged that lead that day.
// Params: $1 tz, $2 days, $3 connected outcomes.
const TOUCHES = `
  WITH logged AS (
    SELECT user_id, contact_id, date_trunc('day', called_at AT TIME ZONE $1) AS day,
           count(*) AS calls,
           count(*) FILTER (WHERE outcome = ANY($3)) AS connects,
           count(*) FILTER (WHERE outcome = 'meeting_booked') AS meetings
    FROM calls WHERE called_at >= ${SINCE} GROUP BY 1, 2, 3
  ),
  moves AS (
    SELECT DISTINCT ON (a.user_id, a.contact_id, 3) a.user_id, a.contact_id,
           date_trunc('day', a.created_at AT TIME ZONE $1) AS day, s.kind, s.name, s.is_first
    FROM activity a
    LEFT JOIN LATERAL (
      SELECT st.kind, st.name, st.position = (SELECT min(position) FROM stages WHERE pipeline_id = st.pipeline_id) AS is_first
      FROM stages st
      WHERE CASE WHEN a.data ? 'toStageId' THEN st.id = (a.data->>'toStageId')::uuid
                 ELSE st.name = a.data->>'to' AND st.pipeline_id IN (SELECT id FROM pipelines WHERE name = a.data->>'pipeline') END
      LIMIT 1
    ) s ON true
    WHERE a.type = 'stage.changed' AND a.user_id IS NOT NULL AND a.contact_id IS NOT NULL AND a.created_at >= ${SINCE}
    ORDER BY a.user_id, a.contact_id, 3, a.created_at DESC, a.id DESC
  ),
  board AS (
    SELECT user_id, contact_id, day, 1 AS calls,
           (kind <> 'open' OR name ~* 'connect|follow|call ?back|interested|meeting')::int AS connects,
           (kind = 'won')::int AS meetings
    FROM moves WHERE NOT is_first
  ),
  touches AS (
    SELECT user_id, contact_id, day, max(calls)::int AS calls, max(connects)::int AS connects, max(meetings)::int AS meetings
    FROM (SELECT * FROM logged UNION ALL SELECT * FROM board) t GROUP BY 1, 2, 3
  )`;

router.get('/dashboard', async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 365);
  const tz = typeof req.query.tz === 'string' && /^[A-Za-z_/+-]{1,64}$/.test(req.query.tz) ? req.query.tz : 'UTC';
  const [totals, byUser, byOutcome, daily, followUps, tasks, contacts] = await Promise.all([
    query(
      `${TOUCHES}
       SELECT coalesce(sum(calls), 0)::int AS calls, coalesce(sum(connects), 0)::int AS connects,
              coalesce(sum(meetings), 0)::int AS meetings, count(DISTINCT contact_id)::int AS contacts_called
       FROM touches`,
      [tz, days, CONNECTED],
    ),
    query(
      `${TOUCHES}
       SELECT u.id, u.name, u.color, coalesce(sum(t.calls), 0)::int AS calls,
              coalesce(sum(t.connects), 0)::int AS connects, coalesce(sum(t.meetings), 0)::int AS meetings
       FROM users u LEFT JOIN touches t ON t.user_id = u.id
       GROUP BY u.id ORDER BY calls DESC, u.name`,
      [tz, days, CONNECTED],
    ),
    query(`SELECT outcome, count(*)::int AS n FROM calls WHERE called_at >= ${SINCE} GROUP BY outcome ORDER BY n DESC`, [tz, days]),
    query(
      `${TOUCHES}
       SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(x.n, 0)::int AS calls, coalesce(x.m, 0)::int AS connects
       FROM generate_series(date_trunc('day', now() AT TIME ZONE $1) - interval '13 days', date_trunc('day', now() AT TIME ZONE $1), interval '1 day') d
       LEFT JOIN (SELECT day, sum(calls) AS n, sum(connects) AS m FROM touches GROUP BY 1) x ON x.day = d ORDER BY d`,
      [tz, 14, CONNECTED],
    ),
    query(
      `SELECT id, name, phone, next_follow_up_at, owner_id FROM contacts
       WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at <= now() + interval '1 day'
       ORDER BY next_follow_up_at LIMIT 20`,
    ),
    query(
      `SELECT t.*, c.name AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
       WHERE NOT t.done AND t.assignee_id = $1 ORDER BY t.due_at NULLS LAST LIMIT 10`,
      [req.user.id],
    ),
    query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE call_count = 0)::int AS never_called FROM contacts`),
  ]);
  res.json({
    days,
    totals: totals.rows[0],
    byUser: byUser.rows,
    byOutcome: byOutcome.rows,
    daily: daily.rows,
    followUps: followUps.rows,
    tasks: tasks.rows,
    contacts: contacts.rows[0],
  });
});

router.get('/feed', async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM (
       SELECT 'activity' AS kind, a.id::text AS id, a.type, a.data, a.created_at, a.contact_id, a.user_id FROM activity a
       UNION ALL
       SELECT 'note', n.id::text, 'note.added', jsonb_build_object('body', left(n.body, 280)), n.created_at, n.contact_id, n.user_id FROM notes n
     ) f
     LEFT JOIN LATERAL (SELECT name AS contact_name FROM contacts WHERE id = f.contact_id) c ON true
     LEFT JOIN LATERAL (SELECT name AS user_name, color AS user_color FROM users WHERE id = f.user_id) u ON true
     WHERE f.type <> 'contact.updated'
     ORDER BY f.created_at DESC LIMIT 60`,
  );
  res.json({ feed: rows });
});

