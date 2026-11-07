import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, Columns3, Funnel as FunnelIcon, Phone, Plus, Search, Settings2 } from 'lucide-react';
import { api, type BoardEntry, type Pipeline, type Stage } from '../api';
import { usePipelines } from '../hooks';
import { STAGE_COLORS, outcomeOf, telHref, timeAgo } from '../lib';
import { Button, EmptyState, Field, Modal, PageHeader, PageLoader, Pill } from '../components/ui';
import { EditStagesModal } from './Pipelines';

const WEEK = 7 * 86400 * 1000;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

export default function Funnel() {
  const { pipelines, isLoading } = usePipelines();
  const funnels = pipelines.filter((p) => p.kind === 'funnel');
  const [params, setParams] = useSearchParams();
  const funnel = funnels.find((f) => f.id === params.get('id')) || funnels[0];

  if (isLoading) return <PageLoader />;
  if (!funnel) return <NoFunnel />;
  return (
    <FunnelView
      key={funnel.id}
      funnel={funnel}
      funnels={funnels}
      onPick={(id) => setParams({ id }, { replace: true })}
    />
  );
}

function NoFunnel() {
  const create = useMutation({ mutationFn: () => api.post<{ pipeline: Pipeline }>('/pipelines', { name: 'Sales Funnel', template: 'funnel' }) });
  return (
    <div>
      <PageHeader title="Sales funnel" icon={<FunnelIcon className="size-4" />} />
      <EmptyState icon={<FunnelIcon className="size-10" />} title="No sales funnel yet">
        Track every lead from cold calling to customer: Cold calling → Identifying ICP → Call with them → Design partner / pilot →
        Customer. Leads already on your boards are placed by how far they got, and new leads join automatically.
        <div className="mt-3"><Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>Create sales funnel</Button></div>
      </EmptyState>
    </div>
  );
}

