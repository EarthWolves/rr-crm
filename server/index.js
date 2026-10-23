import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import { migrate } from './db.js';
import { authRouter, initAuth, requireAuth } from './auth.js';
import { HttpError, broadcastOnWrite, sseHandler } from './util.js';
import { router as contactsRouter } from './routes/contacts.js';
import { router as pipelinesRouter } from './routes/pipelines.js';
import { router as activityRouter } from './routes/activity.js';
import { mcpRouter } from './mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(compression({ filter: (req, res) => req.path !== '/api/events' && compression.filter(req, res) }));
  app.use(express.json({ limit: '25mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);

  const api = express.Router();
  api.use(requireAuth);
  api.get('/events', sseHandler);
  api.use(broadcastOnWrite);
  api.use('/contacts', contactsRouter);
  api.use(pipelinesRouter);
  api.use(activityRouter);
  app.use('/api', api);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/mcp', mcpRouter);

  const dist = path.join(__dirname, '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get(/.*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Upload too large' });
    if (err.code === '22P02') return res.status(400).json({ error: 'Invalid id' });
    if (err.code === '23503') return res.status(400).json({ error: 'Referenced record does not exist' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrate();
  await initAuth();
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log(`RR CRM listening on http://localhost:${port}`));
}
