import pg from 'pg';
import { classifyTrades } from './trades.js';

const { Pool, types } = pg;

// Return BIGINT counts as JS numbers rather than strings.
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1700, (v) => parseFloat(v));

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/rrcrm';

function sslConfig() {
  if (process.env.PGSSL === 'disable') return false;
  if (process.env.PGSSL === 'require') return { rejectUnauthorized: false };
  // Railway / Render / Neon public URLs need SSL; private networking and localhost do not.
  if (/localhost|127\.0\.0\.1|\.internal\b|\.railway\.internal/.test(connectionString)) return false;
  if (/sslmode=require/.test(connectionString)) return { rejectUnauthorized: false };
  return false;
}

export const pool = new Pool({ connectionString, ssl: sslConfig(), max: 10 });

export const query = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const migrations = [
  // 1: initial schema
  `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'member',
    color text NOT NULL DEFAULT '#6366f1',
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL
  );

  CREATE TABLE attributes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key text NOT NULL UNIQUE,
    label text NOT NULL,
    type text NOT NULL DEFAULT 'text',
    options jsonb NOT NULL DEFAULT '[]',
    position int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    phone text,
    email text,
    website text,
    contact_person text,
    contact_title text,
    city text,
    state text,
    company_type text,
    employees text,
    est_revenue text,
    description text,
    tags text[] NOT NULL DEFAULT '{}',
    custom jsonb NOT NULL DEFAULT '{}',
    owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
    call_count int NOT NULL DEFAULT 0,
    last_called_at timestamptz,
    last_outcome text,
    next_follow_up_at timestamptz,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX contacts_owner_idx ON contacts(owner_id);
  CREATE INDEX contacts_name_idx ON contacts(lower(name));
  CREATE INDEX contacts_followup_idx ON contacts(next_follow_up_at);

  CREATE TABLE pipelines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    position int NOT NULL DEFAULT 0,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE stages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    name text NOT NULL,
    color text NOT NULL DEFAULT '#94a3b8',
    kind text NOT NULL DEFAULT 'open',
    position int NOT NULL DEFAULT 0
  );
  CREATE INDEX stages_pipeline_idx ON stages(pipeline_id);

  CREATE TABLE pipeline_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    stage_id uuid NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    position double precision NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    stage_changed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pipeline_id, contact_id)
  );
  CREATE INDEX entries_stage_idx ON pipeline_entries(stage_id);
  CREATE INDEX entries_contact_idx ON pipeline_entries(contact_id);

  CREATE TABLE calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    outcome text NOT NULL,
    duration_sec int,
    notes text,
    pipeline_id uuid REFERENCES pipelines(id) ON DELETE SET NULL,
    from_stage_id uuid REFERENCES stages(id) ON DELETE SET NULL,
    to_stage_id uuid REFERENCES stages(id) ON DELETE SET NULL,
    called_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX calls_contact_idx ON calls(contact_id);
  CREATE INDEX calls_called_at_idx ON calls(called_at);

  CREATE TABLE notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    call_id uuid REFERENCES calls(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    body text NOT NULL,
    pinned boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX notes_contact_idx ON notes(contact_id);

  CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
    title text NOT NULL,
    due_at timestamptz,
    assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
    done boolean NOT NULL DEFAULT false,
    done_at timestamptz,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX tasks_assignee_idx ON tasks(assignee_id, done);
  CREATE INDEX tasks_contact_idx ON tasks(contact_id);

  CREATE TABLE activity (
    id bigserial PRIMARY KEY,
    contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    type text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX activity_contact_idx ON activity(contact_id, created_at DESC);
  CREATE INDEX activity_created_idx ON activity(created_at DESC);
  `,
  // 2: subcontractor trades, backfilled from existing data
  async (c) => {
    await c.query(`ALTER TABLE contacts ADD COLUMN trades text[] NOT NULL DEFAULT '{}'`);
    await c.query('CREATE INDEX contacts_trades_idx ON contacts USING gin (trades)');
    const { rows } = await c.query('SELECT id, name, company_type, custom, description FROM contacts');
    for (const row of rows) {
      const trades = classifyTrades(row);
      if (trades.length) await c.query('UPDATE contacts SET trades = $1 WHERE id = $2', [trades, row.id]);
    }
  },
  // 3: sales funnel. Pipelines get a kind ('board' or 'funnel'). A funnel automatically includes every
  // lead that is put on any other pipeline, at its first stage. Existing installs get a "Sales Funnel"
  // seeded from where leads stand on their other pipelines; nothing on those pipelines changes.
  async (c) => {
    await c.query(`ALTER TABLE pipelines ADD COLUMN kind text NOT NULL DEFAULT 'board'`);
    await c.query(`
      CREATE FUNCTION funnel_sync() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF EXISTS (SELECT 1 FROM pipelines WHERE id = NEW.pipeline_id AND kind = 'funnel') THEN RETURN NULL; END IF;
        INSERT INTO pipeline_entries (pipeline_id, contact_id, stage_id, position)
        SELECT p.id, NEW.contact_id, s.id, NEW.position
        FROM pipelines p
        JOIN LATERAL (SELECT id FROM stages WHERE pipeline_id = p.id ORDER BY position LIMIT 1) s ON true
        WHERE p.kind = 'funnel'
        ON CONFLICT (pipeline_id, contact_id) DO NOTHING;
        RETURN NULL;
      END
      $fn$`);
    await c.query(`CREATE TRIGGER pipeline_entries_funnel_sync AFTER INSERT ON pipeline_entries
      FOR EACH ROW EXECUTE FUNCTION funnel_sync()`);
    const { rows } = await c.query('SELECT count(*)::int AS n FROM pipeline_entries');
    if (rows[0].n > 0) {
      const { createFunnel } = await import('./routes/pipelines.js');
      const { rows: admin } = await c.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`);
      await createFunnel(c, admin[0]?.id ?? null);
    }
  },
  // 4: keep the funnel current from the cold-call boards, forward only. When a lead reaches a won column
  // on another pipeline (e.g. Meeting Booked) its funnel entry moves up to "Call with them"; a conversation
  // column (Connected, Follow-up, Call back) moves it up to "Identifying ICP". Leads already further along,
  // or marked as not a fit / customer, are left alone, and nothing happens if those steps were renamed.
  // Fires after the funnel_sync trigger (triggers run in name order).
  `
  CREATE FUNCTION funnel_advance() RETURNS trigger LANGUAGE plpgsql AS $fn$
  DECLARE
    src record;
    target text;
    moved record;
  BEGIN
    SELECT s.kind, s.name INTO src FROM stages s JOIN pipelines p ON p.id = s.pipeline_id
    WHERE s.id = NEW.stage_id AND p.kind <> 'funnel';
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF src.kind = 'won' THEN target := 'call with them';
    ELSIF src.kind = 'open' AND src.name ~* 'connect|follow|call ?back' THEN target := 'identifying icp';
    ELSE RETURN NULL;
    END IF;
    FOR moved IN
      UPDATE pipeline_entries fe SET stage_id = t.id, stage_changed_at = now()
      FROM pipelines fp, stages cur, stages t
      WHERE fe.contact_id = NEW.contact_id AND fp.id = fe.pipeline_id AND fp.kind = 'funnel'
        AND cur.id = fe.stage_id AND cur.kind = 'open'
        AND t.pipeline_id = fp.id AND lower(t.name) = target AND t.kind = 'open' AND t.position > cur.position
      RETURNING fe.contact_id, fp.name AS pipeline, cur.name AS from_name, t.name AS to_name, t.color, t.id AS to_id
    LOOP
      INSERT INTO activity (contact_id, user_id, type, data) VALUES (moved.contact_id, NULL, 'stage.changed',
        jsonb_build_object('pipeline', moved.pipeline, 'from', moved.from_name, 'to', moved.to_name,
                           'toColor', moved.color, 'toStageId', moved.to_id, 'auto', true));
    END LOOP;
    RETURN NULL;
  END
  $fn$;
  CREATE TRIGGER pipeline_entries_funnel_up AFTER INSERT OR UPDATE OF stage_id ON pipeline_entries
    FOR EACH ROW EXECUTE FUNCTION funnel_advance();
  `,
];

export async function migrate() {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  for (let i = 0; i < migrations.length; i++) {
    const version = i + 1;
    if (applied.has(version)) continue;
    await tx(async (c) => {
      if (typeof migrations[i] === 'function') await migrations[i](c);
      else await c.query(migrations[i]);
      await c.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
    });
    console.log(`Applied migration ${version}`);
  }
}
