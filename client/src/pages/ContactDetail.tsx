import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeft, ArrowRight, CalendarClock, CheckSquare, Globe, MessageSquare, MoreHorizontal, Phone, PhoneCall, Pin, Plus, Sparkles, Trash2, X,
} from 'lucide-react';
import { api, type Activity, type Attribute, type Call, type Contact, type Note, type Task } from '../api';
import { useAttributes, useMe, usePipelines, useUsers } from '../hooks';
import { CORE_FIELDS, fmtDate, fmtDateTime, fromLocalInput, isOverdue, outcomeOf, prettySite, siteHref, telHref, timeAgo, toLocalInput } from '../lib';
import { Avatar, Button, EmptyState, Menu, MenuItem, PageLoader, Pill, toast } from '../components/ui';
import { LogCallModal } from '../components/CallForm';
import { TaskRow } from './Tasks';

type Tab = 'activity' | 'notes' | 'calls' | 'tasks';

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('activity');
  const [logging, setLogging] = useState(false);

  const contactQ = useQuery({ queryKey: ['contact', id], queryFn: () => api.get<{ contact: Contact }>(`/contacts/${id}`).then((r) => r.contact) });
  const notesQ = useQuery({ queryKey: ['notes', id], queryFn: () => api.get<{ notes: Note[] }>(`/contacts/${id}/notes`).then((r) => r.notes) });
  const callsQ = useQuery({ queryKey: ['calls', id], queryFn: () => api.get<{ calls: Call[] }>(`/contacts/${id}/calls`).then((r) => r.calls) });
  const tasksQ = useQuery({ queryKey: ['tasks', 'contact', id], queryFn: () => api.get<{ tasks: Task[] }>(`/tasks?assignee=all&contactId=${id}`).then((r) => r.tasks) });
  const timelineQ = useQuery({ queryKey: ['timeline', id], queryFn: () => api.get<{ activity: Activity[] }>(`/contacts/${id}/timeline`).then((r) => r.activity) });

  const del = useMutation({
    mutationFn: () => api.del(`/contacts/${id}`),
    onSuccess: () => {
      toast('Contact deleted');
      navigate('/contacts');
    },
  });

  const c = contactQ.data;
  if (contactQ.isLoading) return <PageLoader />;
  if (!c) return <EmptyState title="Contact not found"><Link className="text-indigo-600" to="/contacts">Back to contacts</Link></EmptyState>;

  const notes = notesQ.data || [];
  const calls = callsQ.data || [];
  const tasks = tasksQ.data || [];

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-gray-200 px-4 py-3 sm:px-6">
          <button onClick={() => navigate(-1)} className="mb-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
            <ArrowLeft className="size-3" /> Back
          </button>
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-lg font-semibold text-white">
              {c.name[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-semibold">{c.name}</h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                {c.phone && <a href={telHref(c.phone)} className="inline-flex items-center gap-1 hover:text-indigo-600"><Phone className="size-3.5" />{c.phone}</a>}
                {c.website && <a href={siteHref(c.website)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-indigo-600"><Globe className="size-3.5" />{prettySite(c.website)}</a>}
                {(c.city || c.state) && <span>{[c.city, c.state].filter(Boolean).join(', ')}</span>}
                <span>{c.call_count} call{c.call_count === 1 ? '' : 's'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {c.phone && (
                <a href={telHref(c.phone)} onClick={() => setTimeout(() => setLogging(true), 300)}>
                  <Button><Phone className="size-3.5" /> Call</Button>
                </a>
              )}
              <Button variant="primary" onClick={() => setLogging(true)}><PhoneCall className="size-3.5" /> Log call</Button>
              <Menu align="right" trigger={<Button variant="ghost"><MoreHorizontal className="size-4" /></Button>}>
                {(close) => (
                  <MenuItem danger onClick={() => { close(); if (confirm(`Delete ${c.name}? This also deletes its calls, notes and tasks.`)) del.mutate(); }}>
                    <Trash2 className="size-4" /> Delete contact
                  </MenuItem>
                )}
              </Menu>
            </div>
          </div>
        </div>

        <div className="flex gap-1 border-b border-gray-200 px-4 sm:px-6">
          {([
            ['activity', 'Activity', null],
            ['notes', 'Notes', notes.length],
            ['calls', 'Calls', calls.length],
            ['tasks', 'Tasks', tasks.filter((t) => !t.done).length],
          ] as const).map(([k, label, n]) => (
            <button key={k} onClick={() => setTab(k)} className={clsx('-mb-px border-b-2 px-2.5 py-2 text-sm', tab === k ? 'border-gray-900 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800')}>
              {label}
              {!!n && <span className="ml-1.5 rounded bg-gray-100 px-1 text-xs text-gray-500">{n}</span>}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {tab === 'activity' && (
            <>
              <NoteComposer contactId={c.id} />
              <Timeline notes={notes} calls={calls} activity={timelineQ.data || []} />
            </>
          )}
          {tab === 'notes' && (
            <>
              <NoteComposer contactId={c.id} />
              <div className="mt-4 space-y-3">
                {notes.map((n) => <NoteCard key={n.id} note={n} />)}
                {!notes.length && <EmptyState icon={<MessageSquare className="size-8" />} title="No notes yet" />}
              </div>
            </>
          )}
          {tab === 'calls' && (
            <div className="space-y-3">
              {calls.map((cl) => <CallCard key={cl.id} call={cl} />)}
              {!calls.length && (
                <EmptyState icon={<PhoneCall className="size-8" />} title="No calls logged">
                  <Button className="mt-2" variant="primary" onClick={() => setLogging(true)}>Log a call</Button>
                </EmptyState>
              )}
            </div>
          )}
          {tab === 'tasks' && <ContactTasks contactId={c.id} tasks={tasks} />}
        </div>
      </div>

      <aside className="w-full shrink-0 overflow-y-auto border-t border-gray-200 bg-gray-50/50 lg:w-96 lg:border-t-0 lg:border-l">
        <PipelinesSection contact={c} />
        <DetailsSection contact={c} />
      </aside>

      <LogCallModal open={logging} onClose={() => setLogging(false)} contactId={c.id} contactName={c.name} entries={c.entries} />
    </div>
  );
}

// ---------------- Sidebar ----------------

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-gray-200 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function PipelinesSection({ contact }: { contact: Contact }) {
  const { pipelines } = usePipelines();
  const move = useMutation({ mutationFn: ({ entryId, stageId }: { entryId: string; stageId: string }) => api.patch(`/entries/${entryId}`, { stageId }) });
  const remove = useMutation({ mutationFn: (entryId: string) => api.del(`/entries/${entryId}`) });
  const add = useMutation({ mutationFn: (pipelineId: string) => api.post(`/pipelines/${pipelineId}/entries`, { contactIds: [contact.id] }) });
  const available = pipelines.filter((p) => !contact.entries.some((e) => e.pipeline_id === p.id));

  return (
    <Section
      title="Pipelines"
      action={
        available.length > 0 && (
          <Menu align="right" trigger={<button className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"><Plus className="size-4" /></button>}>
            {(close) => available.map((p) => <MenuItem key={p.id} onClick={() => { add.mutate(p.id); close(); }}>{p.name}</MenuItem>)}
          </Menu>
        )
      }
    >
      <div className="space-y-2">
        {contact.entries.map((e) => {
          const p = pipelines.find((x) => x.id === e.pipeline_id);
          if (!p) return null;
          const stage = p.stages.find((s) => s.id === e.stage_id);
          return (
            <div key={e.id} className="rounded-lg border border-gray-200 bg-white p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <Link to={`/pipelines/${p.id}`} className="text-sm font-medium hover:underline">{p.name}</Link>
                <button title="Remove from pipeline" onClick={() => remove.mutate(e.id)} className="rounded p-0.5 text-gray-300 hover:text-gray-600"><X className="size-3.5" /></button>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: stage?.color }} />
                <select className="input py-1" value={e.stage_id} onChange={(ev) => move.mutate({ entryId: e.id, stageId: ev.target.value })}>
                  {p.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
          );
        })}
        {!contact.entries.length && <div className="text-sm text-gray-400">Not in any pipeline. {pipelines.length ? 'Use + to add.' : ''}</div>}
      </div>
    </Section>
  );
}

function DetailsSection({ contact }: { contact: Contact }) {
  const { users } = useUsers();
  const { attributes } = useAttributes();
  const update = useMutation({ mutationFn: (patch: Record<string, unknown>) => api.patch(`/contacts/${contact.id}`, patch) });
  const [tagInput, setTagInput] = useState('');

  return (
    <Section title="Details">
      <dl className="space-y-0.5 text-sm">
        <Row label="Owner">
          <select className="w-full rounded px-1.5 py-1 hover:bg-gray-100 focus:bg-white focus:outline-indigo-300" value={contact.owner_id || ''} onChange={(e) => update.mutate({ owner_id: e.target.value || null })}>
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Row>
        <Row label="Follow-up">
          <input
            type="datetime-local"
            className={clsx('w-full rounded px-1.5 py-1 hover:bg-gray-100 focus:bg-white', isOverdue(contact.next_follow_up_at) && 'text-red-600')}
            value={toLocalInput(contact.next_follow_up_at)}
            onChange={(e) => update.mutate({ next_follow_up_at: fromLocalInput(e.target.value) })}
          />
        </Row>
        <Row label="Last outcome">
          <span className="px-1.5 py-1">
            {contact.last_outcome ? <Pill color={outcomeOf(contact.last_outcome)?.color}>{outcomeOf(contact.last_outcome)?.label}</Pill> : <span className="text-gray-400">—</span>}
            {contact.last_called_at && <span className="ml-1.5 text-xs text-gray-400">{timeAgo(contact.last_called_at)}</span>}
          </span>
        </Row>
        <Row label="Tags">
          <div className="flex flex-wrap items-center gap-1 px-1.5 py-1">
            {contact.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-0.5 rounded bg-gray-200/70 px-1.5 py-0.5 text-xs">
                {t}
                <button onClick={() => update.mutate({ tags: contact.tags.filter((x) => x !== t) })} className="text-gray-400 hover:text-gray-700"><X className="size-3" /></button>
              </span>
            ))}
            <input
              className="min-w-16 flex-1 bg-transparent text-xs outline-none"
              placeholder="Add tag…"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  if (!contact.tags.includes(tagInput.trim())) update.mutate({ tags: [...contact.tags, tagInput.trim()] });
                  setTagInput('');
                }
              }}
            />
          </div>
        </Row>
        {CORE_FIELDS.map((f) => (
          <Row key={f.key} label={f.label}>
            <EditableText
              value={(contact as Record<string, any>)[f.key] || ''}
              long={f.long}
              onSave={(v) => {
                if (f.key === 'name' && !v.trim()) return;
                update.mutate({ [f.key]: v || null });
              }}
            />
          </Row>
        ))}
        {attributes.map((a) => (
          <Row key={a.id} label={a.label}>
            <CustomInput attr={a} value={contact.custom?.[a.key]} onSave={(v) => update.mutate({ custom: { [a.key]: v } })} />
          </Row>
        ))}
        <Row label="Created"><span className="px-1.5 py-1 text-gray-500">{fmtDateTime(contact.created_at)}</span></Row>
      </dl>
      <Link to="/settings#fields" className="mt-2 inline-block text-xs text-gray-400 hover:text-gray-700">+ Add a custom field</Link>
    </Section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-2">
      <dt className="truncate py-1 text-gray-500">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function EditableText({ value, onSave, long, type = 'text' }: { value: string; onSave: (v: string) => void; long?: boolean; type?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    setEditing(false);
    if (draft.trim() !== (value || '').trim()) onSave(draft.trim());
  };
  if (!editing) {
    return (
      <div onClick={() => setEditing(true)} className={clsx('min-h-7 cursor-text rounded px-1.5 py-1 break-words hover:bg-gray-100', !value && 'text-gray-300', long && 'line-clamp-6 whitespace-pre-wrap')}>
        {value || 'Empty'}
      </div>
    );
  }
  const props = {
    autoFocus: true,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (!long || e.metaKey || e.ctrlKey)) commit();
      if (e.key === 'Escape') { setDraft(value); setEditing(false); }
    },
    className: 'input',
  };
  return long ? <textarea {...props} rows={6} /> : <input type={type} {...props} />;
}

function CustomInput({ attr, value, onSave }: { attr: Attribute; value: unknown; onSave: (v: unknown) => void }) {
  if (attr.type === 'select') {
    return (
      <select className="w-full rounded px-1.5 py-1 hover:bg-gray-100" value={(value as string) || ''} onChange={(e) => onSave(e.target.value || null)}>
        <option value="">—</option>
        {attr.options.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  }
  if (attr.type === 'checkbox') {
    return <input type="checkbox" className="m-1.5" checked={!!value} onChange={(e) => onSave(e.target.checked)} />;
  }
  if (attr.type === 'date') {
    return <input type="date" className="w-full rounded px-1.5 py-1 hover:bg-gray-100" value={(value as string) || ''} onChange={(e) => onSave(e.target.value || null)} />;
  }
  return (
    <EditableText
      value={value === null || value === undefined ? '' : String(value)}
      type={attr.type === 'number' ? 'number' : 'text'}
      onSave={(v) => onSave(v === '' ? null : attr.type === 'number' ? Number(v) : v)}
    />
  );
}

// ---------------- Notes, calls, timeline ----------------

function NoteComposer({ contactId }: { contactId: string }) {
  const [body, setBody] = useState('');
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const add = useMutation({
    mutationFn: () => api.post(`/contacts/${contactId}/notes`, { body }),
    onSuccess: () => { setBody(''); setFocused(false); ref.current?.blur(); },
  });
  return (
    <div className={clsx('rounded-xl border bg-white transition', focused ? 'border-indigo-300 ring-2 ring-indigo-50' : 'border-gray-200')}>
      <textarea
        ref={ref}
        className="w-full resize-none rounded-xl bg-transparent px-3 py-2.5 text-sm outline-none"
        rows={focused || body ? 4 : 1}
        placeholder="Write a note…"
        value={body}
        onFocus={() => setFocused(true)}
        onBlur={() => !body && setFocused(false)}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && body.trim()) add.mutate();
        }}
      />
      {(focused || body) && (
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-2 py-1.5">
          <span className="mr-auto text-xs text-gray-400">⌘/Ctrl+Enter to save</span>
          <Button size="sm" variant="ghost" onClick={() => { setBody(''); setFocused(false); }}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!body.trim()} loading={add.isPending} onClick={() => add.mutate()}>Save note</Button>
        </div>
      )}
    </div>
  );
}

