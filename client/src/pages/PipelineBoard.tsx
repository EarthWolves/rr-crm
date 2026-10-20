import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Columns3, List, Phone, PhoneCall, PhoneOutgoing, Plus, Search, Settings2 } from 'lucide-react';
import { api, qs, type BoardEntry, type Contact } from '../api';
import { usePipelines, useUsers } from '../hooks';
import { fmtDate, isOverdue, outcomeOf, telHref, timeAgo } from '../lib';
import { Avatar, Button, EmptyState, Modal, PageHeader, PageLoader, Pill } from '../components/ui';
import { LogCallModal } from '../components/CallForm';
import { EditStagesModal } from './Pipelines';

export default function PipelineBoard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { pipelines, isLoading } = usePipelines();
  const { users, byId } = useUsers();
  const pipeline = pipelines.find((p) => p.id === id);
  const [view, setView] = useState<'board' | 'table'>(() => (localStorage.getItem('boardView') as 'board' | 'table') || 'board');
  const [owner, setOwner] = useState('');
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

  const boardKey = ['board', id, owner, q];
  const board = useQuery({
    queryKey: boardKey,
    queryFn: () => api.get<{ entries: BoardEntry[] }>(`/pipelines/${id}/board${qs({ owner, q })}`).then((r) => r.entries),
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
                    <div
                      key={e.id}
                      draggable
                      onDragStart={(ev) => { ev.dataTransfer.setData('text/entry', e.id); ev.dataTransfer.effectAllowed = 'move'; }}
                      onClick={() => navigate(`/contacts/${e.contact_id}`)}
                      className="group cursor-pointer rounded-lg border border-gray-200 bg-white p-2.5 shadow-xs transition hover:border-gray-300 hover:shadow-sm active:cursor-grabbing"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{e.name}</div>
                          <div className="truncate text-xs text-gray-500">{[e.city, e.state].filter(Boolean).join(', ') || e.employees || ' '}</div>
                        </div>
                        {e.owner_id && <Avatar user={byId[e.owner_id]} size={18} />}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
                        {e.last_outcome && <Pill color={outcomeOf(e.last_outcome)?.color}>{outcomeOf(e.last_outcome)?.label}</Pill>}
                        {e.call_count > 0 && <span className="inline-flex items-center gap-0.5"><PhoneCall className="size-3" />{e.call_count}</span>}
                        {e.next_follow_up_at && <span className={clsx(isOverdue(e.next_follow_up_at) && 'font-medium text-red-600')}>↻ {fmtDate(e.next_follow_up_at)}</span>}
                        <div className="ml-auto flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                          {e.phone && (
                            <a href={telHref(e.phone)} onClick={(ev) => ev.stopPropagation()} title={e.phone} className="rounded p-1 hover:bg-gray-100"><Phone className="size-3.5" /></a>
                          )}
                          <button title="Log call" onClick={(ev) => { ev.stopPropagation(); setLogFor(e); }} className="rounded p-1 hover:bg-gray-100"><PhoneCall className="size-3.5" /></button>
                        </div>
                      </div>
                    </div>
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
                <th className="th">Calls</th><th className="th">Last outcome</th><th className="th">Last called</th><th className="th">Follow-up</th><th className="th">Location</th><th className="th">In stage since</th>
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
