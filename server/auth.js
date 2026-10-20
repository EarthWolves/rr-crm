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
