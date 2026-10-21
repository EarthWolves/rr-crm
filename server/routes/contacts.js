import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { HttpError, logActivity, notFound, parse } from '../util.js';
import { TRADE_NAMES, classifyTrades } from '../trades.js';

export const router = Router();

export const CORE_FIELDS = [
  'name', 'phone', 'email', 'website', 'contact_person', 'contact_title', 'city', 'state',
  'company_type', 'employees', 'est_revenue', 'description',
];

const optStr = z.string().trim().max(10000).nullable().optional().transform((v) => (v === '' ? null : v));

const contactSchema = z.object({
  name: z.string().trim().min(1).max(500),
  phone: optStr,
  email: optStr,
  website: optStr,
  contact_person: optStr,
  contact_title: optStr,
  city: optStr,
  state: optStr,
  company_type: optStr,
  employees: optStr,
  est_revenue: optStr,
  description: optStr,
  tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  custom: z.record(z.string(), z.any()).optional(),
  trades: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  owner_id: z.string().uuid().nullable().optional(),
  next_follow_up_at: z.string().datetime({ offset: true }).nullable().optional(),
  call_count: z.number().int().min(0).optional(),
});

const SORTS = {
  name: 'lower(c.name)',
  created_at: 'c.created_at',
  updated_at: 'c.updated_at',
  last_called_at: 'c.last_called_at',
  next_follow_up_at: 'c.next_follow_up_at',
  call_count: 'c.call_count',
  state: 'lower(c.state)',
  city: 'lower(c.city)',
  employees: 'c.employees',
  est_revenue: 'c.est_revenue',
};

const ENTRIES_JSON = `COALESCE((
  SELECT json_agg(json_build_object('id', e.id, 'pipeline_id', e.pipeline_id, 'stage_id', e.stage_id))
  FROM pipeline_entries e WHERE e.contact_id = c.id
), '[]') AS entries`;

// Builds the WHERE clause shared by listing and export.
function buildFilters(q) {
  const where = [];
  const params = [];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (q.q) {
    const term = p(`%${q.q}%`);
    where.push(`(c.name ILIKE ${term} OR c.phone ILIKE ${term} OR c.website ILIKE ${term} OR c.email ILIKE ${term}
      OR c.city ILIKE ${term} OR c.state ILIKE ${term} OR c.contact_person ILIKE ${term} OR c.description ILIKE ${term}
      OR array_to_string(c.tags, ' ') ILIKE ${term})`);
  }
  if (q.owner === 'none') where.push('c.owner_id IS NULL');
  else if (q.owner) where.push(`c.owner_id = ${p(q.owner)}`);
  if (q.state) where.push(`c.state ILIKE ${p(q.state)}`);
  if (q.outcome) where.push(`c.last_outcome = ${p(q.outcome)}`);
  if (q.tag) where.push(`${p(q.tag)} = ANY(c.tags)`);
  if (q.trade === 'none') where.push('cardinality(c.trades) = 0');
  else if (q.trade) where.push(`c.trades && ${p(String(q.trade).split(','))}::text[]`);
  if (q.followUp === 'due') where.push('c.next_follow_up_at IS NOT NULL AND c.next_follow_up_at <= now()');
  if (q.followUp === 'upcoming') where.push('c.next_follow_up_at > now()');
  if (q.called === 'never') where.push('c.call_count = 0');
  if (q.called === 'yes') where.push('c.call_count > 0');
  if (q.pipelineId && q.pipelineId !== 'none') {
    const pid = p(q.pipelineId);
    if (q.stageId) {
      const stages = String(q.stageId).split(',');
      where.push(`EXISTS (SELECT 1 FROM pipeline_entries e WHERE e.contact_id = c.id AND e.pipeline_id = ${pid} AND e.stage_id = ANY(${p(stages)}::uuid[]))`);
    } else {
      where.push(`EXISTS (SELECT 1 FROM pipeline_entries e WHERE e.contact_id = c.id AND e.pipeline_id = ${pid})`);
    }
  }
  if (q.pipelineId === 'none') where.push('NOT EXISTS (SELECT 1 FROM pipeline_entries e WHERE e.contact_id = c.id)');
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params, p };
}

