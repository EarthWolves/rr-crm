import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, PhoneCall } from 'lucide-react';
import { api, qs, type Call } from '../api';
import { useUsers } from '../hooks';
import { OUTCOMES, fmtDateTime, outcomeOf } from '../lib';
import { Avatar, EmptyState, PageHeader, PageLoader, Pill } from '../components/ui';

export default function Calls() {
  const { users } = useUsers();
  const [userId, setUserId] = useState('');
  const [outcome, setOutcome] = useState('');
  const q = useQuery({
    queryKey: ['call-log', userId, outcome],
    queryFn: () => api.get<{ calls: Call[] }>(`/calls${qs({ userId, outcome, limit: 500 })}`).then((r) => r.calls),
  });
  const calls = q.data || [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Call log" icon={<PhoneCall className="size-4" />}>
        <select className="input w-auto" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Everyone</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="input w-auto" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">All outcomes</option>
          {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        {q.isLoading ? <PageLoader /> : !calls.length ? (
          <EmptyState icon={<PhoneCall className="size-10" />} title="No calls logged yet">Calls you log from a contact, a pipeline or the call queue appear here.</EmptyState>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="th">When</th><th className="th">Contact</th><th className="th">By</th><th className="th">Outcome</th><th className="th">Stage change</th><th className="th w-full">Notes</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className="align-top hover:bg-gray-50">
                  <td className="td text-gray-500">{fmtDateTime(c.called_at)}</td>
                  <td className="td font-medium"><Link to={`/contacts/${c.contact_id}`} className="hover:underline">{c.contact_name}</Link></td>
                  <td className="td"><span className="inline-flex items-center gap-1.5"><Avatar user={c.user_name ? { name: c.user_name, color: c.user_color || '#999' } : null} size={18} />{c.user_name}</span></td>
                  <td className="td"><Pill color={outcomeOf(c.outcome)?.color}>{outcomeOf(c.outcome)?.label || c.outcome}</Pill></td>
                  <td className="td text-xs text-gray-500">
                    {c.to_stage_name && <span className="inline-flex items-center gap-1">{c.from_stage_name} <ArrowRight className="size-3" /> <b style={{ color: c.to_stage_color || undefined }}>{c.to_stage_name}</b></span>}
                  </td>
                  <td className="td max-w-xl whitespace-pre-wrap text-gray-700">{c.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
