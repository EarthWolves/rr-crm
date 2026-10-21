import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Pin, Plus, X } from 'lucide-react';
import { api, type Note } from '../api';
import { useMe } from '../hooks';
import { fmtDateTime, timeAgo } from '../lib';
import { Avatar, Button, Menu, MenuItem } from './ui';

export function NoteComposer({ contactId }: { contactId: string }) {
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

export function NoteCard({ note }: { note: Note }) {
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


export function useTradeOptions() {
  const q = useQuery({
    queryKey: ['facets'],
    queryFn: () => api.get<{ states: { value: string; n: number }[]; tags: { value: string; n: number }[]; trades: { value: string; n: number }[]; tradeOptions: string[] }>('/contacts/facets'),
  });
  return q.data;
}

export function TradesEditor({ trades, onChange }: { trades: string[]; onChange: (t: string[]) => void }) {
  const facets = useTradeOptions();
  const options = (facets?.tradeOptions || []).filter((t) => !trades.includes(t));
  return (
    <div className="flex flex-wrap items-center gap-1 px-1.5 py-1">
      {trades.map((t) => (
        <span key={t} className="inline-flex items-center gap-0.5 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">
          {t}
          <button onClick={() => onChange(trades.filter((x) => x !== t))} className="text-sky-500 hover:text-sky-900"><X className="size-3" /></button>
        </span>
      ))}
      <Menu trigger={<button className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Plus className="size-3" /> Trade</button>}>
        {(close) => options.map((t) => <MenuItem key={t} onClick={() => { onChange([...trades, t]); close(); }}>{t}</MenuItem>)}
      </Menu>
    </div>
  );
}
