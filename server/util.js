import { query } from './db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);

// Validate a request body against a zod schema, throwing a 400 on failure.
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, `${issue.path.join('.') || 'body'}: ${issue.message}`);
  }
  return result.data;
}

export async function logActivity(db, { contactId = null, userId = null, type, data = {} }) {
  await (db || { query }).query(
    'INSERT INTO activity (contact_id, user_id, type, data) VALUES ($1, $2, $3, $4)',
    [contactId, userId, type, data],
  );
}

// Server-sent events: every connected browser gets a lightweight "something changed" ping
// so collaborators see each other's edits without refreshing.
const clients = new Set();

export function sseHandler(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const client = { res, userId: req.user.id };
  clients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

export function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.res.write(payload);
}

// Express middleware: after a successful mutating request, notify other clients.
export function broadcastOnWrite(req, res, next) {
  if (req.method === 'GET') return next();
  res.on('finish', () => {
    if (res.statusCode < 400) {
      broadcast({ path: req.baseUrl + req.path, method: req.method, by: req.user?.id });
    }
  });
  next();
}