function FunnelView({ funnel, funnels, onPick }: { funnel: Pipeline; funnels: Pipeline[]; onPick: (id: string) => void }) {
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const board = useQuery({
    queryKey: ['board', funnel.id],
    queryFn: () => api.get<{ entries: BoardEntry[] }>(`/pipelines/${funnel.id}/board`).then((r) => r.entries),
  });
  const entries = useMemo(() => board.data || [], [board.data]);

  const steps = funnel.stages.filter((s) => s.kind !== 'lost');
  const lost = funnel.stages.filter((s) => s.kind === 'lost');
  const count = (s: Stage) => s.count;
  const lostTotal = lost.reduce((n, s) => n + count(s), 0);
  const total = funnel.stages.reduce((n, s) => n + count(s), 0);
  // "Reached" = leads at this step or any later one. Everyone entered at the top, including drop-outs.
  const reached = steps.map((_, i) => steps.slice(i).reduce((n, s) => n + count(s), 0) + (i === 0 ? lostTotal : 0));
  const weekAgo = Date.now() - WEEK;
  const newThisWeek = (sid: string) => entries.filter((e) => e.stage_id === sid && new Date(e.stage_changed_at).getTime() > weekAgo).length;
  const won = steps.filter((s) => s.kind === 'won').reduce((n, s) => n + count(s), 0);
  const movedThisWeek = entries.filter((e) => e.stage_id !== funnel.stages[0]?.id && new Date(e.stage_changed_at).getTime() > weekAgo).length;

  // Default to the furthest step that has anyone in it, so the hottest leads show first.
  const furthest = [...steps].reverse().find((s) => s.kind !== 'won' && count(s) > 0) || steps[0];
  const selected = funnel.stages.find((s) => s.id === params.get('stage')) || furthest;
  const select = (sid: string) => {
    const n = new URLSearchParams(params);
    n.set('id', funnel.id);
    n.set('stage', sid);
    setParams(n, { replace: true });
  };

  return (
    <div>
      <PageHeader title={funnel.name} icon={<FunnelIcon className="size-4" />}>
        {funnels.length > 1 && (
          <select className="input w-auto" value={funnel.id} onChange={(e) => onPick(e.target.value)}>
            {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-3.5" /> Add step</Button>
        <Button size="sm" onClick={() => setEditing(true)}><Settings2 className="size-3.5" /> Edit steps</Button>
        <Link to={`/pipelines/${funnel.id}`}><Button size="sm"><Columns3 className="size-3.5" /> Open as board</Button></Link>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
        <Stat label="Leads in funnel" value={total} />
        <Stat label="Got past cold calling" value={reached[1] ?? 0} sub={`${pct(reached[1] ?? 0, reached[0])} of all leads`} />
        <Stat label={steps.find((s) => s.kind === 'won')?.name || 'Won'} value={won} sub={`${pct(won, total)} of all leads`} />
        <Stat label="Moved forward this week" value={movedThisWeek} />
      </div>

      <div className="grid gap-4 px-4 pb-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="card p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Funnel</h2>
            <span className="text-xs text-gray-400">Bar = leads that reached this step or beyond</span>
          </div>
          <div className="space-y-1">
            {steps.map((s, i) => {
              const top = 100 - (i * 64) / Math.max(steps.length, 1);
              const bottom = 100 - ((i + 1) * 64) / Math.max(steps.length, 1);
              const fresh = newThisWeek(s.id);
              return (
                <div key={s.id}>
                  <button
                    onClick={() => select(s.id)}
                    className={clsx('grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-center gap-3 rounded-lg p-1 text-left transition hover:bg-gray-50', selected?.id === s.id && 'bg-indigo-50/60 ring-1 ring-indigo-200')}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{i + 1}. {s.name}</div>
                      <div className="text-xs text-gray-500">{count(s)} here now{fresh > 0 && i > 0 ? ` · ${fresh} new this week` : ''}</div>
                    </div>
                    <div className="relative h-12">
                      <div
                        className="absolute inset-0"
                        style={{
                          background: s.color,
                          opacity: 0.85,
                          clipPath: `polygon(${(100 - top) / 2}% 0, ${(100 + top) / 2}% 0, ${(100 + bottom) / 2}% 100%, ${(100 - bottom) / 2}% 100%)`,
                        }}
                      />
                      <span className="relative flex h-full items-center justify-center text-lg font-semibold text-gray-900">{reached[i]}</span>
                    </div>
                  </button>
                  {i < steps.length - 1 && (
                    <div className="flex items-center gap-1 py-0.5 pl-2 text-xs text-gray-500">
                      <ArrowDown className="size-3" />
                      <span className="font-medium text-gray-700">{pct(reached[i + 1], reached[i])}</span> move on to {steps[i + 1].name}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {lost.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
              {lost.map((s) => (
                <button key={s.id} onClick={() => select(s.id)} className={clsx('rounded-md border px-2 py-1 text-xs', selected?.id === s.id ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50')}>
                  <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: s.color }} />
                  {s.name} <span className="text-gray-400">{count(s)}</span>
                </button>
              ))}
              <span className="self-center text-xs text-gray-400">Dropped out of the funnel</span>
            </div>
          )}
        </div>

        {selected && <StageLeads funnel={funnel} stage={selected} entries={entries} loading={board.isLoading} />}
      </div>

      {editing && <EditStagesModal pipeline={funnel} open onClose={() => setEditing(false)} />}
      {adding && <AddStepModal funnel={funnel} onClose={() => setAdding(false)} />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="truncate text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function StageLeads({ funnel, stage, entries, loading }: { funnel: Pipeline; stage: Stage; entries: BoardEntry[]; loading: boolean }) {
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(100);
  const move = useMutation({ mutationFn: ({ entryId, stageId }: { entryId: string; stageId: string }) => api.patch(`/entries/${entryId}`, { stageId }) });
  const q = search.trim().toLowerCase();
  const list = entries
    .filter((e) => e.stage_id === stage.id)
    .filter((e) => !q || [e.name, e.city, e.state, e.phone].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => new Date(b.stage_changed_at).getTime() - new Date(a.stage_changed_at).getTime());
  return (
    <div className="card flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
        <span className="size-2.5 rounded-full" style={{ background: stage.color }} />
        <h2 className="text-sm font-semibold">{stage.name}</h2>
        <span className="text-xs text-gray-400">{list.length}</span>
        <div className="relative ml-auto w-full sm:w-48">
          <Search className="absolute top-2 left-2.5 size-3.5 text-gray-400" />
          <input className="input pl-8" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {loading ? <PageLoader /> : !list.length ? (
        <EmptyState title={`Nobody in ${stage.name}`}>Move a lead here from its card on a board, its contact page, or the list on another step.</EmptyState>
      ) : (
        <div className="divide-y divide-gray-100">
          {list.slice(0, limit).map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <div className="min-w-0 flex-1">
                <Link to={`/contacts/${e.contact_id}`} className="block truncate text-sm font-medium hover:underline">{e.name}</Link>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
                  {e.phone && <a href={telHref(e.phone)} className="inline-flex items-center gap-1 hover:text-indigo-600"><Phone className="size-3" />{e.phone}</a>}
                  {(e.city || e.state) && <span>{[e.city, e.state].filter(Boolean).join(', ')}</span>}
                  <span>here {timeAgo(e.stage_changed_at)}</span>
                </div>
              </div>
              {e.last_outcome && <Pill color={outcomeOf(e.last_outcome)?.color}>{outcomeOf(e.last_outcome)?.label}</Pill>}
              <select
                className="input w-auto py-1 text-xs"
                value={e.stage_id}
                onChange={(ev) => move.mutate({ entryId: e.id, stageId: ev.target.value })}
                title="Move to step"
              >
                {funnel.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          ))}
          {list.length > limit && (
            <button className="w-full py-2 text-center text-xs text-indigo-600 hover:bg-gray-50" onClick={() => setLimit(limit + 200)}>
              Show more ({list.length - limit} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AddStepModal({ funnel, onClose }: { funnel: Pipeline; onClose: () => void }) {
  const open = funnel.stages.filter((s) => s.kind !== 'lost');
  const [name, setName] = useState('');
  const [after, setAfter] = useState(open[Math.max(open.length - 2, 0)]?.id || '');
  const add = useMutation({
    mutationFn: () => api.post(`/pipelines/${funnel.id}/stages`, {
      name: name.trim(),
      after: after || undefined,
      color: STAGE_COLORS[(funnel.stages.length + 3) % STAGE_COLORS.length],
    }),
    onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} title="Add a step" footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!name.trim()} loading={add.isPending} onClick={() => add.mutate()}>Add step</Button>
      </>
    }>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
        <Field label="Step name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Demo scheduled, Proposal sent" autoFocus /></Field>
        <Field label="Comes after">
          <select className="input" value={after} onChange={(e) => setAfter(e.target.value)}>
            {funnel.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <p className="text-xs text-gray-500">Rename, recolor, reorder or remove steps with Edit steps.</p>
      </form>
    </Modal>
  );
}
