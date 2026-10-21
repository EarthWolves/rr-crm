import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Globe, MapPin, Phone, PhoneOutgoing, SkipForward, Square } from 'lucide-react';
import { api, qs, type Call, type Contact, type Note } from '../api';
import { useMe, usePipelines, useUsers } from '../hooks';
import { OUTCOMES, fmtDateTime, outcomeOf, prettySite, siteHref, telHref, timeAgo } from '../lib';
import { Avatar, Button, EmptyState, PageHeader, PageLoader, Pill } from '../components/ui';
import { CallForm } from '../components/CallForm';
import { useTradeOptions } from '../components/Notes';

export default function CallQueue() {
  const [params, setParams] = useSearchParams();
  const { data: me } = useMe();
  const { pipelines } = usePipelines();
  const { users } = useUsers();
  const [queue, setQueue] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0);
  const [session, setSession] = useState<Record<string, number>>({});

  const pipelineId = params.get('pipelineId') || pipelines[0]?.id || '';
  const pipeline = pipelines.find((p) => p.id === pipelineId);
  const owner = params.get('owner') || 'any';
  const dueOnly = params.get('due') === '1';
  const state = params.get('state') || '';
  const trade = params.get('trade') || '';
  const facets = useTradeOptions();
  const defaultStages = useMemo(() => pipeline?.stages.filter((s) => s.kind === 'open').map((s) => s.id) || [], [pipeline]);
  const stageIds = params.get('stages')?.split(',').filter(Boolean) || defaultStages;

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    setParams(next, { replace: true });
  };

  const filters = {
    pipelineId: pipelineId || undefined,
    stageId: pipelineId && stageIds.length ? stageIds.join(',') : undefined,
    owner: owner === 'me' ? me?.id : owner === 'any' ? undefined : owner,
    followUp: dueOnly ? 'due' : undefined,
    state: state || undefined,
    trade: trade || undefined,
    sort: 'queue',
    limit: 500,
  };
  const preview = useQuery({
    queryKey: ['contacts', 'queue', filters],
    queryFn: () => api.get<{ contacts: Contact[]; total: number }>(`/contacts${qs(filters)}`),
    enabled: !queue && (!pipelineId || stageIds.length > 0),
  });

  if (queue) {
    const done = index >= queue.length;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title={<>Calling {pipeline ? `· ${pipeline.name}` : ''}</>} icon={<PhoneOutgoing className="size-4" />}>
          <span className="text-sm text-gray-500">{Math.min(index + 1, queue.length)} / {queue.length}</span>
          <div className="hidden gap-1 sm:flex">
            {OUTCOMES.filter((o) => session[o.value]).map((o) => (
              <Pill key={o.value} color={o.color}>{o.label} {session[o.value]}</Pill>
            ))}
          </div>
          <Button size="sm" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft className="size-3.5" /></Button>
          <Button size="sm" disabled={done} onClick={() => setIndex(index + 1)}><SkipForward className="size-3.5" /> Skip</Button>
          <Button size="sm" onClick={() => { setQueue(null); setIndex(0); }}><Square className="size-3.5" /> End session</Button>
        </PageHeader>
        <div className="h-1 bg-gray-100"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${(index / queue.length) * 100}%` }} /></div>
        {done ? (
          <EmptyState icon={<PhoneOutgoing className="size-10" />} title="Queue complete 🎉">
            You logged {OUTCOMES.reduce((a, o) => a + (session[o.value] || 0), 0)} calls this session.
            <div className="mt-3 flex justify-center gap-2">
              <Button onClick={() => { setQueue(null); setIndex(0); setSession({}); }}>New session</Button>
              <Link to="/"><Button variant="primary">See dashboard</Button></Link>
            </div>
          </EmptyState>
        ) : (
          <DialerCard
            key={queue[index]}
            contactId={queue[index]}
            pipelineId={pipelineId}
            onLogged={(outcome) => {
              setSession((s) => ({ ...s, [outcome]: (s[outcome] || 0) + 1 }));
              setIndex((i) => i + 1);
            }}
          />
        )}
      </div>
    );
  }

  const list = preview.data?.contacts || [];
  return (
    <div>
      <PageHeader title="Call queue" icon={<PhoneOutgoing className="size-4" />} />
      <div className="mx-auto grid max-w-5xl gap-4 p-4 lg:grid-cols-[340px_1fr]">
        <div className="card space-y-4 self-start p-4">
          <div>
            <div className="label">Pipeline</div>
            <select className="input" value={pipelineId} onChange={(e) => { const n = new URLSearchParams(params); n.set('pipelineId', e.target.value); n.delete('stages'); setParams(n, { replace: true }); }}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="">All contacts</option>
            </select>
          </div>
          {pipeline && (
            <div>
              <div className="label">Stages to call</div>
              <div className="space-y-1">
                {pipeline.stages.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={stageIds.includes(s.id)}
                      onChange={(e) => set({ stages: (e.target.checked ? [...stageIds, s.id] : stageIds.filter((x) => x !== s.id)).join(',') })}
                    />
                    <span className="size-2 rounded-full" style={{ background: s.color }} />
                    <span className="flex-1">{s.name}</span>
                    <span className="text-xs text-gray-400">{s.count}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="label">Owner</div>
            <select className="input" value={owner} onChange={(e) => set({ owner: e.target.value })}>
              <option value="any">Everyone’s</option>
              <option value="me">My contacts</option>
              <option value="none">Unassigned</option>
              {users.filter((u) => u.id !== me?.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="label">State</div>
              <select className="input" value={state} onChange={(e) => set({ state: e.target.value })}>
                <option value="">Any</option>
                {facets?.states.map((s) => <option key={s.value} value={s.value}>{s.value} ({s.n})</option>)}
              </select>
            </div>
            <div>
              <div className="label">Trade</div>
              <select className="input" value={trade} onChange={(e) => set({ trade: e.target.value })}>
                <option value="">Any</option>
                {facets?.trades.map((t) => <option key={t.value} value={t.value}>{t.value} ({t.n})</option>)}
                <option value="none">No trade set</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={dueOnly} onChange={(e) => set({ due: e.target.checked ? '1' : '' })} />
            Only follow-ups that are due
          </label>
          <Button variant="primary" className="w-full" disabled={!list.length} onClick={() => { setQueue(list.map((c) => c.id)); setIndex(0); setSession({}); }}>
            <PhoneOutgoing className="size-3.5" /> Start calling {list.length ? `(${list.length})` : ''}
          </Button>
          <p className="text-xs text-gray-500">Never-called contacts come first, then the ones called longest ago.</p>
        </div>
        <div className="card overflow-hidden">
          <div className="border-b border-gray-100 px-4 py-2 text-sm font-medium">Up next</div>
          {preview.isLoading ? <PageLoader /> : !list.length ? (
            <EmptyState title="No one to call">Try other stages or owners. {!pipelines.length && <Link to="/pipelines?new=1" className="text-indigo-600">Create a pipeline</Link>}</EmptyState>
          ) : (
            <div className="max-h-[65vh] divide-y divide-gray-100 overflow-y-auto">
              {list.map((c, i) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="w-6 text-right text-xs text-gray-400">{i + 1}</span>
                  <span className="flex-1 truncate font-medium">{c.name}</span>
                  <span className="hidden text-gray-500 sm:inline">{c.phone}</span>
                  <span className="w-20 text-right text-xs text-gray-400">{c.last_called_at ? timeAgo(c.last_called_at) : 'never'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DialerCard({ contactId, pipelineId, onLogged }: { contactId: string; pipelineId: string; onLogged: (outcome: string) => void }) {
  const { byId } = useUsers();
  const contactQ = useQuery({ queryKey: ['contact', contactId], queryFn: () => api.get<{ contact: Contact }>(`/contacts/${contactId}`).then((r) => r.contact) });
  const notesQ = useQuery({ queryKey: ['notes', contactId], queryFn: () => api.get<{ notes: Note[] }>(`/contacts/${contactId}/notes`).then((r) => r.notes) });
  const callsQ = useQuery({ queryKey: ['calls', contactId], queryFn: () => api.get<{ calls: Call[] }>(`/contacts/${contactId}/calls`).then((r) => r.calls) });

  const c = contactQ.data;
  if (!c) return <PageLoader />;
  const history = [
    ...(notesQ.data || []).map((n) => ({ at: n.created_at, kind: 'note' as const, n })),
    ...(callsQ.data || []).map((cl) => ({ at: cl.called_at, kind: 'call' as const, cl })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-[1fr_420px] lg:overflow-hidden">
      <div className="space-y-4 p-4 lg:overflow-y-auto lg:p-6">
        <div>
          <Link to={`/contacts/${c.id}`} className="text-2xl font-semibold hover:underline">{c.name}</Link>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
            {(c.city || c.state) && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{[c.city, c.state].filter(Boolean).join(', ')}</span>}
            {c.website && <a href={siteHref(c.website)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-indigo-600"><Globe className="size-3.5" />{prettySite(c.website)}</a>}
            {c.employees && <span>{c.employees} employees</span>}
            {c.est_revenue && <span>{c.est_revenue}</span>}
            {c.owner_id && byId[c.owner_id] && <span className="inline-flex items-center gap-1"><Avatar user={byId[c.owner_id]} size={16} />{byId[c.owner_id].name}</span>}
          </div>
        </div>
        {c.phone ? (
          <a href={telHref(c.phone)} className="flex items-center justify-center gap-3 rounded-xl bg-emerald-600 px-6 py-4 text-xl font-semibold text-white shadow-sm transition hover:bg-emerald-500">
            <Phone className="size-6" /> {c.phone}
          </a>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500">No phone number on file</div>
        )}
        {(c.contact_person || c.contact_title) && (
          <div className="text-sm"><span className="text-gray-500">Ask for:</span> <b>{c.contact_person}</b> {c.contact_title && <span className="text-gray-500">({c.contact_title})</span>}</div>
        )}
        {c.description && <p className="rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-700">{c.description}</p>}
        <div>
          <h3 className="mb-2 text-xs font-semibold text-gray-500 uppercase">History ({c.call_count} calls)</h3>
          <div className="space-y-2">
            {history.map((h) =>
              h.kind === 'note' ? (
                <div key={`n${h.n.id}`} className={clsx('rounded-lg border p-2.5 text-sm', h.n.pinned ? 'border-amber-200 bg-amber-50/50' : 'border-gray-200')}>
                  <div className="mb-1 text-xs text-gray-500"><b className="text-gray-700">{h.n.user_name}</b> · note · {timeAgo(h.n.created_at)}</div>
                  <div className="whitespace-pre-wrap">{h.n.body}</div>
                </div>
              ) : (
                <div key={`c${h.cl.id}`} className="rounded-lg border border-gray-200 p-2.5 text-sm">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Pill color={outcomeOf(h.cl.outcome)?.color}>{outcomeOf(h.cl.outcome)?.label}</Pill>
                    <b className="text-gray-700">{h.cl.user_name}</b> <span title={fmtDateTime(h.cl.called_at)}>{timeAgo(h.cl.called_at)}</span>
                  </div>
                  {h.cl.notes && <div className="mt-1 whitespace-pre-wrap">{h.cl.notes}</div>}
                </div>
              ),
            )}
            {!history.length && <div className="text-sm text-gray-400">First touch — no previous calls or notes.</div>}
          </div>
        </div>
      </div>
      <div className="border-t border-gray-200 bg-gray-50/60 p-4 lg:overflow-y-auto lg:border-t-0 lg:border-l lg:p-6">
        <h3 className="mb-3 text-sm font-semibold">Log this call</h3>
        <CallForm
          contactId={c.id}
          entries={c.entries}
          preferredPipelineId={pipelineId}
          submitLabel="Save & next"
          onDone={onLogged}
        />
        <button onClick={() => onLogged('skipped')} className="mt-3 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
          Skip without logging <ChevronRight className="size-3" />
        </button>
      </div>
    </div>
  );
}