function NoteCard({ note }: { note: Note }) {
  const { data: me } = useMe();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const update = useMutation({ mutationFn: (patch: Partial<Note>) => api.patch(`/notes/${note.id}`, patch), onSuccess: () => setEditing(false) });
  const del = useMutation({ mutationFn: () => api.del(`/notes/${note.id}`) });
  return (
    <div className={clsx('group rounded-xl border bg-white p-3', note.pinned ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200')}>
      <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-500">
        <Avatar user={note.user_name ? { name: note.user_name, color: note.user_color || '#999' } : null} size={18} />
        <span className="font-medium text-gray-700">{note.user_name || 'Someone'}</span>
        <span title={fmtDateTime(note.created_at)}>{timeAgo(note.created_at)}</span>
        {note.pinned && <Pin className="size-3 text-amber-500" />}
        <div className="ml-auto flex gap-0.5 opacity-0 transition group-hover:opacity-100">
          <button className="rounded px-1.5 py-0.5 hover:bg-gray-100" onClick={() => update.mutate({ pinned: !note.pinned })}>{note.pinned ? 'Unpin' : 'Pin'}</button>
          {(note.user_id === me?.id || me?.role === 'admin') && (
            <>
              <button className="rounded px-1.5 py-0.5 hover:bg-gray-100" onClick={() => setEditing(true)}>Edit</button>
              <button className="rounded px-1.5 py-0.5 text-red-600 hover:bg-red-50" onClick={() => confirm('Delete this note?') && del.mutate()}>Delete</button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea className="input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => { setBody(note.body); setEditing(false); }}>Cancel</Button>
            <Button size="sm" variant="primary" loading={update.isPending} onClick={() => update.mutate({ body })}>Save</Button>
          </div>
        </div>
      ) : (
        <div className="text-sm whitespace-pre-wrap text-gray-800">{note.body}</div>
      )}
    </div>
  );
}

function CallCard({ call }: { call: Call }) {
  const o = outcomeOf(call.outcome);
  const del = useMutation({ mutationFn: () => api.del(`/calls/${call.id}`) });
  return (
    <div className="group rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <PhoneCall className="size-3.5 text-gray-400" />
        <Pill color={o?.color}>{o?.label || call.outcome}</Pill>
        <span>by <span className="font-medium text-gray-700">{call.user_name || 'Someone'}</span></span>
        <span title={fmtDateTime(call.called_at)}>{timeAgo(call.called_at)}</span>
        {call.to_stage_name && (
          <span className="inline-flex items-center gap-1">
            {call.from_stage_name} <ArrowRight className="size-3" /> <span style={{ color: call.to_stage_color || undefined }} className="font-medium">{call.to_stage_name}</span>
          </span>
        )}
        <button className="ml-auto rounded px-1.5 py-0.5 text-red-600 opacity-0 group-hover:opacity-100 hover:bg-red-50" onClick={() => confirm('Delete this call log?') && del.mutate()}>Delete</button>
      </div>
      {call.notes && <div className="mt-2 text-sm whitespace-pre-wrap text-gray-800">{call.notes}</div>}
    </div>
  );
}

type TimelineItem = { at: string; key: string; node: React.ReactNode };

function Timeline({ notes, calls, activity }: { notes: Note[]; calls: Call[]; activity: Activity[] }) {
  const { attributes } = useAttributes();
  const { byId } = useUsers();
  const label = (k: string) =>
    k.startsWith('custom.') ? attributes.find((a) => a.key === k.slice(7))?.label || k.slice(7) : CORE_FIELDS.find((f) => f.key === k)?.label || k.replace(/_/g, ' ');
  const fmtVal = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return 'empty';
    if (k === 'owner_id') return byId[v as string]?.name || 'someone';
    if (k === 'next_follow_up_at') return fmtDateTime(v as string);
    if (Array.isArray(v)) return v.join(', ') || 'none';
    const s = String(v);
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  };

  const items: TimelineItem[] = [
    ...notes.map((n) => ({ at: n.created_at, key: `n${n.id}`, node: <NoteCard note={n} /> })),
    ...calls.map((c) => ({ at: c.called_at, key: `c${c.id}`, node: <CallCard call={c} /> })),
    ...activity
      .filter((a) => a.type !== 'call.logged')
      .map((a) => {
        let text: React.ReactNode = a.type;
        let icon = <Sparkles className="size-3.5" />;
        if (a.type === 'contact.created') text = 'created this contact';
        if (a.type === 'pipeline.added') text = <>added to <b>{a.data.pipeline}</b></>;
        if (a.type === 'pipeline.removed') text = <>removed from <b>{a.data.pipeline}</b></>;
        if (a.type === 'stage.changed') {
          icon = <ArrowRight className="size-3.5" />;
          text = <>moved from <b>{a.data.from}</b> to <b style={{ color: a.data.toColor }}>{a.data.to}</b> in {a.data.pipeline}</>;
        }
        if (a.type === 'contact.updated') {
          const changes = Object.entries(a.data.changes || {}) as [string, { from: unknown; to: unknown }][];
          icon = <CalendarClock className="size-3.5" />;
          text = (
            <>
              {changes.map(([k, v], i) => (
                <span key={k}>
                  {i > 0 && ', '}changed <b>{label(k)}</b> to <span className="text-gray-700">{fmtVal(k, v.to)}</span>
                </span>
              ))}
            </>
          );
        }
        return {
          at: a.created_at,
          key: `a${a.id}`,
          node: (
            <div className="flex items-center gap-2 px-1 text-xs text-gray-500">
              <span className="flex size-5 items-center justify-center rounded-full bg-gray-100 text-gray-400">{icon}</span>
              <span className="font-medium text-gray-700">{a.user_name || 'Someone'}</span>
              <span className="min-w-0">{text}</span>
              <span className="ml-auto shrink-0" title={fmtDateTime(a.created_at)}>{timeAgo(a.created_at)}</span>
            </div>
          ),
        };
      }),
  ].sort((x, y) => y.at.localeCompare(x.at));

  if (!items.length) return <EmptyState title="No activity yet" />;
  return <div className="mt-4 space-y-3">{items.map((i) => <div key={i.key}>{i.node}</div>)}</div>;
}

function ContactTasks({ contactId, tasks }: { contactId: string; tasks: Task[] }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/tasks', { title, contactId, dueAt: fromLocalInput(due) }),
    onSuccess: () => { setTitle(''); setDue(''); },
  });
  return (
    <div>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }}>
        <input className="input min-w-48 flex-1" placeholder="New task, e.g. Email pricing deck" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input type="datetime-local" className="input w-auto" value={due} onChange={(e) => setDue(e.target.value)} />
        <Button variant="primary" type="submit" disabled={!title.trim()} loading={add.isPending}>Add task</Button>
      </form>
      <div className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {tasks.map((t) => <TaskRow key={t.id} task={t} hideContact />)}
        {!tasks.length && <EmptyState icon={<CheckSquare className="size-8" />} title="No tasks" />}
      </div>
      {tasks.some((t) => !t.done && t.due_at) && (
        <p className="mt-2 text-xs text-gray-400">Next due {fmtDate(tasks.filter((t) => !t.done && t.due_at).map((t) => t.due_at!).sort()[0])}</p>
      )}
    </div>
  );
}
