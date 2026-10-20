import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { HttpError, logActivity, notFound, parse } from '../util.js';
import { firstStage } from './contacts.js';

export const router = Router();

export const TEMPLATES = {
  cold_call: [
    { name: 'Not Contacted', color: '#94a3b8' },
    { name: 'Attempted', color: '#60a5fa' },
    { name: 'Voicemail Left', color: '#a78bfa' },
    { name: 'Gatekeeper', color: '#f472b6' },
    { name: 'Connected', color: '#22d3ee' },
    { name: 'Follow-up', color: '#fbbf24' },
    { name: 'Meeting Booked', color: '#34d399', kind: 'won' },
    { name: 'Not Interested', color: '#f87171', kind: 'lost' },
  ],
  sales: [
    { name: 'Lead', color: '#94a3b8' },
    { name: 'Qualified', color: '#60a5fa' },
    { name: 'Discovery', color: '#a78bfa' },
    { name: 'Proposal', color: '#fbbf24' },
    { name: 'Negotiation', color: '#fb923c' },
    { name: 'Won', color: '#34d399', kind: 'won' },
    { name: 'Lost', color: '#f87171', kind: 'lost' },
  ],
  blank: [{ name: 'New', color: '#94a3b8' }],
};

const stageInput = z.object({
  name: z.string().trim().min(1).max(200),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  kind: z.enum(['open', 'won', 'lost']).optional(),
});

const pipelineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  template: z.enum(['cold_call', 'sales', 'blank']).optional(),
  stages: z.array(stageInput).max(50).optional(),
});

export async function createPipeline(db, { name, description, template, stages }, userId) {
  const { rows: pos } = await db.query('SELECT coalesce(max(position), -1) + 1 AS p FROM pipelines');
  const { rows } = await db.query(
    'INSERT INTO pipelines (name, description, position, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, description ?? null, pos[0].p, userId],
  );
  const list = stages?.length ? stages : TEMPLATES[template || 'cold_call'];
  for (let i = 0; i < list.length; i++) {
    await db.query('INSERT INTO stages (pipeline_id, name, color, kind, position) VALUES ($1, $2, $3, $4, $5)', [
      rows[0].id, list[i].name, list[i].color || '#94a3b8', list[i].kind || 'open', i,
    ]);
  }
  return rows[0];
}

router.get('/pipelines', async (req, res) => {
  const { rows } = await query(`
    SELECT p.*,
      COALESCE((SELECT json_agg(s ORDER BY s.position) FROM (
        SELECT st.*, (SELECT count(*)::int FROM pipeline_entries e WHERE e.stage_id = st.id) AS count
        FROM stages st WHERE st.pipeline_id = p.id
      ) s), '[]') AS stages,
      (SELECT count(*)::int FROM pipeline_entries e WHERE e.pipeline_id = p.id) AS entry_count
    FROM pipelines p ORDER BY p.position, p.created_at`);
  res.json({ pipelines: rows, templates: Object.keys(TEMPLATES) });
});

router.post('/pipelines', async (req, res) => {
  const body = parse(pipelineSchema, req.body);
  const pipeline = await tx((db) => createPipeline(db, body, req.user.id));
  res.status(201).json({ pipeline });
});

router.patch('/pipelines/:id', async (req, res) => {
  const body = parse(pipelineSchema.pick({ name: true, description: true }).partial(), req.body);
  const { rows } = await query(
    'UPDATE pipelines SET name = coalesce($1, name), description = coalesce($2, description) WHERE id = $3 RETURNING *',
    [body.name ?? null, body.description ?? null, req.params.id],
  );
  if (!rows[0]) throw notFound('Pipeline');
  res.json({ pipeline: rows[0] });
});

router.delete('/pipelines/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM pipelines WHERE id = $1', [req.params.id]);
  if (!rowCount) throw notFound('Pipeline');
  res.json({ ok: true });
});

