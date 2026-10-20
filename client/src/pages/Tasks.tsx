import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckSquare, Trash2 } from 'lucide-react';
import { api, type Task } from '../api';
import { useUsers } from '../hooks';
import { fmtDateTime, fromLocalInput, isOverdue } from '../lib';
import { Avatar, Button, EmptyState, PageHeader, PageLoader } from '../components/ui';

export function TaskRow({ task, hideContact }: { task: Task; hideContact?: boolean }) {
  const update = useMutation({ mutationFn: (patch: Record<string, unknown>) => api.patch(`/tasks/${task.id}`, patch) });
  const del = useMutation({ mutationFn: () => api.del(`/tasks/${task.id}`) });
  return (
    <div className="group flex items-center gap-3 px-3 py-2">
      <input type="checkbox" className="size-4" checked={task.done} onChange={(e) => update.mutate({ done: e.target.checked })} />
      <div className="min-w-0 flex-1">
        <div className={clsx('truncate text-sm', task.done && 'text-gray-400 line-through')}>{task.title}</div>
        <div className="flex gap-2 text-xs text-gray-500">
          {!hideContact && task.contact_id && (
            <Link to={`/contacts/${task.contact_id}`} className="hover:text-indigo-600 hover:underline">{task.contact_name}</Link>
          )}
          {task.due_at && <span className={clsx(!task.done && isOverdue(task.due_at) && 'font-medium text-red-600')}>Due {fmtDateTime(task.due_at)}</span>}
        </div>
      </div>
      {task.assignee_name && <Avatar user={{ name: task.assignee_name, color: task.assignee_color || '#999' }} size={20} />}
      <button className="rounded p-1 text-gray-300 opacity-0 group-hover:opacity-100 hover:text-red-600" onClick={() => del.mutate()}>
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

export default function Tasks() {
  const { users } = useUsers();
  const [assignee, setAssignee] = useState('me');
  const [status, setStatus] = useState('open');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const q = useQuery({
    queryKey: ['tasks', assignee, status],
    queryFn: () => api.get<{ tasks: Task[] }>(`/tasks?assignee=${assignee}&status=${status}`).then((r) => r.tasks),
  });
  const add = useMutation({
    mutationFn: () => api.post('/tasks', { title, dueAt: fromLocalInput(due), assigneeId: assignee === 'me' || assignee === 'all' ? undefined : assignee }),
    onSuccess: () => { setTitle(''); setDue(''); },
  });
  const tasks = q.data || [];
  const overdue = tasks.filter((t) => !t.done && isOverdue(t.due_at));
  const rest = tasks.filter((t) => !overdue.includes(t));

  return (
    <div>
      <PageHeader title="Tasks" icon={<CheckSquare className="size-4" />}>
        <select className="input w-auto" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="me">Assigned to me</option>
          <option value="all">Everyone</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="done">Completed</option>
          <option value="">All</option>
        </select>
      </PageHeader>
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }}>
          <input className="input min-w-48 flex-1" placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input type="datetime-local" className="input w-auto" value={due} onChange={(e) => setDue(e.target.value)} />
          <Button variant="primary" type="submit" disabled={!title.trim()} loading={add.isPending}>Add</Button>
        </form>
        {q.isLoading ? <PageLoader /> : !tasks.length ? (
          <EmptyState icon={<CheckSquare className="size-10" />} title="Nothing here">Follow-ups you schedule while logging calls show up as tasks.</EmptyState>
        ) : (
          <>
            {overdue.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-red-600 uppercase">Overdue · {overdue.length}</h3>
                <div className="card divide-y divide-gray-100">{overdue.map((t) => <TaskRow key={t.id} task={t} />)}</div>
              </div>
            )}
            {rest.length > 0 && (
              <div>
                {overdue.length > 0 && <h3 className="mb-1.5 text-xs font-semibold text-gray-500 uppercase">Upcoming</h3>}
                <div className="card divide-y divide-gray-100">{rest.map((t) => <TaskRow key={t.id} task={t} />)}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
