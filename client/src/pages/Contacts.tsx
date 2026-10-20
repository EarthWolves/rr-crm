import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Download, Phone, Plus, Search, Trash2, Upload, Users, X } from 'lucide-react';
import { api, qs, type Contact } from '../api';
import { useAttributes, usePipelines, useUsers } from '../hooks';
import { OUTCOMES, fmtDate, isOverdue, outcomeOf, prettySite, siteHref, telHref, timeAgo } from '../lib';
import { Avatar, Button, EmptyState, Field, Menu, MenuItem, Modal, PageHeader, PageLoader, Pill, toast } from '../components/ui';

const PAGE = 100;

export default function Contacts() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { users, byId } = useUsers();
  const { pipelines, stageById } = usePipelines();
  const { attributes } = useAttributes();
  const [search, setSearch] = useState(params.get('q') || '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(0);

  const f = {
    q: params.get('q') || '',
    owner: params.get('owner') || '',
    pipelineId: params.get('pipelineId') || '',
    stageId: params.get('stageId') || '',
    state: params.get('state') || '',
    outcome: params.get('outcome') || '',
    followUp: params.get('followUp') || '',
    called: params.get('called') || '',
    tag: params.get('tag') || '',
    sort: params.get('sort') || 'name',
    dir: params.get('dir') || 'asc',
  };

  const setF = (patch: Partial<typeof f>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
    setPage(0);
    setSelected(new Set());
  };

  useEffect(() => {
    const id = setTimeout(() => search !== f.q && setF({ q: search }), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = useQuery({
    queryKey: ['contacts', f, page],
    queryFn: () => api.get<{ contacts: Contact[]; total: number }>(`/contacts${qs({ ...f, limit: PAGE, offset: page * PAGE })}`),
    placeholderData: keepPreviousData,
  });
  const facets = useQuery({
    queryKey: ['facets'],
    queryFn: () => api.get<{ states: { value: string; n: number }[]; tags: { value: string; n: number }[] }>('/contacts/facets'),
  });

  const contacts = query.data?.contacts || [];
  const total = query.data?.total || 0;
  const allSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };

  const bulk = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ affected: number }>('/contacts/bulk', { ids: [...selected], ...body }),
    onSuccess: (r, body) => {
      toast(`${body.action === 'delete' ? 'Deleted' : 'Updated'} ${r.affected} contact${r.affected === 1 ? '' : 's'}`);
      setSelected(new Set());
    },
  });

  const activeFilters = ['owner', 'pipelineId', 'state', 'outcome', 'followUp', 'called', 'tag'].filter((k) => f[k as keyof typeof f]).length;
  const selPipeline = pipelines.find((p) => p.id === f.pipelineId);

  const SortTh = ({ k, children, className }: { k: string; children: React.ReactNode; className?: string }) => (
    <th className={clsx('th cursor-pointer select-none hover:text-gray-800', className)} onClick={() => setF({ sort: k, dir: f.sort === k && f.dir === 'asc' ? 'desc' : 'asc' })}>
      <span className="inline-flex items-center gap-1">
        {children}
        {f.sort === k && (f.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </span>
    </th>
  );

  const exportUrl = useMemo(() => `/api/contacts/export.csv${qs({ ...f, sort: undefined, dir: undefined })}`, [f]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Contacts" icon={<Users className="size-4" />}>
        <a href={exportUrl}>
          <Button size="sm">
            <Download className="size-3.5" /> Export
          </Button>
        </a>
        <Link to="/import">
          <Button size="sm">
            <Upload className="size-3.5" /> Import
          </Button>
        </Link>
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" /> New contact
        </Button>
      </PageHeader>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-2 left-2.5 size-3.5 text-gray-400" />
          <input className="input pl-8" placeholder="Search name, phone, city, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={f.owner} onChange={(e) => setF({ owner: e.target.value })}>
          <option value="">Any owner</option>
          <option value="none">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={f.pipelineId} onChange={(e) => setF({ pipelineId: e.target.value, stageId: '' })}>
          <option value="">Any pipeline</option>
          <option value="none">Not in a pipeline</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {selPipeline && (
          <select className="input w-auto" value={f.stageId} onChange={(e) => setF({ stageId: e.target.value })}>
            <option value="">Any stage</option>
            {selPipeline.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.count})
              </option>
            ))}
          </select>
        )}
        <select className="input w-auto" value={f.state} onChange={(e) => setF({ state: e.target.value })}>
          <option value="">Any state</option>
          {facets.data?.states.map((s) => (
            <option key={s.value} value={s.value}>
              {s.value} ({s.n})
            </option>
          ))}
        </select>
        <select className="input w-auto" value={f.outcome} onChange={(e) => setF({ outcome: e.target.value })}>
          <option value="">Any last outcome</option>
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={f.called || f.followUp} onChange={(e) => {
          const v = e.target.value;
          setF({ called: v === 'never' || v === 'yes' ? v : '', followUp: v === 'due' || v === 'upcoming' ? v : '' });
        }}>
          <option value="">Any call status</option>
          <option value="never">Never called</option>
          <option value="yes">Called at least once</option>
          <option value="due">Follow-up due</option>
          <option value="upcoming">Follow-up scheduled</option>
        </select>
        {!!facets.data?.tags.length && (
          <select className="input w-auto" value={f.tag} onChange={(e) => setF({ tag: e.target.value })}>
            <option value="">Any tag</option>
            {facets.data.tags.map((t) => (
              <option key={t.value} value={t.value}>
                {t.value} ({t.n})
              </option>
            ))}
          </select>
        )}
        {(activeFilters > 0 || f.q) && (
          <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }); }}>
            <X className="size-3.5" /> Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-gray-500">{total.toLocaleString()} contacts</span>
      </div>

      {selected.size > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50 px-4 py-1.5 text-sm">
          <span className="font-medium text-indigo-900">{selected.size} selected</span>
          <Menu trigger={<Button size="sm">Assign owner</Button>}>
            {(close) => (
              <>
                {users.map((u) => (
                  <MenuItem key={u.id} onClick={() => { bulk.mutate({ action: 'assign', ownerId: u.id }); close(); }}>
                    <Avatar user={u} size={18} /> {u.name}
                  </MenuItem>
                ))}
                <MenuItem onClick={() => { bulk.mutate({ action: 'assign', ownerId: null }); close(); }}>Unassign</MenuItem>
              </>
            )}
          </Menu>
          <Menu trigger={<Button size="sm">Add to pipeline</Button>}>
            {(close) =>
              pipelines.length ? (
                pipelines.map((p) => (
                  <MenuItem key={p.id} onClick={() => { bulk.mutate({ action: 'addToPipeline', pipelineId: p.id }); close(); }}>
                    {p.name}
                  </MenuItem>
                ))
              ) : (
                <div className="px-2 py-1.5 text-sm text-gray-500">Create a pipeline first</div>
              )
            }
          </Menu>
          {selPipeline && (
            <Button size="sm" onClick={() => bulk.mutate({ action: 'removeFromPipeline', pipelineId: selPipeline.id })}>
              Remove from {selPipeline.name}
            </Button>
          )}
          <Button size="sm" onClick={() => {
            const tag = prompt('Tag to add');
            if (tag?.trim()) bulk.mutate({ action: 'addTag', tag: tag.trim() });
          }}>
            Add tag
          </Button>
          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => {
            if (confirm(`Delete ${selected.size} contacts? Their calls and notes will be deleted too.`)) bulk.mutate({ action: 'delete' });
          }}>
            <Trash2 className="size-3.5" /> Delete
          </Button>
          <button className="ml-auto text-xs text-indigo-700 hover:underline" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {query.isLoading ? (
          <PageLoader />
        ) : !contacts.length ? (
          <EmptyState icon={<Users className="size-10" />} title={f.q || activeFilters ? 'No contacts match' : 'No contacts yet'}>
            {!(f.q || activeFilters) && (
              <>
                <Link to="/import" className="text-indigo-600 hover:underline">Import a spreadsheet</Link> or add contacts one by one.
              </>
            )}
          </EmptyState>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="th sticky left-0 z-20 w-8">
                  <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(contacts.map((c) => c.id)))} />
                </th>
                <SortTh k="name" className="sticky left-8 z-20 min-w-56">Name</SortTh>
                <th className="th">Phone</th>
                <th className="th">Stage</th>
                <th className="th">Owner</th>
                <SortTh k="call_count">Calls</SortTh>
                <th className="th">Last outcome</th>
                <SortTh k="last_called_at">Last called</SortTh>
                <SortTh k="next_follow_up_at">Follow-up</SortTh>
                <th className="th">Website</th>
                <SortTh k="city">City</SortTh>
                <SortTh k="state">State</SortTh>
                <SortTh k="employees">Employees</SortTh>
                <SortTh k="est_revenue">Est. revenue</SortTh>
                <th className="th">Tags</th>
                {attributes.map((a) => (
                  <th key={a.id} className="th">{a.label}</th>
                ))}
                <SortTh k="created_at">Created</SortTh>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const outcome = outcomeOf(c.last_outcome);
                return (
                  <tr key={c.id} className="group cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/contacts/${c.id}`)}>
                    <td className="td sticky left-0 bg-white group-hover:bg-gray-50" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                    </td>
                    <td className="td sticky left-8 max-w-72 truncate bg-white font-medium group-hover:bg-gray-50">{c.name}</td>
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      {c.phone && (
                        <a href={telHref(c.phone)} className="inline-flex items-center gap-1 text-gray-700 hover:text-indigo-600">
                          <Phone className="size-3" /> {c.phone}
                        </a>
                      )}
                    </td>
                    <td className="td">
                      <div className="flex max-w-64 gap-1">
                        {c.entries.map((e) => {
                          const s = stageById[e.stage_id];
                          return s ? <Pill key={e.id} color={s.color}>{s.name}</Pill> : null;
                        })}
                      </div>
                    </td>
                    <td className="td">
                      {c.owner_id && byId[c.owner_id] && (
                        <span className="inline-flex items-center gap-1.5"><Avatar user={byId[c.owner_id]} size={18} />{byId[c.owner_id].name}</span>
                      )}
                    </td>
                    <td className="td text-right tabular-nums">{c.call_count || ''}</td>
                    <td className="td">{outcome && <Pill color={outcome.color}>{outcome.label}</Pill>}</td>
                    <td className="td text-gray-500">{timeAgo(c.last_called_at)}</td>
                    <td className={clsx('td', isOverdue(c.next_follow_up_at) ? 'font-medium text-red-600' : 'text-gray-500')}>{fmtDate(c.next_follow_up_at)}</td>
                    <td className="td max-w-48 truncate" onClick={(e) => e.stopPropagation()}>
                      {c.website && <a href={siteHref(c.website)} target="_blank" rel="noreferrer" className="text-gray-600 hover:text-indigo-600 hover:underline">{prettySite(c.website)}</a>}
                    </td>
                    <td className="td">{c.city}</td>
                    <td className="td">{c.state}</td>
                    <td className="td">{c.employees}</td>
                    <td className="td">{c.est_revenue}</td>
                    <td className="td">
                      <div className="flex gap-1">{c.tags.map((t) => <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{t}</span>)}</div>
                    </td>
                    {attributes.map((a) => (
                      <td key={a.id} className="td max-w-56 truncate">{formatCustom(c.custom?.[a.key])}</td>
                    ))}
                    <td className="td text-gray-500">{fmtDate(c.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {total > PAGE && (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-200 px-4 py-2 text-xs text-gray-500">
          {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
          <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      <NewContactModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

export function formatCustom(v: unknown) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

function NewContactModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { pipelines } = usePipelines();
  const [form, setForm] = useState({ name: '', phone: '', website: '', email: '', contact_person: '', city: '', state: '' });
  const [pipelineId, setPipelineId] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const { contact } = await api.post<{ contact: Contact }>('/contacts', form);
      if (pipelineId) await api.post(`/pipelines/${pipelineId}/entries`, { contactIds: [contact.id] });
      return contact;
    },
    onSuccess: (c) => {
      onClose();
      setForm({ name: '', phone: '', website: '', email: '', contact_person: '', city: '', state: '' });
      navigate(`/contacts/${c.id}`);
    },
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New contact"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!form.name.trim()} loading={create.isPending} onClick={() => create.mutate()}>Create</Button>
        </>
      }
    >
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) create.mutate(); }}>
        <div className="sm:col-span-2"><Field label="Company / name"><input className="input" value={form.name} onChange={set('name')} autoFocus /></Field></div>
        <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Website"><input className="input" value={form.website} onChange={set('website')} /></Field>
        <Field label="Contact person"><input className="input" value={form.contact_person} onChange={set('contact_person')} /></Field>
        <Field label="Email"><input className="input" value={form.email} onChange={set('email')} /></Field>
        <Field label="City"><input className="input" value={form.city} onChange={set('city')} /></Field>
        <Field label="State"><input className="input" value={form.state} onChange={set('state')} /></Field>
        <div className="sm:col-span-2">
          <Field label="Add to pipeline">
            <select className="input" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
              <option value="">None</option>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
