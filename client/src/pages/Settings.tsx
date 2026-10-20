import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, RefreshCw, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { api, type User } from '../api';
import { useAttributes, useMe, useUsers } from '../hooks';
import { Avatar, Button, Field, PageHeader, toast } from '../components/ui';

const TYPES = [
  ['text', 'Text'], ['number', 'Number'], ['select', 'Dropdown'], ['url', 'URL'], ['phone', 'Phone'], ['email', 'Email'], ['date', 'Date'], ['checkbox', 'Checkbox'],
];

export default function Settings() {
  useEffect(() => {
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  }, []);
  return (
    <div>
      <PageHeader title="Settings" icon={<SettingsIcon className="size-4" />} />
      <div className="mx-auto max-w-3xl space-y-6 p-4">
        <Profile />
        <Team />
        <Fields />
      </div>
    </div>
  );
}

function Card({ id, title, desc, children }: { id?: string; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card p-5">
      <h2 className="font-semibold">{title}</h2>
      {desc && <p className="mt-0.5 text-sm text-gray-500">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Profile() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [name, setName] = useState(me?.name || '');
  const [color, setColor] = useState(me?.color || '#6366f1');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const save = useMutation({
    mutationFn: () => api.patch<{ user: User }>(`/users/${me!.id}`, { name, color }),
    onSuccess: ({ user }) => { qc.setQueryData(['me'], user); toast('Profile saved'); },
  });
  const changePw = useMutation({
    mutationFn: () => api.post('/auth/password', pw),
    onSuccess: () => { setPw({ currentPassword: '', newPassword: '' }); toast('Password changed'); },
  });
  return (
    <Card title="Your profile">
      <div className="flex flex-wrap items-end gap-3">
        <Avatar user={{ name: name || '?', color }} size={36} />
        <div className="min-w-48 flex-1"><Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
        <Field label="Color"><input type="color" className="h-8 w-12 cursor-pointer rounded border border-gray-200 p-0.5" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
      <div className="mt-2 text-xs text-gray-500">{me?.email} · {me?.role}</div>
      <form className="mt-5 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4" onSubmit={(e) => { e.preventDefault(); changePw.mutate(); }}>
        <div className="min-w-40 flex-1"><Field label="Current password"><input type="password" className="input" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field></div>
        <div className="min-w-40 flex-1"><Field label="New password"><input type="password" minLength={8} className="input" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field></div>
        <Button type="submit" disabled={!pw.currentPassword || pw.newPassword.length < 8} loading={changePw.isPending}>Change password</Button>
      </form>
    </Card>
  );
}

function Team() {
  const { data: me } = useMe();
  const { users } = useUsers();
  const isAdmin = me?.role === 'admin';
  const invite = useQuery({ queryKey: ['invite'], queryFn: () => api.get<{ code: string }>('/workspace/invite').then((r) => r.code) });
  const regen = useMutation({ mutationFn: () => api.post('/workspace/invite/regenerate') });
  const setRole = useMutation({ mutationFn: ({ id, role }: { id: string; role: string }) => api.patch(`/users/${id}`, { role }) });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/users/${id}`) });
  const link = `${location.origin}`;
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast('Copied'));

  return (
    <Card id="team" title="Team" desc="Everyone in the workspace sees the same contacts, pipelines, calls and notes.">
      <div className="mb-4 rounded-lg bg-indigo-50 p-3">
        <div className="text-sm font-medium text-indigo-900">Invite your friends</div>
        <p className="mt-0.5 text-xs text-indigo-800">Send them this link and invite code. They click “Join with an invite code” on the sign-in page.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="rounded bg-white px-2 py-1 text-sm">{link}</code>
          <code className="rounded bg-white px-2 py-1 text-sm font-semibold">{invite.data || '…'}</code>
          <Button size="sm" onClick={() => copy(`Join our CRM: ${link}\nInvite code: ${invite.data}`)}><Copy className="size-3.5" /> Copy invite</Button>
          {isAdmin && <Button size="sm" variant="ghost" onClick={() => confirm('Generate a new code? The old one will stop working.') && regen.mutate()}><RefreshCw className="size-3.5" /> New code</Button>}
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 py-2">
            <Avatar user={u} size={28} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{u.name} {u.id === me?.id && <span className="text-gray-400">(you)</span>}</div>
              <div className="text-xs text-gray-500">{u.email}</div>
            </div>
            {isAdmin && u.id !== me?.id ? (
              <>
                <select className="input w-auto" value={u.role} onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value })}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="rounded p-1 text-gray-300 hover:text-red-600" onClick={() => confirm(`Remove ${u.name}? Their calls and notes stay.`) && remove.mutate(u.id)}><Trash2 className="size-4" /></button>
              </>
            ) : (
              <span className="text-xs text-gray-500 capitalize">{u.role}</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Fields() {
  const { attributes } = useAttributes();
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const [options, setOptions] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/attributes', { label, type, options: type === 'select' ? options.split(',').map((o) => o.trim()).filter(Boolean) : [] }),
    onSuccess: () => { setLabel(''); setOptions(''); toast('Field added'); },
  });
  const update = useMutation({ mutationFn: ({ id, ...patch }: { id: string; label?: string; options?: string[] }) => api.patch(`/attributes/${id}`, patch) });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/attributes/${id}`) });

  return (
    <Card id="fields" title="Custom fields" desc="Add your own columns to every contact — e.g. Decision maker, Current vendor, Lead source.">
      <div className="space-y-2">
        {attributes.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2">
            <input className="input min-w-40 flex-1" defaultValue={a.label} onBlur={(e) => e.target.value.trim() && e.target.value !== a.label && update.mutate({ id: a.id, label: e.target.value.trim() })} />
            <span className="w-24 text-xs text-gray-500">{TYPES.find((t) => t[0] === a.type)?.[1]}</span>
            {a.type === 'select' && (
              <input className="input min-w-40 flex-1" defaultValue={a.options.join(', ')} placeholder="Options, comma separated" onBlur={(e) => update.mutate({ id: a.id, options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })} />
            )}
            <button className="rounded p-1 text-gray-300 hover:text-red-600" onClick={() => confirm(`Delete field "${a.label}" and its data on every contact?`) && del.mutate(a.id)}><Trash2 className="size-4" /></button>
          </div>
        ))}
        {!attributes.length && <div className="text-sm text-gray-400">No custom fields yet.</div>}
      </div>
      <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-4" onSubmit={(e) => { e.preventDefault(); if (label.trim()) add.mutate(); }}>
        <div className="min-w-40 flex-1"><Field label="Field name"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Decision maker" /></Field></div>
        <Field label="Type">
          <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {type === 'select' && <div className="min-w-40 flex-1"><Field label="Options"><input className="input" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Hot, Warm, Cold" /></Field></div>}
        <Button type="submit" variant="primary" disabled={!label.trim()} loading={add.isPending}>Add field</Button>
      </form>
    </Card>
  );
}
