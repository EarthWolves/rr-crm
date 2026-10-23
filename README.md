# RR CRM

A collaborative, Attio-style CRM built for cold calling. Import your call list, move leads through
custom pipelines, log every call with notes, and see what your teammates are doing in real time.

Custom CRM made by Rohan Raval.

## Features

- **Import from Excel or CSV.** Drop in an `.xlsx`/`.csv` file. Columns are matched automatically
  (Name, Phone, Website, City, State, Employees, Revenue, Owner, # Calls, Notes, Description…), you can
  map anything else to a custom field, and each value in a "stage" column can be mapped to a pipeline stage.
  Duplicates are detected by phone, website or name, so you can skip them or update them.
- **Custom pipelines.** Start from a cold-calling template (Not Contacted → Attempted → Voicemail Left →
  Gatekeeper → Connected → Follow-up → Meeting Booked / Not Interested) or build your own. You can rename,
  recolor, reorder, add and delete stages. There's a Kanban board with drag and drop plus a table view, and a
  contact can be in several pipelines.
- **Call queue (power dialer).** Pick a pipeline, stages and owner, then work through the list one company at
  a time: click-to-call, see the history, pick an outcome (keys 1–8), write notes, move the stage, set a
  follow-up, then **Save & next**. Logging an outcome suggests the matching stage.
- **Notes and call logs on every contact.** The activity timeline merges notes, calls, stage changes and field
  edits. You can pin, edit and delete notes.
- **Tasks and follow-ups.** Scheduling a follow-up while logging a call creates a task. Overdue items are
  highlighted.
- **Contacts table.** Search, filters (owner, pipeline, stage, state, last outcome, never called, follow-up
  due, tag), sorting, bulk assign / add to pipeline / tag / delete, and CSV export.
- **Custom fields.** Add text, number, dropdown, date, checkbox, URL, phone and email attributes.
- **Team collaboration.** Invite friends with an invite code. Everyone shares the same workspace, and changes
  show up live on other people's screens (server-sent events).
- **Dashboard.** Calls, conversations, connect rate, meetings booked, a calls-per-day chart, outcome
  breakdown, team leaderboard, follow-ups due and a team activity feed.

## Tech

- **Server:** Node.js + Express, PostgreSQL (`pg`), cookie-based JWT auth. Migrations run automatically on boot.
- **Client:** React + TypeScript + Vite + Tailwind CSS + TanStack Query. The server serves the built client,
  so the whole app is **one service plus one database**.

## Deploy (Railway, about 5 minutes)

1. Create a new project on [Railway](https://railway.com) → **Deploy from GitHub repo** → pick this repo.
2. In the same project, click **+ New → Database → PostgreSQL**.
3. On the app service, open **Variables**, add a reference variable `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   and set `JWT_SECRET` to a long random string.
4. Under **Settings → Networking**, click **Generate Domain**.
5. Open the URL. The first person to sign up becomes the admin. Go to **Settings → Team** and share the link
   and invite code with your friends.

`railway.json` already sets the build (`npm run build`), the start command and the health check.

Any other host with Node 20+ and Postgres works too (Render, Fly.io, a VPS). There's also a `Dockerfile`.
Set `DATABASE_URL` and run `npm ci && npm run build && npm start`. Managed Postgres providers like Neon or
Supabase work fine; add `?sslmode=require` to the URL or set `PGSSL=require`.

## Connect Claude (MCP)

The app includes an MCP server at `/mcp` so Claude can work your call loop: find a lead, log the call with
detailed notes, move it to the right column, and record action items as tasks. It uses the same code as the
app, so call counts, last outcome, follow-ups, the activity timeline and live updates all behave as if you
did it in the UI.

1. In Railway, add these variables to the app service and redeploy:
   - `MCP_TOKEN`: a long random secret, e.g. the output of `openssl rand -hex 32`. MCP is off until it's set.
   - `MCP_USER_EMAIL` (optional): the CRM user Claude acts as. Defaults to the first admin.
2. In Claude, add a custom connector with the URL `https://<your-app>/mcp/<MCP_TOKEN>`. Clients that can send
   headers can use `https://<your-app>/mcp` with `Authorization: Bearer <MCP_TOKEN>` instead. Treat the URL as
   a password; rotate `MCP_TOKEN` to revoke it.

Tools: `find_leads`, `get_lead`, `list_pipelines`, `log_call`, `add_note`, `move_lead`, `add_action_item`,
`list_tasks`, `complete_task`, `update_lead`. Nothing deletes data.

## Local development

```bash
docker compose up -d db                 # or use any local Postgres
cp .env.example .env
npm install && npm --prefix client install
npm run dev                             # API on http://localhost:3000
npm run dev:client                      # UI on http://localhost:5173 (proxies /api)
```

Tests (need a throwaway database, which they wipe):

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/rrcrm_test npm test
```

## Project layout

```
server/
  index.js            Express app, static hosting of client/dist
  db.js               Postgres pool + migrations
  auth.js             sign up / sign in / invite codes
  routes/contacts.js  contacts CRUD, filters, bulk actions, import, CSV export
  routes/pipelines.js pipelines, stages, board, entries
  routes/activity.js  calls, notes, tasks, custom fields, team, dashboard, feed
client/src/
  pages/              Dashboard, Contacts, ContactDetail, PipelineBoard, CallQueue, Import, Tasks, Calls, Settings
  components/         Layout, CallForm (log-a-call), shared UI
```