router.get('/', async (req, res) => {
  const { where, params, p } = buildFilters(req.query);
  // "queue" puts never-called contacts first, then the ones called longest ago.
  const order = req.query.sort === 'queue'
    ? 'c.last_called_at ASC NULLS FIRST, lower(c.name)'
    : `${SORTS[req.query.sort] || 'c.created_at'} ${req.query.dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const totalQ = await query(`SELECT count(*)::int AS n FROM contacts c ${where}`, params);
  const { rows } = await query(
    `SELECT c.*, ${ENTRIES_JSON} FROM contacts c ${where}
     ORDER BY ${order}, c.id LIMIT ${p(limit)} OFFSET ${p(offset)}`,
    params,
  );
  res.json({ contacts: rows, total: totalQ.rows[0].n });
});

router.get('/facets', async (req, res) => {
  const [states, tags, trades] = await Promise.all([
    query(`SELECT state AS value, count(*)::int AS n FROM contacts WHERE state IS NOT NULL GROUP BY state ORDER BY n DESC LIMIT 100`),
    query(`SELECT t AS value, count(*)::int AS n FROM contacts, unnest(tags) t GROUP BY t ORDER BY n DESC LIMIT 100`),
    query(`SELECT t AS value, count(*)::int AS n FROM contacts, unnest(trades) t GROUP BY t ORDER BY n DESC`),
  ]);
  res.json({ states: states.rows, tags: tags.rows, trades: trades.rows, tradeOptions: TRADE_NAMES });
});

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('; ') : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/export.csv', async (req, res) => {
  const { where, params } = buildFilters(req.query);
  const [{ rows }, attrs, users, pipelines] = await Promise.all([
    query(`SELECT c.*, ${ENTRIES_JSON} FROM contacts c ${where} ORDER BY lower(c.name)`, params),
    query('SELECT key, label FROM attributes ORDER BY position, created_at'),
    query('SELECT id, name FROM users'),
    query('SELECT p.id, p.name, json_object_agg(s.id, s.name) AS stages FROM pipelines p LEFT JOIN stages s ON s.pipeline_id = p.id GROUP BY p.id'),
  ]);
  const userName = Object.fromEntries(users.rows.map((u) => [u.id, u.name]));
  const header = [
    'Name', 'Phone', 'Email', 'Website', 'Contact Person', 'Contact Title', 'City', 'State', 'Company Type',
    'Employees', 'Est. Revenue', 'Owner', '# Calls', 'Last Outcome', 'Last Called', 'Next Follow-up', 'Trades', 'Tags',
    ...pipelines.rows.map((pl) => `Stage: ${pl.name}`),
    ...attrs.rows.map((a) => a.label),
    'Description',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const c of rows) {
    const stageByPipeline = Object.fromEntries(c.entries.map((e) => [e.pipeline_id, e.stage_id]));
    lines.push([
      c.name, c.phone, c.email, c.website, c.contact_person, c.contact_title, c.city, c.state, c.company_type,
      c.employees, c.est_revenue, userName[c.owner_id], c.call_count, c.last_outcome, c.last_called_at,
      c.next_follow_up_at, c.trades, c.tags,
      ...pipelines.rows.map((pl) => (stageByPipeline[pl.id] ? pl.stages[stageByPipeline[pl.id]] : '')),
      ...attrs.rows.map((a) => c.custom?.[a.key]),
      c.description,
    ].map(csvCell).join(','));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

router.post('/', async (req, res) => {
  const body = parse(contactSchema, req.body);
  const contact = await tx(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO contacts (${CORE_FIELDS.join(', ')}, tags, custom, owner_id, next_follow_up_at, created_by, trades)
       VALUES (${CORE_FIELDS.map((_, i) => `$${i + 1}`).join(', ')}, $13, $14, $15, $16, $17, $18) RETURNING *`,
      [...CORE_FIELDS.map((f) => body[f] ?? null), body.tags || [], body.custom || {},
        body.owner_id === undefined ? req.user.id : body.owner_id, body.next_follow_up_at ?? null, req.user.id,
        body.trades ?? classifyTrades(body)],
    );
    await logActivity(db, { contactId: rows[0].id, userId: req.user.id, type: 'contact.created', data: { name: rows[0].name } });
    return rows[0];
  });
  res.status(201).json({ contact });
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(`SELECT c.*, ${ENTRIES_JSON} FROM contacts c WHERE c.id = $1`, [req.params.id]);
  if (!rows[0]) throw notFound('Contact');
  res.json({ contact: rows[0] });
});

