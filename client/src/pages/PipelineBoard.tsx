import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Columns3, Globe, List, MessageSquare, Phone, PhoneCall, PhoneOutgoing, Plus, Search, Settings2 } from 'lucide-react';
import { api, qs, type BoardEntry, type Contact, type User } from '../api';
import { usePipelines, useUsers } from '../hooks';
import { fmtDate, isOverdue, outcomeOf, prettySite, siteHref, telHref, timeAgo } from '../lib';
import { Avatar, Button, EmptyState, Modal, PageHeader, PageLoader, Pill } from '../components/ui';
import { LogCallModal } from '../components/CallForm';
import { EditStagesModal } from './Pipelines';
import { useTradeOptions } from '../components/Notes';

export default function PipelineBoard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { pipelines, isLoading } = usePipelines();
  const { users, byId } = useUsers();
  const pipeline = pipelines.find((p) => p.id === id);
  const [view, setView] = useState<'board' | 'table'>(() => (localStorage.getItem('boardView') as 'board' | 'table') || 'board');
  const [owner, setOwner] = useState('');
  const [state, setState] = useState('');
  const [trade, setTrade] = useState('');
  const facets = useTradeOptions();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [logFor, setLogFor] = useState<BoardEntry | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    try { localStorage.setItem('boardView', view); } catch { /* storage unavailable */ }
  }, [view]);

  const boardKey = ['board', id, owner, q, state, trade];
  const board = useQuery({
    queryKey: boardKey,
    queryFn: () => api.get<{ entries: BoardEntry[] }>(`/pipelines/${id}/board${qs({ owner, q, state, trade })}`).then((r) => r.entries),
    enabled: !!id,
  });

  const move = useMutation({
    mutationFn: ({ entryId, stageId }: { entryId: string; stageId: string }) => api.patch(`/entries/${entryId}`, { stageId, position: Date.now() / 1000 }),
    onMutate: async ({ entryId, stageId }) => {
      // Optimistic update so cards don't snap back while the request is in flight.
      await qc.cancelQueries({ queryKey: boardKey });
      qc.setQueryData<BoardEntry[]>(boardKey, (old) => old?.map((e) => (e.id === entryId ? { ...e, stage_id: stageId } : e)));
    },
  });

  if (isLoading) return <PageLoader />;
  if (!pipeline) return <EmptyState title="Pipeline not found"><Link to="/pipelines" className="text-indigo-600">All pipelines</Link></EmptyState>;

  const entries = board.data || [];
  const byStage = (sid: string) => entries.filter((e) => e.stage_id === sid);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={pipeline.name} icon={<Columns3 className="size-4" />}>
        <div className="flex rounded-md border border-gray-200 p-0.5">
          <button onClick={() => setView('board')} className={clsx('rounded px-2 py-1 text-xs', view === 'board' ? 'bg-gray-100 font-medium' : 'text-gray-500')}><Columns3 className="inline size-3.5" /> Board</button>
          <button onClick={() => setView('table')} className={clsx('rounded px-2 py-1 text-xs', view === 'table' ? 'bg-gray-100 font-medium' : 'text-gray-500')}><List className="inline size-3.5" /> Table</button>
        </div>
        <Button size="sm" onClick={() => setEditing(true)}><Settings2 className="size-3.5" /> Edit stages</Button>
        <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-3.5" /> Add records</Button>
        <Button size="sm" variant="primary" onClick={() => navigate(`/dialer?pipelineId=${pipeline.id}`)}><PhoneOutgoing className="size-3.5" /> Start calling</Button>
      </PageHeader>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2">
        <div className="relative w-full sm:w-56">
          <Search className="absolute top-2 left-2.5 size-3.5 text-gray-400" />
          <input className="input pl-8" placeholder="Filter cards…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Any owner</option>
          <option value="none">Unassigned</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="input w-auto" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">Any state</option>
          {facets?.states.map((s) => <option key={s.value} value={s.value}>{s.value} ({s.n})</option>)}
        </select>
        <select className="input w-auto" value={trade} onChange={(e) => setTrade(e.target.value)}>
          <option value="">Any trade</option>
          {facets?.trades.map((t) => <option key={t.value} value={t.value}>{t.value} ({t.n})</option>)}
          <option value="none">No trade set</option>
        </select>
        <span className="ml-auto text-xs text-gray-500">{entries.length} records</span>
      </div>

      {board.isLoading ? <PageLoader /> : view === 'board' ? (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto bg-gray-50/60 p-3">
          {pipeline.stages.map((s) => {
            const list = byStage(s.id);
            return (
              <div
                key={s.id}
                className={clsx('flex w-72 shrink-0 flex-col rounded-xl border bg-gray-100/60 transition', dragOver === s.id ? 'border-indigo-300 bg-indigo-50/60' : 'border-transparent')}
                onDragOver={(e) => { e.preventDefault(); setDragOver(s.id); }}
                onDragLeave={() => setDragOver((d) => (d === s.id ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const entryId = e.dataTransfer.getData('text/entry');
                  const entry = entries.find((x) => x.id === entryId);
                  if (entry && entry.stage_id !== s.id) move.mutate({ entryId, stageId: s.id });
                }}
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="truncate text-sm font-medium">{s.name}</span>
                  <span className="text-xs text-gray-400">{list.length}</span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                  {list.map((e) => (
                    <BoardCard
                      key={e.id}
                      e={e}
                      users={users}
                      onOpen={() => navigate(`/contacts/${e.contact_id}`)}
                      onLogCall={() => setLogFor(e)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="th">Name</th><th className="th">Stage</th><th className="th">Phone</th><th className="th">Owner</th>
                <th className="th">Trade</th><th className="th">Calls</th><th className="th">Last outcome</th><th className="th">Last called</th><th className="th">Follow-up</th><th className="th">Location</th><th className="th">In stage since</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="td font-medium"><Link to={`/contacts/${e.contact_id}`} className="hover:underline">{e.name}</Link></td>
                  <td className="td">
                    <select className="rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-gray-200" value={e.stage_id} onChange={(ev) => move.mutate({ entryId: e.id, stageId: ev.target.value })}>
                      {pipeline.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  <td className="td">{e.phone && <a href={telHref(e.phone)} className="hover:text-indigo-600">{e.phone}</a>}</td>
                  <td className="td">{e.owner_id && byId[e.owner_id]?.name}</td>
                  <td className="td text-xs text-gray-600">{e.trades.join(', ')}</td>
                  <td className="td text-right">{e.call_count || ''}</td>
                  <td className="td">{e.last_outcome && <Pill color={outcomeOf(e.last_outcome)?.color}>{outcomeOf(e.last_outcome)?.label}</Pill>}</td>
                  <td className="td text-gray-500">{timeAgo(e.last_called_at)}</td>
                  <td className={clsx('td', isOverdue(e.next_follow_up_at) ? 'text-red-600' : 'text-gray-500')}>{fmtDate(e.next_follow_up_at)}</td>
                  <td className="td">{[e.city, e.state].filter(Boolean).join(', ')}</td>
                  <td className="td text-gray-500">{timeAgo(e.stage_changed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && <EmptyState title="No records in this pipeline" />}
        </div>
      )}

      {editing && <EditStagesModal pipeline={pipeline} open onClose={() => setEditing(false)} />}
      <AddRecordsModal open={adding} onClose={() => setAdding(false)} pipelineId={pipeline.id} stages={pipeline.stages} />
      {logFor && (
        <LogCallModal
          open
          onClose={() => setLogFor(null)}
          contactId={logFor.contact_id}
          contactName={logFor.name}
          entries={[{ id: logFor.id, pipeline_id: pipeline.id, stage_id: logFor.stage_id }]}
          preferredPipelineId={pipeline.id}
        />
      )}
    </div>
  );
}

function AddRecordsModal({ open, onClose, pipelineId, stages }: { open: boolean; onClose: () => void; pipelineId: string; stages: { id: string; name: string }[] }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stageId, setStageId] = useState('');
  const list = useQuery({
    queryKey: ['contacts', 'not-in', pipelineId, search],
    queryFn: () => api.get<{ contacts: Contact[]; total: number }>(`/contacts${qs({ q: search, limit: 200, sort: 'name', dir: 'asc' })}`),
    enabled: open,
  });
  const candidates = (list.data?.contacts || []).filter((c) => !c.entries.some((e) => e.pipeline_id === pipelineId));
  const add = useMutation({
    mutationFn: () => api.post(`/pipelines/${pipelineId}/entries`, { contactIds: [...selected], stageId: stageId || undefined }),
    onSuccess: () => { setSelected(new Set()); onClose(); },
  });
  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };
  return (
    <Modal open={open} onClose={onClose} title="Add records to pipeline" width="max-w-xl" footer={
      <>
        <select className="input mr-auto w-auto" value={stageId} onChange={(e) => setStageId(e.target.value)}>
          {stages.map((s, i) => <option key={s.id} value={i === 0 ? '' : s.id}>Into: {s.name}</option>)}
        </select>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!selected.size} loading={add.isPending} onClick={() => add.mutate()}>Add {selected.size || ''}</Button>
      </>
    }>
      <input className="input mb-3" placeholder="Search contacts…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
      <div className="mb-2 flex justify-between text-xs text-gray-500">
        <span>{candidates.length} not yet in this pipeline</span>
        <button className="text-indigo-600 hover:underline" onClick={() => setSelected(new Set(candidates.map((c) => c.id)))}>Select all shown</button>
      </div>
      <div className="max-h-80 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
        {candidates.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
            <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
            <span className="flex-1 truncate text-sm">{c.name}</span>
            <span className="text-xs text-gray-400">{[c.city, c.state].filter(Boolean).join(', ')}</span>
          </label>
        ))}
        {!candidates.length && <div className="p-4 text-center text-sm text-gray-400">No contacts to add</div>}
      </div>
    </Modal>
  );
}

function BoardCard({ e, users, onOpen, onLogCall }: {
  e: BoardEntry;
  users: User[];
  onOpen: () => void;
  onLogCall: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const setOwner = useMutation({ mutationFn: (ownerId: string | null) => api.patch(`/contacts/${e.contact_id}`, { owner_id: ownerId }) });
  const addNote = useMutation({
    mutationFn: () => api.post(`/contacts/${e.contact_id}/notes`, { body: draft.trim() }),
    onSuccess: () => setDraft(''),
  });
  const owner = users.find((u) => u.id === e.owner_id);
  const stop = (ev: React.SyntheticEvent) => ev.stopPropagation();
  const save = () => draft.trim() && !addNote.isPending && addNote.mutate();
  return (
    <div
      // Dragging is switched off while typing so selecting text in the note box doesn't pick up the card.
      draggable={!typing}
      onDragStart={(ev) => { ev.dataTransfer.setData('text/entry', e.id); ev.dataTransfer.effectAllowed = 'move'; }}
      onClick={onOpen}
      className="cursor-pointer rounded-lg border border-gray-200 bg-white p-2.5 shadow-xs transition hover:border-gray-300 hover:shadow-sm active:cursor-grabbing"
    >
      <div className="truncate text-sm font-medium">{e.name}</div>
      <div className="truncate text-xs text-gray-500">{[e.city, e.state].filter(Boolean).join(', ') || e.employees || '\u00a0'}</div>
      {e.trades.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {e.trades.slice(0, 3).map((t) => <span key={t} className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-800">{t}</span>)}
        </div>
      )}
      {e.phone ? (
        <a href={telHref(e.phone)} onClick={stop} className="mt-2 flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
          <Phone className="size-3.5" /> {e.phone}
        </a>
      ) : (
        <div className="mt-2 rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-400">No phone number</div>
      )}
      {e.website && (
        <a
          href={siteHref(e.website)}
          target="_blank"
          rel="noreferrer"
          onClick={stop}
          className="mt-1 flex items-center gap-1.5 truncate px-2 py-0.5 text-xs text-indigo-600 hover:underline"
        >
          <Globe className="size-3 shrink-0" />
          <span className="truncate">{prettySite(e.website)}</span>
        </a>
      )}
      {(e.last_outcome || e.call_count > 0 || e.next_follow_up_at) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
          {e.last_outcome && <Pill color={outcomeOf(e.last_outcome)?.color}>{outcomeOf(e.last_outcome)?.label}</Pill>}
          {e.call_count > 0 && <span className="inline-flex items-center gap-0.5"><PhoneCall className="size-3" />{e.call_count}</span>}
          {e.next_follow_up_at && <span className={clsx(isOverdue(e.next_follow_up_at) && 'font-medium text-red-600')}>↻ {fmtDate(e.next_follow_up_at)}</span>}
        </div>
      )}

      {/* Notes: fixed-size boxes so nothing moves while you type. */}
      <div className="mt-2 cursor-default" onClick={stop}>
        <div className="flex items-center justify-between text-[11px] font-medium text-gray-400">
          <span className="inline-flex items-center gap-1"><MessageSquare className="size-3" /> Latest note</span>
          {e.note_count > 1 && <span>{e.note_count} notes</span>}
        </div>
        <div className="mt-0.5 h-9 overflow-hidden rounded-md bg-amber-50/70 px-2 py-1 text-xs leading-[14px] text-gray-700">
          <span className="line-clamp-2">{e.last_note || <span className="text-gray-400">No notes yet</span>}</span>
        </div>
        <textarea
          className="mt-1.5 block h-16 w-full resize-none rounded-md border border-gray-200 px-2 py-1 text-xs outline-none placeholder:text-gray-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
          placeholder="Write a note…"
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          onKeyDown={(ev) => {
            if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') save();
          }}
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] text-gray-400">⌘/Ctrl+Enter to save</span>
          <button
            onClick={save}
            disabled={!draft.trim() || addNote.isPending}
            className="rounded bg-gray-900 px-2 py-0.5 text-[11px] font-medium text-white disabled:bg-gray-200 disabled:text-gray-400"
          >
            {addNote.isPending ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1 border-t border-gray-100 pt-2" onClick={stop}>
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-gray-100" title="Owner">
          <Avatar user={owner} size={18} />
          <select
            className="min-w-0 flex-1 cursor-pointer appearance-none truncate bg-transparent text-xs text-gray-700 outline-none"
            value={e.owner_id || ''}
            onChange={(ev) => setOwner.mutate(ev.target.value || null)}
          >
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <button onClick={onLogCall} title="Log call" className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800">
          <PhoneCall className="size-3.5" /> Log call
        </button>
      </div>
    </div>
  );
}
