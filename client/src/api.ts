export type User = { id: string; name: string; email: string; role: 'admin' | 'member'; color: string };

export type EntryRef = { id: string; pipeline_id: string; stage_id: string };

export type Contact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  contact_person: string | null;
  contact_title: string | null;
  city: string | null;
  state: string | null;
  company_type: string | null;
  employees: string | null;
  est_revenue: string | null;
  description: string | null;
  tags: string[];
  trades: string[];
  custom: Record<string, unknown>;
  owner_id: string | null;
  call_count: number;
  last_called_at: string | null;
  last_outcome: string | null;
  next_follow_up_at: string | null;
  created_at: string;
  updated_at: string;
  entries: EntryRef[];
};

export type Stage = { id: string; pipeline_id: string; name: string; color: string; kind: 'open' | 'won' | 'lost'; position: number; count: number };
export type Pipeline = { id: string; name: string; description: string | null; stages: Stage[]; entry_count: number };

export type BoardEntry = {
  id: string;
  stage_id: string;
  position: number;
  stage_changed_at: string;
  contact_id: string;
  name: string;
  phone: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  owner_id: string | null;
  call_count: number;
  last_outcome: string | null;
  last_called_at: string | null;
  next_follow_up_at: string | null;
  tags: string[];
  employees: string | null;
  est_revenue: string | null;
  trades: string[];
  note_count: number;
  last_note: string | null;
};

export type Call = {
  id: string;
  contact_id: string;
  user_id: string | null;
  outcome: string;
  duration_sec: number | null;
  notes: string | null;
  called_at: string;
  user_name: string | null;
  user_color: string | null;
  contact_name: string;
  contact_phone: string | null;
  from_stage_name: string | null;
  to_stage_name: string | null;
  to_stage_color: string | null;
};

export type Note = {
  id: string;
  contact_id: string;
  call_id: string | null;
  user_id: string | null;
  body: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  user_name: string | null;
  user_color: string | null;
  contact_name?: string;
};

export type Task = {
  id: string;
  contact_id: string | null;
  title: string;
  due_at: string | null;
  assignee_id: string | null;
  done: boolean;
  created_at: string;
  contact_name: string | null;
  assignee_name: string | null;
  assignee_color: string | null;
};

export type Attribute = { id: string; key: string; label: string; type: string; options: string[]; position: number };

export type Activity = {
  id: string | number;
  kind?: string;
  contact_id: string | null;
  user_id: string | null;
  type: string;
  data: Record<string, any>;
  created_at: string;
  user_name: string | null;
  user_color: string | null;
  contact_name?: string | null;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText);
  return data as T;
}

export const api = {
  get: <T,>(url: string) => request<T>('GET', url),
  post: <T,>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T,>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T,>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T,>(url: string) => request<T>('DELETE', url),
};

export function qs(params: Record<string, string | number | undefined | null | false>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
}
