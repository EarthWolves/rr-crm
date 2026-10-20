import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Columns3, Home, PhoneOutgoing, Upload } from 'lucide-react';
import { api, type Activity, type Task } from '../api';
import { useMe, usePipelines } from '../hooks';
import { OUTCOMES, fmtDateTime, outcomeOf, timeAgo } from '../lib';
import { Avatar, Button, EmptyState, PageHeader, PageLoader, Pill } from '../components/ui';
import { TaskRow } from './Tasks';

type Dash = {
  days: number;
  totals: { calls: number; connects: number; meetings: number; contacts_called: number };
  byUser: { id: string; name: string; color: string; calls: number; connects: number; meetings: number }[];
  byOutcome: { outcome: string; n: number }[];
  daily: { day: string; calls: number; connects: number }[];
  followUps: { id: string; name: string; phone: string | null; next_follow_up_at: string; owner_id: string | null }[];
  tasks: Task[];
  contacts: { total: number; never_called: number };
};

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function Dashboard() {
  const { data: me } = useMe();
  const { pipelines } = usePipelines();
  const [days, setDays] = useState(7);
  const q = useQuery({ queryKey: ['dashboard', days], queryFn: () => api.get<Dash>(`/dashboard?days=${days}&tz=${encodeURIComponent(tz)}`) });
  const feed = useQuery({ queryKey: ['feed'], queryFn: () => api.get<{ feed: Activity[] }>('/feed').then((r) => r.feed) });
  const d = q.data;

  if (q.isLoading || !d) return <PageLoader />;

  if (d.contacts.total === 0) {
    return (
      <div>
        <PageHeader title="Home" icon={<Home className="size-4" />} />
        <EmptyState icon={<Upload className="size-10" />} title={`Welcome, ${me?.name.split(' ')[0]}!`}>
          Start by importing your cold-call list. We'll set up a pipeline for you as part of the import.
          <div className="mt-4 flex justify-center gap-2">
            <Link to="/import"><Button variant="primary"><Upload className="size-3.5" /> Import contacts</Button></Link>
            <Link to="/settings"><Button>Invite teammates</Button></Link>
          </div>
        </EmptyState>
      </div>
    );
  }

  const connectRate = d.totals.calls ? Math.round((d.totals.connects / d.totals.calls) * 100) : 0;
  const maxDaily = Math.max(1, ...d.daily.map((x) => x.calls));
  const maxOutcome = Math.max(1, ...d.byOutcome.map((x) => x.n));

  return (
    <div>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${me?.name.split(' ')[0]}`} icon={<Home className="size-4" />}>
        <select className="input w-auto" value={days} onChange={(e) => setDays(+e.target.value)}>
          <option value={1}>Today</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <Link to="/dialer"><Button variant="primary" size="sm"><PhoneOutgoing className="size-3.5" /> Start calling</Button></Link>
      </PageHeader>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Calls" value={d.totals.calls} />
          <Stat label="Conversations" value={d.totals.connects} sub={`${connectRate}% connect rate`} />
          <Stat label="Meetings booked" value={d.totals.meetings} highlight />
          <Stat label="Companies reached" value={d.totals.contacts_called} />
          <Stat label="Never called" value={d.contacts.never_called} sub={`of ${d.contacts.total} contacts`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card p-4 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold">Calls per day <span className="font-normal text-gray-400">· last 14 days</span></h3>
            <div className="flex h-40 items-end gap-1.5">
              {d.daily.map((x) => (
                <div key={x.day} className="group relative flex h-full flex-1 flex-col justify-end">
                  <div className="pointer-events-none absolute -top-1 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full rounded bg-gray-900 px-2 py-1 text-xs whitespace-nowrap text-white group-hover:block">
                    {new Date(x.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: {x.calls} calls, {x.connects} conversations
                  </div>
                  <div className="relative w-full rounded-t bg-indigo-200" style={{ height: `${(x.calls / maxDaily) * 100}%`, minHeight: x.calls ? 3 : 0 }}>
                    <div className="absolute bottom-0 w-full rounded-t bg-indigo-500" style={{ height: `${x.calls ? (x.connects / x.calls) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-1.5 text-[10px] text-gray-400">
              {d.daily.map((x, i) => <div key={x.day} className="flex-1 text-center">{i % 2 === 1 ? '' : new Date(x.day + 'T12:00').getDate()}</div>)}
            </div>
            <div className="mt-2 flex gap-4 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-indigo-200" /> Calls</span>
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-indigo-500" /> Conversations</span>
            </div>
          </div>
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold">Outcomes</h3>
            {!d.byOutcome.length && <div className="text-sm text-gray-400">No calls in this period.</div>}
            <div className="space-y-2">
              {OUTCOMES.filter((o) => d.byOutcome.some((b) => b.outcome === o.value)).map((o) => {
                const n = d.byOutcome.find((b) => b.outcome === o.value)!.n;
                return (
                  <div key={o.value}>
                    <div className="flex justify-between text-xs"><span>{o.label}</span><span className="text-gray-500 tabular-nums">{n}</span></div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-gray-100"><div className="h-full rounded-full" style={{ width: `${(n / maxOutcome) * 100}%`, background: o.color }} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card overflow-hidden">
            <h3 className="border-b border-gray-100 px-4 py-2.5 text-sm font-semibold">Leaderboard</h3>
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500"><th className="px-4 py-1.5 text-left font-medium">Teammate</th><th className="px-2 text-right font-medium">Calls</th><th className="px-2 text-right font-medium">Convos</th><th className="px-4 text-right font-medium">Meetings</th></tr></thead>
              <tbody>
                {d.byUser.map((u, i) => (
                  <tr key={u.id} className="border-t border-gray-50">
                    <td className="px-4 py-1.5"><span className="inline-flex items-center gap-2"><span className="w-3 text-xs text-gray-400">{i + 1}</span><Avatar user={u} size={20} />{u.name}</span></td>
                    <td className="px-2 text-right tabular-nums">{u.calls}</td>
                    <td className="px-2 text-right tabular-nums">{u.connects}</td>
                    <td className="px-4 text-right font-medium tabular-nums">{u.meetings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
              <h3 className="text-sm font-semibold">Follow-ups due</h3>
              <Link to="/dialer?due=1&owner=any" className="text-xs text-indigo-600 hover:underline">Call them</Link>
            </div>
            <div className="max-h-72 divide-y divide-gray-50 overflow-y-auto">
              {d.followUps.map((f) => (
                <Link key={f.id} to={`/contacts/${f.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-50">
                  <span className="truncate">{f.name}</span>
                  <span className={new Date(f.next_follow_up_at) < new Date() ? 'text-xs font-medium text-red-600' : 'text-xs text-gray-500'}>{timeAgo(f.next_follow_up_at)}</span>
                </Link>
              ))}
              {!d.followUps.length && <div className="px-4 py-6 text-center text-sm text-gray-400">You're all caught up.</div>}
            </div>
          </div>
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
              <h3 className="text-sm font-semibold">My tasks</h3>
              <Link to="/tasks" className="text-xs text-indigo-600 hover:underline">All tasks</Link>
            </div>
            <div className="max-h-72 divide-y divide-gray-50 overflow-y-auto">
              {d.tasks.map((t) => <TaskRow key={t.id} task={t} />)}
              {!d.tasks.length && <div className="px-4 py-6 text-center text-sm text-gray-400">No open tasks.</div>}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold">Pipelines</h3>
            <div className="space-y-3">
              {pipelines.map((p) => (
                <Link key={p.id} to={`/pipelines/${p.id}`} className="block rounded-lg p-1 hover:bg-gray-50">
                  <div className="flex justify-between text-sm"><span className="inline-flex items-center gap-1.5 font-medium"><Columns3 className="size-3.5 text-gray-400" />{p.name}</span><span className="text-gray-500">{p.entry_count}</span></div>
                  <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-gray-100">
                    {p.stages.map((s) => <div key={s.id} title={`${s.name}: ${s.count}`} style={{ width: `${(s.count / Math.max(1, p.entry_count)) * 100}%`, background: s.color }} />)}
                  </div>
                </Link>
              ))}
              {!pipelines.length && <Link to="/pipelines?new=1" className="text-sm text-indigo-600">Create a pipeline</Link>}
            </div>
          </div>
          <div className="card overflow-hidden lg:col-span-2">
            <h3 className="border-b border-gray-100 px-4 py-2.5 text-sm font-semibold">Team activity</h3>
            <div className="max-h-96 divide-y divide-gray-50 overflow-y-auto">
              {(feed.data || []).map((a) => <FeedRow key={`${a.kind}${a.id}`} a={a} />)}
              {!feed.data?.length && <div className="px-4 py-6 text-center text-sm text-gray-400">No activity yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: number; sub?: string; highlight?: boolean }) {
  return (
    <div className={highlight ? 'card border-emerald-200 bg-emerald-50/50 p-4' : 'card p-4'}>
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function FeedRow({ a }: { a: Activity }) {
  let text: React.ReactNode = null;
  switch (a.type) {
    case 'call.logged': {
      const o = outcomeOf(a.data.outcome);
      text = <>called <Contact a={a} /> <Pill color={o?.color}>{o?.label}</Pill></>;
      break;
    }
    case 'note.added':
      text = <>noted on <Contact a={a} />: <span className="text-gray-500">“{a.data.body}”</span></>;
      break;
    case 'stage.changed':
      text = <>moved <Contact a={a} /> <ArrowRight className="inline size-3" /> <b style={{ color: a.data.toColor }}>{a.data.to}</b></>;
      break;
    case 'contact.created':
      text = <>added <Contact a={a} /></>;
      break;
    case 'pipeline.added':
      text = <>added <Contact a={a} /> to {a.data.pipeline}</>;
      break;
    case 'contacts.imported':
      text = <>imported {a.data.created} contacts{a.data.updated ? ` and updated ${a.data.updated}` : ''}</>;
      break;
    default:
      return null;
  }
  return (
    <div className="flex items-start gap-2 px-4 py-2 text-sm">
      <Avatar user={a.user_name ? { name: a.user_name, color: a.user_color || '#999' } : null} size={20} />
      <div className="min-w-0 flex-1 line-clamp-2"><b className="font-medium">{a.user_name || 'Someone'}</b> {text}</div>
      <span className="shrink-0 text-xs text-gray-400" title={fmtDateTime(a.created_at)}>{timeAgo(a.created_at)}</span>
    </div>
  );
}

function Contact({ a }: { a: Activity }) {
  return a.contact_id ? <Link to={`/contacts/${a.contact_id}`} className="font-medium hover:underline">{a.contact_name}</Link> : null;
}