router.patch('/:id', async (req, res) => {
  const body = parse(contactSchema.partial(), req.body);
  const contact = await tx(async (db) => {
    const { rows: before } = await db.query('SELECT * FROM contacts WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!before[0]) throw notFound('Contact');
    const sets = [];
    const params = [];
    const changes = {};
    for (const [k, v] of Object.entries(body)) {
      if (k === 'custom') {
        // Merge custom fields so concurrent edits to different attributes don't clobber each other.
        params.push(v);
        sets.push(`custom = custom || $${params.length}::jsonb`);
        for (const [ck, cv] of Object.entries(v)) {
          if (JSON.stringify(before[0].custom?.[ck] ?? null) !== JSON.stringify(cv ?? null)) {
            changes[`custom.${ck}`] = { from: before[0].custom?.[ck] ?? null, to: cv };
          }
        }
        continue;
      }
      params.push(v);
      sets.push(`${k} = $${params.length}`);
      const prev = before[0][k] instanceof Date ? before[0][k].toISOString() : before[0][k];
      if (JSON.stringify(prev ?? null) !== JSON.stringify(v ?? null)) changes[k] = { from: prev ?? null, to: v };
    }
    if (!sets.length) return before[0];
    params.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE contacts SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (Object.keys(changes).length) {
      await logActivity(db, { contactId: req.params.id, userId: req.user.id, type: 'contact.updated', data: { changes } });
    }
    return rows[0];
  });
  res.json({ contact });
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM contacts WHERE id = $1', [req.params.id]);
  if (!rowCount) throw notFound('Contact');
  res.json({ ok: true });
});

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
  action: z.enum(['delete', 'assign', 'addToPipeline', 'removeFromPipeline', 'addTag']),
  ownerId: z.string().uuid().nullable().optional(),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  tag: z.string().trim().min(1).max(60).optional(),
});

router.post('/bulk', async (req, res) => {
  const body = parse(bulkSchema, req.body);
  const result = await tx(async (db) => {
    switch (body.action) {
      case 'delete': {
        const r = await db.query('DELETE FROM contacts WHERE id = ANY($1::uuid[])', [body.ids]);
        return { affected: r.rowCount };
      }
      case 'assign': {
        const r = await db.query('UPDATE contacts SET owner_id = $1, updated_at = now() WHERE id = ANY($2::uuid[])', [body.ownerId ?? null, body.ids]);
        return { affected: r.rowCount };
      }
      case 'addTag': {
        if (!body.tag) throw new HttpError(400, 'tag is required');
        const r = await db.query(
          `UPDATE contacts SET tags = array_append(tags, $1), updated_at = now() WHERE id = ANY($2::uuid[]) AND NOT ($1 = ANY(tags))`,
          [body.tag, body.ids],
        );
        return { affected: r.rowCount };
      }
      case 'addToPipeline': {
        if (!body.pipelineId) throw new HttpError(400, 'pipelineId is required');
        const stageId = body.stageId || (await firstStage(db, body.pipelineId));
        const r = await db.query(
          `INSERT INTO pipeline_entries (pipeline_id, contact_id, stage_id, position)
           SELECT $1, id, $2, extract(epoch from now()) FROM unnest($3::uuid[]) AS id
           ON CONFLICT (pipeline_id, contact_id) DO NOTHING`,
          [body.pipelineId, stageId, body.ids],
        );
        return { affected: r.rowCount };
      }
      case 'removeFromPipeline': {
        if (!body.pipelineId) throw new HttpError(400, 'pipelineId is required');
        const r = await db.query('DELETE FROM pipeline_entries WHERE pipeline_id = $1 AND contact_id = ANY($2::uuid[])', [body.pipelineId, body.ids]);
        return { affected: r.rowCount };
      }
    }
  });
  res.json(result);
});

