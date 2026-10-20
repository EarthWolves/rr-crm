export const OUTCOMES: { value: string; label: string; color: string; connected?: boolean }[] = [
  { value: 'no_answer', label: 'No answer', color: '#94a3b8' },
  { value: 'voicemail', label: 'Left voicemail', color: '#a78bfa' },
  { value: 'gatekeeper', label: 'Gatekeeper', color: '#f472b6' },
  { value: 'connected', label: 'Connected', color: '#22d3ee', connected: true },
  { value: 'callback', label: 'Call back later', color: '#fbbf24', connected: true },
  { value: 'meeting_booked', label: 'Meeting booked', color: '#10b981', connected: true },
  { value: 'not_interested', label: 'Not interested', color: '#f87171', connected: true },
  { value: 'wrong_number', label: 'Wrong number', color: '#78716c' },
];

export const outcomeOf = (v: string | null | undefined) => OUTCOMES.find((o) => o.value === v);

export const STAGE_COLORS = ['#94a3b8', '#60a5fa', '#a78bfa', '#f472b6', '#22d3ee', '#fbbf24', '#fb923c', '#34d399', '#f87171', '#6366f1'];

export const CORE_FIELDS: { key: string; label: string; type?: string; long?: boolean }[] = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone', type: 'phone' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'website', label: 'Website', type: 'url' },
  { key: 'contact_person', label: 'Contact person' },
  { key: 'contact_title', label: 'Contact title' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'company_type', label: 'Company type' },
  { key: 'employees', label: 'Employees' },
  { key: 'est_revenue', label: 'Est. revenue' },
  { key: 'description', label: 'Description', long: true },
];

export function fmtDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  if (!d) return '';
  const date = new Date(d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? opts : { ...opts, year: 'numeric' });
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return '';
  return `${fmtDate(d)}, ${new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function timeAgo(d: string | null | undefined) {
  if (!d) return '';
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  const future = diff < 0;
  const s = Math.abs(diff);
  const fmt = (n: number, u: string) => (future ? `in ${n}${u}` : `${n}${u} ago`);
  if (s < 60) return future ? 'soon' : 'just now';
  if (s < 3600) return fmt(Math.floor(s / 60), 'm');
  if (s < 86400) return fmt(Math.floor(s / 3600), 'h');
  if (s < 86400 * 30) return fmt(Math.floor(s / 86400), 'd');
  return fmtDate(d);
}

export function isOverdue(d: string | null | undefined) {
  return !!d && new Date(d).getTime() <= Date.now();
}

export function telHref(phone: string | null | undefined) {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d+]/g, '');
  return `tel:${digits}`;
}

export function siteHref(url: string | null | undefined) {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function prettySite(url: string | null | undefined) {
  return url ? url.replace(/^https?:\/\//i, '').replace(/^www\./, '').replace(/\/$/, '') : '';
}

// <input type="datetime-local"> works in local time; convert to and from ISO.
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string) {
  return v ? new Date(v).toISOString() : null;
}

export function quickDate(kind: 'later' | 'tomorrow' | '3days' | 'week') {
  const d = new Date();
  if (kind === 'later') d.setHours(d.getHours() + 3, 0, 0, 0);
  else {
    d.setDate(d.getDate() + (kind === 'tomorrow' ? 1 : kind === '3days' ? 3 : 7));
    d.setHours(10, 0, 0, 0);
  }
  return d.toISOString();
}

// Mirrors the server's cold_call pipeline template.
export const COLD_CALL_STAGES = ['Not Contacted', 'Attempted', 'Voicemail Left', 'Gatekeeper', 'Connected', 'Follow-up', 'Meeting Booked', 'Not Interested'];
