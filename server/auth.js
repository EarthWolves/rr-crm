import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { z } from 'zod';
import { query } from './db.js';
import { HttpError, parse } from './util.js';

const COOKIE = 'rrcrm_session';
const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16'];

let secret = process.env.JWT_SECRET;

export async function initAuth() {
  if (secret) return;
  // No secret configured: persist a generated one so sessions survive restarts.
  const { rows } = await query(`SELECT value FROM settings WHERE key = 'jwt_secret'`);
  if (rows[0]) {
    secret = rows[0].value;
  } else {
    secret = crypto.randomBytes(48).toString('hex');
    await query(`INSERT INTO settings (key, value) VALUES ('jwt_secret', $1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(secret)]);
  }
}

export async function getInviteCode() {
  const { rows } = await query(`SELECT value FROM settings WHERE key = 'invite_code'`);
  if (rows[0]) return rows[0].value;
  const code = crypto.randomBytes(6).toString('base64url');
  await query(`INSERT INTO settings (key, value) VALUES ('invite_code', $1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(code)]);
  return code;
}

export async function regenerateInviteCode() {
  const code = crypto.randomBytes(6).toString('base64url');
  await query(
    `INSERT INTO settings (key, value) VALUES ('invite_code', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(code)],
  );
  return code;
}

function setSession(res, user) {
  const token = jwt.sign({ sub: user.id }, secret, { expiresIn: '30d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: res.req.secure,
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

// ---------- Hidden users ----------
// HIDDEN_USERS is a comma-separated list of user ids, emails or full names. A signed-in hidden user gets a
// plain "Cannot GET /" not-found page (404 JSON on the API) everywhere, as if the app didn't exist. Their
// account, sessions and data are untouched; remove the variable to undo. The workspace owner (first admin)
// can never be hidden, and an entry that matches more than one user hides nobody.
const HIDDEN_TTL_MS = 60_000;
let hidden = { at: 0, key: '', ids: new Set() };
let lastHiddenLog = '';

function hiddenEntries() {
  return (process.env.HIDDEN_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export async function hiddenUserIds() {
  const entries = hiddenEntries();
  if (!entries.length) return new Set();
  const key = entries.join(',');
  if (hidden.key === key && Date.now() - hidden.at < HIDDEN_TTL_MS) return hidden.ids;
  const { rows } = await query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at');
  const ownerId = rows.find((u) => u.role === 'admin')?.id;
  const ids = new Set();
  const log = [];
  for (const entry of entries) {
    const matches = rows.filter((u) => u.id === entry || u.email.toLowerCase() === entry || u.name.trim().toLowerCase() === entry);
    if (matches.length === 1 && matches[0].id !== ownerId) {
      ids.add(matches[0].id);
      log.push(`hiding ${matches[0].name} (${matches[0].id})`);
    } else if (matches.length === 1) {
      log.push(`"${entry}" is the workspace owner and can't be hidden`);
    } else {
      log.push(`"${entry}" matched ${matches.length} users, hiding nobody for it`);
    }
  }
  const line = `HIDDEN_USERS: ${log.join('; ')}`;
  if (line !== lastHiddenLog) console.log((lastHiddenLog = line));
  hidden = { at: Date.now(), key, ids };
  return ids;
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function sendNotFound(req, res) {
  res.status(404);
  if (req.path.startsWith('/api') || req.path.startsWith('/mcp')) return res.json({ error: 'Not found' });
  res.set('Content-Security-Policy', "default-src 'none'");
  res.type('html').send(
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n` +
      `<pre>Cannot ${escapeHtml(req.method)} ${escapeHtml(req.path)}</pre>\n</body>\n</html>\n`,
  );
}

export async function hideUsers(req, res, next) {
  if (!hiddenEntries().length) return next();
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  let sub;
  try {
    ({ sub } = jwt.verify(token, secret));
  } catch {
    return next();
  }
  try {
    if (!(await hiddenUserIds()).has(sub)) return next();
  } catch (err) {
    return next(err);
  }
  sendNotFound(req, res);
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, color: u.color });

export async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next(new HttpError(401, 'Not signed in'));
  try {
    const { sub } = jwt.verify(token, secret);
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [sub]);
    if (!rows[0]) return next(new HttpError(401, 'Not signed in'));
    req.user = publicUser(rows[0]);
    next();
  } catch {
    next(new HttpError(401, 'Session expired'));
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Admins only'));
  next();
}

export const authRouter = Router();

authRouter.get('/status', async (req, res) => {
  const { rows } = await query('SELECT count(*)::int AS n FROM users');
  res.json({ needsSetup: rows[0].n === 0 });
});

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'must be at least 8 characters').max(200),
  inviteCode: z.string().trim().optional(),
});

authRouter.post('/register', async (req, res) => {
  const body = parse(registerSchema, req.body);
  const { rows: countRows } = await query('SELECT count(*)::int AS n FROM users');
  const isFirst = countRows[0].n === 0;
  if (!isFirst) {
    const code = await getInviteCode();
    if (!body.inviteCode || body.inviteCode !== code) {
      throw new HttpError(403, 'A valid invite code is required. Ask your workspace admin for it.');
    }
  }
  const existing = await query('SELECT 1 FROM users WHERE email = $1', [body.email]);
  if (existing.rowCount) throw new HttpError(409, 'An account with that email already exists');
  const hash = await bcrypt.hash(body.password, 10);
  const color = COLORS[countRows[0].n % COLORS.length];
  const { rows } = await query(
    'INSERT INTO users (name, email, password_hash, role, color) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [body.name, body.email, hash, isFirst ? 'admin' : 'member', color],
  );
  setSession(res, rows[0]);
  res.status(201).json({ user: publicUser(rows[0]) });
});

const loginSchema = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

authRouter.post('/login', async (req, res) => {
  const body = parse(loginSchema, req.body);
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [body.email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
    throw new HttpError(401, 'Incorrect email or password');
  }
  setSession(res, user);
  // A hidden user's next page load shows the not-found page (see hideUsers).
  if ((await hiddenUserIds()).has(user.id)) throw new HttpError(404, 'Not found');
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

const passwordSchema = z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(200) });

authRouter.post('/password', requireAuth, async (req, res) => {
  const body = parse(passwordSchema, req.body);
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(body.currentPassword, rows[0].password_hash))) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(body.newPassword, 10), req.user.id]);
  res.json({ ok: true });
});
