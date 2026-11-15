// Public, unauthenticated endpoint for the contact form on the personal website.
// Each message becomes (or attaches to) a contact tagged "website", with the message as a note.
import { Router } from 'express';
import { z } from 'zod';
import { tx } from '../db.js';
import { HttpError, broadcast, parse } from '../util.js';
import { createContact } from './contacts.js';
import { addNote } from './activity.js';

export const inboundRouter = Router();

const ALLOWED_ORIGINS = new Set(
  (process.env.PUBLIC_FORM_ORIGINS || 'https://rraval.com,https://www.rraval.com')
    .split(',').map((s) => s.trim()).filter(Boolean),
);

// CORS: only the personal site may post here from a browser.
inboundRouter.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      Vary: 'Origin',
    });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && ALLOWED_ORIGINS.has(origin) ? 204 : 403);
  if (origin && !ALLOWED_ORIGINS.has(origin)) throw new HttpError(403, 'Origin not allowed');
  next();
});

// Simple in-memory rate limit: 5 messages per IP per 10 minutes.
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 5;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
  return recent.length > LIMIT;
}

const schema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  message: z.string().trim().min(1).max(5000),
  topic: z.string().trim().max(60).optional().default(''),
  company: z.string().max(200).optional(), // honeypot: real people leave it empty
});

inboundRouter.post('/contact', async (req, res) => {
  if (rateLimited(req.ip)) throw new HttpError(429, 'Too many messages. Please try again later.');
  const body = parse(schema, req.body);
  if (body.company) return res.status(202).json({ ok: true }); // silently drop bots

  const tags = ['website', ...(body.topic ? [body.topic.toLowerCase()] : [])];
  const noteBody = `Website message${body.topic ? ` · ${body.topic}` : ''}\n\n${body.message}`;

  await tx(async (db) => {
    const { rows } = await db.query('SELECT id, tags FROM contacts WHERE lower(email) = lower($1) LIMIT 1', [body.email]);
    let id = rows[0]?.id;
    if (id) {
      const merged = [...new Set([...(rows[0].tags || []), ...tags])];
      await db.query('UPDATE contacts SET tags = $2, updated_at = now() WHERE id = $1', [id, merged]);
    } else {
      const c = await createContact(db, {
        name: body.name, email: body.email, contact_person: body.name, tags, trades: [],
        owner_id: null, next_follow_up_at: new Date().toISOString(),
      }, null);
      id = c.id;
      await db.query(`UPDATE activity SET data = data || '{"source":"website"}' WHERE contact_id = $1 AND type = 'contact.created'`, [id]);
      // New website leads start on the first step of the sales funnel, if there is one.
      const { rows: f } = await db.query(
        `SELECT p.id AS pipeline_id, s.id AS stage_id FROM pipelines p JOIN stages s ON s.pipeline_id = p.id
         WHERE p.kind = 'funnel' ORDER BY p.position, p.created_at, s.position LIMIT 1`);
      if (f[0]) {
        await db.query('INSERT INTO pipeline_entries (pipeline_id, contact_id, stage_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [f[0].pipeline_id, id, f[0].stage_id]);
      }
    }
    await addNote(db, id, { body: noteBody }, null);
    return id;
  });

  broadcast({ path: '/api/contacts', method: 'POST', by: null });
  res.status(201).json({ ok: true });
});
