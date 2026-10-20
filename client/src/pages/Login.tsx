import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type User } from '../api';
import { Button, Field } from '../components/ui';

export default function Login() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['auth-status'], queryFn: () => api.get<{ needsSetup: boolean }>('/auth/status') });
  const needsSetup = status.data?.needsSetup;
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', inviteCode: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const registering = needsSetup || mode === 'register';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = registering
        ? await api.post<{ user: User }>('/auth/register', form)
        : await api.post<{ user: User }>('/auth/login', { email: form.email, password: form.password });
      qc.setQueryData(['me'], user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="flex min-h-full items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src="/favicon.svg" className="size-10" alt="" />
          <div>
            <h1 className="text-xl font-semibold">{needsSetup ? 'Set up your workspace' : registering ? 'Join your team' : 'Sign in to RR CRM'}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {needsSetup
                ? 'You are the first user, so you will be the workspace admin.'
                : registering
                  ? 'Ask a teammate for the invite code from Settings.'
                  : 'Your team’s cold-calling CRM.'}
            </p>
          </div>
        </div>
        <form onSubmit={submit} className="card space-y-3 p-5 shadow-sm">
          {registering && (
            <Field label="Your name">
              <input className="input" value={form.name} onChange={set('name')} required autoFocus />
            </Field>
          )}
          <Field label="Email">
            <input className="input" type="email" value={form.email} onChange={set('email')} required autoFocus={!registering} />
          </Field>
          <Field label="Password">
            <input className="input" type="password" value={form.password} onChange={set('password')} required minLength={registering ? 8 : undefined} />
          </Field>
          {registering && !needsSetup && (
            <Field label="Invite code">
              <input className="input" value={form.inviteCode} onChange={set('inviteCode')} required />
            </Field>
          )}
          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <Button variant="primary" className="w-full" loading={busy} type="submit">
            {registering ? 'Create account' : 'Sign in'}
          </Button>
        </form>
        {!needsSetup && (
          <p className="mt-4 text-center text-sm text-gray-500">
            {mode === 'login' ? 'New here? ' : 'Already have an account? '}
            <button className="font-medium text-indigo-600 hover:underline" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'Join with an invite code' : 'Sign in'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