router.get('/pipelines/:id/board', async (req, res) => {
  const params = [req.params.id];
  const where = ['e.pipeline_id = $1'];
  if (req.query.owner === 'none') where.push('c.owner_id IS NULL');
  else if (req.query.owner) {
    params.push(req.query.owner);
    where.push(`c.owner_id = $${params.length}`);
  }
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.state ILIKE $${params.length} OR c.city ILIKE $${params.length})`);
  }
  const { rows } = await query(
    `SELECT e.id, e.stage_id, e.position, e.stage_changed_at, e.contact_id,
            c.name, c.phone, c.website, c.city, c.state, c.owner_id, c.call_count, c.last_outcome,
            c.last_called_at, c.next_follow_up_at, c.tags, c.employees, c.est_revenue
     FROM pipeline_entries e JOIN contacts c ON c.id = e.contact_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.position, c.name`,
    params,
  );
  res.json({ entries: rows });
});

// ---------- Stages ----------

router.post('/pipelines/:id/stages', async (req, res) => {
  const body = parse(stageInput, req.body);
  const { rows: pos } = await query('SELECT coalesce(max(position), -1) + 1 AS p FROM stages WHERE pipeline_id = $1', [req.params.id]);
  const { rows } = await query(
    'INSERT INTO stages (pipeline_id, name, color, kind, position) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [req.params.id, body.name, body.color || '#94a3b8', body.kind || 'open', pos[0].p],
  );
  res.status(201).json({ stage: rows[0] });
});

router.put('/pipelines/:id/stage-order', async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.string().uuid()) }), req.body);
  await tx(async (db) => {
    for (let i = 0; i < ids.length; i++) {
      await db.query('UPDATE stages SET position = $1 WHERE id = $2 AND pipeline_id = $3', [i, ids[i], req.params.id]);
    }
  });
  res.json({ ok: true });
});

router.patch('/stages/:id', async (req, res) => {
  const body = parse(stageInput.partial(), req.body);
  const { rows } = await query(
    'UPDATE stages SET name = coalesce($1, name), color = coalesce($2, color), kind = coalesce($3, kind) WHERE id = $4 RETURNING *',
    [body.name ?? null, body.color ?? null, body.kind ?? null, req.params.id],
  );
  if (!rows[0]) throw notFound('Stage');
  res.json({ stage: rows[0] });
});

router.delete('/stages/:id', async (req, res) => {
  const moveTo = req.query.moveTo;
  await tx(async (db) => {
    const { rows } = await db.query('SELECT * FROM stages WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw notFound('Stage');
    const { rows: siblings } = await db.query('SELECT count(*)::int AS n FROM stages WHERE pipeline_id = $1', [rows[0].pipeline_id]);
    if (siblings[0].n <= 1) throw new HttpError(400, 'A pipeline needs at least one stage');
    if (moveTo) {
      const { rows: target } = await db.query('SELECT 1 FROM stages WHERE id = $1 AND pipeline_id = $2', [moveTo, rows[0].pipeline_id]);
      if (!target[0] || moveTo === req.params.id) throw new HttpError(400, 'Invalid target stage');
      await db.query('UPDATE pipeline_entries SET stage_id = $1, stage_changed_at = now() WHERE stage_id = $2', [moveTo, req.params.id]);
    }
    await db.query('DELETE FROM stages WHERE id = $1', [req.params.id]);
  });
  res.json({ ok: true });
});

// ---------- Entries ----------

router.post('/pipelines/:id/entries', async (req, res) => {
  const body = parse(z.object({ contactIds: z.array(z.string().uuid()).min(1), stageId: z.string().uuid().optional() }), req.body);
  const count = await tx(async (db) => {
    const stageId = body.stageId || (await firstStage(db, req.params.id));
    const r = await db.query(
      `INSERT INTO pipeline_entries (pipeline_id, contact_id, stage_id, position)
       SELECT $1, id, $2, extract(epoch from now()) FROM unnest($3::uuid[]) AS id
       ON CONFLICT (pipeline_id, contact_id) DO NOTHING RETURNING contact_id`,
      [req.params.id, stageId, body.contactIds],
    );
    const { rows: pl } = await db.query('SELECT name FROM pipelines WHERE id = $1', [req.params.id]);
    for (const row of r.rows) {
      await logActivity(db, { contactId: row.contact_id, userId: req.user.id, type: 'pipeline.added', data: { pipeline: pl[0]?.name } });
    }
    return r.rowCount;
  });
  res.status(201).json({ added: count });
});

// Move an entry to another stage. Shared by the board and the call logger.
export async function moveEntry(db, entryId, stageId, userId, position) {
  const { rows } = await db.query(
    `SELECT e.*, p.name AS pipeline_name, s.name AS stage_name
     FROM pipeline_entries e JOIN pipelines p ON p.id = e.pipeline_id JOIN stages s ON s.id = e.stage_id
     WHERE e.id = $1 FOR UPDATE OF e`,
    [entryId],
  );
  const entry = rows[0];
  if (!entry) throw notFound('Pipeline entry');
  const { rows: target } = await db.query('SELECT * FROM stages WHERE id = $1 AND pipeline_id = $2', [stageId, entry.pipeline_id]);
  if (!target[0]) throw new HttpError(400, 'Stage does not belong to this pipeline');
  const changed = entry.stage_id !== stageId;
  const { rows: updated } = await db.query(
    `UPDATE pipeline_entries SET stage_id = $1, position = coalesce($2, position),
       stage_changed_at = CASE WHEN $4 THEN now() ELSE stage_changed_at END
     WHERE id = $3 RETURNING *`,
    [stageId, position ?? null, entryId, changed],
  );
  if (changed) {
    await logActivity(db, {
      contactId: entry.contact_id,
      userId,
      type: 'stage.changed',
      data: { pipeline: entry.pipeline_name, from: entry.stage_name, to: target[0].name, toColor: target[0].color },
    });
  }
  return { entry: updated[0], from: entry.stage_id, changed };
}

router.patch('/entries/:id', async (req, res) => {
  const body = parse(z.object({ stageId: z.string().uuid(), position: z.number().optional() }), req.body);
  const { entry } = await tx((db) => moveEntry(db, req.params.id, body.stageId, req.user.id, body.position));
  res.json({ entry });
});

router.delete('/entries/:id', async (req, res) => {
  const { rows } = await query(
    `DELETE FROM pipeline_entries e USING pipelines p WHERE e.id = $1 AND p.id = e.pipeline_id RETURNING e.contact_id, p.name`,
    [req.params.id],
  );
  if (!rows[0]) throw notFound('Pipeline entry');
  await logActivity(null, { contactId: rows[0].contact_id, userId: req.user.id, type: 'pipeline.removed', data: { pipeline: rows[0].name } });
  res.json({ ok: true });
});