export async function firstStage(db, pipelineId) {
  const { rows } = await db.query('SELECT id FROM stages WHERE pipeline_id = $1 ORDER BY position LIMIT 1', [pipelineId]);
  if (!rows[0]) throw new HttpError(400, 'Pipeline has no stages');
  return rows[0].id;
}

// ---------- Import ----------

const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.any())).min(1).max(10000),
  pipelineId: z.string().uuid().nullable().optional(),
  defaultStageId: z.string().uuid().nullable().optional(),
  dedupe: z.enum(['skip', 'update', 'create']).default('skip'),
  defaultOwnerId: z.string().uuid().nullable().optional(),
  tag: z.string().trim().max(60).optional(),
});

const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const normPhone = (p) => (p ? String(p).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') : '');
const normSite = (w) => (w ? String(w).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '') : '');

router.post('/import', async (req, res) => {
  const body = parse(importSchema, req.body);
  const summary = await tx(async (db) => {
    const users = (await db.query('SELECT id, name, email FROM users')).rows;
    const findUser = (v) => {
      const s = clean(v)?.toLowerCase();
      if (!s) return undefined;
      return users.find((u) => u.email.toLowerCase() === s || u.name.toLowerCase() === s)?.id;
    };

    // Existing contacts index for de-duplication.
    const existing = (await db.query('SELECT id, name, phone, website FROM contacts')).rows;
    const byPhone = new Map();
    const bySite = new Map();
    const byName = new Map();
    for (const c of existing) {
      if (normPhone(c.phone)) byPhone.set(normPhone(c.phone), c.id);
      if (normSite(c.website)) bySite.set(normSite(c.website), c.id);
      byName.set(c.name.toLowerCase(), c.id);
    }

    let stages = [];
    if (body.pipelineId) {
      stages = (await db.query('SELECT * FROM stages WHERE pipeline_id = $1 ORDER BY position', [body.pipelineId])).rows;
      if (!stages.length && !body.rows.some((r) => clean(r.stage))) throw new HttpError(400, 'Pipeline has no stages');
    }
    const stageFor = async (name) => {
      const n = clean(name);
      if (!n) return body.defaultStageId || stages[0]?.id;
      let s = stages.find((st) => st.name.toLowerCase() === n.toLowerCase());
      if (!s) {
        const palette = ['#94a3b8', '#60a5fa', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#22d3ee', '#fb923c'];
        const { rows } = await db.query(
          'INSERT INTO stages (pipeline_id, name, color, position) VALUES ($1, $2, $3, $4) RETURNING *',
          [body.pipelineId, n.slice(0, 200), palette[stages.length % palette.length], stages.length],
        );
        s = rows[0];
        stages.push(s);
      }
      return s.id;
    };

    const out = { created: 0, updated: 0, skipped: 0, notes: 0, stagesCreated: 0, errors: [] };
    const initialStageCount = stages.length;
    let i = 0;
    for (const raw of body.rows) {
      i++;
      const name = clean(raw.name);
      if (!name) {
        out.errors.push(`Row ${i}: missing name`);
        out.skipped++;
        continue;
      }
      const data = {};
      for (const f of CORE_FIELDS) data[f] = clean(raw[f]);
      data.name = name;
      const custom = {};
      for (const [k, v] of Object.entries(raw.custom || {})) if (clean(v) !== null) custom[k] = typeof v === 'string' ? v.trim() : v;
      const tags = [
        ...(Array.isArray(raw.tags) ? raw.tags : clean(raw.tags)?.split(/[,;]/) || []).map((t) => String(t).trim()).filter(Boolean),
        ...(body.tag ? [body.tag] : []),
      ];
      const ownerId = findUser(raw.owner) ?? body.defaultOwnerId ?? null;
      const callCount = Number.isFinite(Number(raw.call_count)) ? Math.max(0, parseInt(raw.call_count, 10) || 0) : 0;

      let matchId = null;
      if (body.dedupe !== 'create') {
        matchId = (normPhone(data.phone) && byPhone.get(normPhone(data.phone)))
          || (normSite(data.website) && bySite.get(normSite(data.website)))
          || byName.get(name.toLowerCase())
          || null;
      }
      let contactId;
      if (matchId && body.dedupe === 'skip') {
        out.skipped++;
        continue;
      } else if (matchId) {
        const sets = [];
        const params = [];
        for (const f of CORE_FIELDS) {
          if (data[f] !== null) {
            params.push(data[f]);
            sets.push(`${f} = $${params.length}`);
          }
        }
        params.push(custom);
        sets.push(`custom = custom || $${params.length}::jsonb`);
        params.push(tags);
        sets.push(`tags = ARRAY(SELECT DISTINCT unnest(tags || $${params.length}::text[]))`);
        params.push(classifyTrades({ ...data, custom }));
        sets.push(`trades = CASE WHEN cardinality(trades) = 0 THEN $${params.length}::text[] ELSE trades END`);
        if (ownerId) {
          params.push(ownerId);
          sets.push(`owner_id = $${params.length}`);
        }
        params.push(matchId);
        await db.query(`UPDATE contacts SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
        contactId = matchId;
        out.updated++;
      } else {
        const { rows } = await db.query(
          `INSERT INTO contacts (${CORE_FIELDS.join(', ')}, tags, custom, owner_id, call_count, created_by, trades)
           VALUES (${CORE_FIELDS.map((_, j) => `$${j + 1}`).join(', ')}, $13, $14, $15, $16, $17, $18) RETURNING id`,
          [...CORE_FIELDS.map((f) => data[f]), [...new Set(tags)], custom, ownerId, callCount, req.user.id,
            classifyTrades({ ...data, custom })],
        );
        contactId = rows[0].id;
        if (normPhone(data.phone)) byPhone.set(normPhone(data.phone), contactId);
        if (normSite(data.website)) bySite.set(normSite(data.website), contactId);
        byName.set(name.toLowerCase(), contactId);
        out.created++;
      }

      const noteText = clean(raw.note);
      if (noteText) {
        await db.query('INSERT INTO notes (contact_id, user_id, body) VALUES ($1, $2, $3)', [contactId, req.user.id, noteText]);
        out.notes++;
      }

      if (body.pipelineId) {
        const stageId = await stageFor(raw.stage);
        if (stageId) {
          await db.query(
            `INSERT INTO pipeline_entries (pipeline_id, contact_id, stage_id, position)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (pipeline_id, contact_id) DO UPDATE SET stage_id = EXCLUDED.stage_id, stage_changed_at = now()`,
            [body.pipelineId, contactId, stageId, i],
          );
        }
      }
    }
    out.stagesCreated = stages.length - initialStageCount;
    await logActivity(db, { userId: req.user.id, type: 'contacts.imported', data: { created: out.created, updated: out.updated } });
    return out;
  });
  res.json(summary);
});

// ---------- Timeline ----------

router.get('/:id/timeline', async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, u.name AS user_name, u.color AS user_color
     FROM activity a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.contact_id = $1 ORDER BY a.created_at DESC LIMIT 300`,
    [req.params.id],
  );
  res.json({ activity: rows });
});
