import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import Papa from 'papaparse';
import readExcelFile from 'read-excel-file/browser';
import { CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { api, type Attribute, type Pipeline } from '../api';
import { useAttributes, useMe, usePipelines, useUsers } from '../hooks';
import { COLD_CALL_STAGES, CORE_FIELDS } from '../lib';
import { Button, Field, PageHeader } from '../components/ui';

type Sheet = { name: string; headers: string[]; rows: unknown[][] };
type Result = { created: number; updated: number; skipped: number; notes: number; stagesCreated: number; errors: string[] };

const SPECIAL = [
  { key: 'stage', label: 'Pipeline stage' },
  { key: 'note', label: 'Note (added to timeline)' },
  { key: 'owner', label: 'Owner (name or email)' },
  { key: 'call_count', label: '# of calls so far' },
  { key: 'tags', label: 'Tags (comma separated)' },
];

// Header text → target field guesses.
const GUESSES: [RegExp, string][] = [
  [/^(company|business|account|organi[sz]ation)?\s*name$|^company$/i, 'name'],
  [/phone|tel|mobile|number/i, 'phone'],
  [/e-?mail/i, 'email'],
  [/web|url|domain|site/i, 'website'],
  [/^(contact|person|first.*last|full name|decision maker)/i, 'contact_person'],
  [/title|role|position/i, 'contact_title'],
  [/city|town/i, 'city'],
  [/state|province|region/i, 'state'],
  [/(company|business)\s*type|industry|category|vertical/i, 'company_type'],
  [/employee|headcount|size/i, 'employees'],
  [/revenue/i, 'est_revenue'],
  [/desc|about|summary|overview/i, 'description'],
  [/stage|status/i, 'stage'],
  [/note|comment|outreach notes/i, 'note'],
  [/owner|rep|assigned|sdr/i, 'owner'],
  [/#\s*calls|calls|call count|attempts|dials/i, 'call_count'],
  [/tag|label/i, 'tags'],
];

function guess(header: string, used: Set<string>) {
  for (const [re, key] of GUESSES) {
    if (re.test(header.trim()) && !used.has(key)) return key;
  }
  return '';
}

// Stage value in the file → likely stage in the pipeline.
const STAGE_GUESSES: [RegExp, RegExp][] = [
  [/no touch|not contacted|untouched|^new$|not started/i, /not contacted|^new$|^lead$/i],
  [/attempt|no answer|tried/i, /attempt/i],
  [/voice ?mail|\bvm\b|lvm/i, /voice ?mail/i],
  [/gatekeeper|receptionist/i, /gatekeeper/i],
  [/engaged|connected|conversation|spoke|talked/i, /connect|engaged/i],
  [/follow|call ?back|nurtur/i, /follow/i],
  [/discovery|meeting|demo|scheduled|booked/i, /meeting|discovery|booked/i],
  [/not interested|lost|dead|disqualif|do not call|dnc/i, /not interested|lost/i],
];

function guessStage(value: string, targets: string[]) {
  const exact = targets.find((t) => t.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  for (const [src, dst] of STAGE_GUESSES) {
    if (src.test(value)) {
      const t = targets.find((x) => dst.test(x));
      if (t) return t;
    }
  }
  return '__create';
}

function cellToString(v: unknown) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

export default function Import() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { users } = useUsers();
  const { pipelines } = usePipelines();
  const { attributes } = useAttributes();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<string[]>([]);
  const [pipelineChoice, setPipelineChoice] = useState<string>('new');
  const [newPipelineName, setNewPipelineName] = useState('Cold Calls');
  const [dedupe, setDedupe] = useState<'skip' | 'update' | 'create'>('skip');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  const [stageMap, setStageMap] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  const sheet = sheets[sheetIdx];

  const loadSheet = (s: Sheet) => {
    const used = new Set<string>();
    setMapping(s.headers.map((h) => {
      const g = guess(h, used);
      if (g) used.add(g);
      return g;
    }));
  };

  const onFile = async (file: File) => {
    setError('');
    setResult(null);
    setFileName(file.name);
    try {
      let parsed: Sheet[];
      if (/\.csv$|\.tsv$|\.txt$/i.test(file.name)) {
        const text = await file.text();
        const out = Papa.parse<string[]>(text, { skipEmptyLines: true });
        parsed = [{ name: file.name, headers: (out.data[0] || []).map(String), rows: out.data.slice(1) }];
      } else {
        const all = await readExcelFile(file);
        parsed = all.map((s: { sheet: string; data: unknown[][] }) => ({
          name: s.sheet,
          headers: (s.data[0] || []).map((h) => cellToString(h)),
          rows: s.data.slice(1),
        }));
      }
      parsed = parsed
        .map((s) => ({ ...s, rows: s.rows.filter((r) => r.some((c) => cellToString(c) !== '')) }))
        .filter((s) => s.headers.length);
      if (!parsed.length) throw new Error('No data found in that file');
      setSheets(parsed);
      setSheetIdx(0);
      loadSheet(parsed[0]);
    } catch (e) {
      setError(`Couldn't read that file: ${(e as Error).message}`);
      setSheets([]);
    }
  };

  const stageCol = mapping.indexOf('stage');
  const stageValues = useMemo(() => {
    if (!sheet || stageCol < 0) return [];
    const counts = new Map<string, number>();
    for (const r of sheet.rows) {
      const v = cellToString(r[stageCol]);
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [sheet, stageCol]);

  const targetStages = useMemo(
    () => (pipelineChoice === 'new' ? COLD_CALL_STAGES : pipelines.find((p) => p.id === pipelineChoice)?.stages.map((s) => s.name) || []),
    [pipelineChoice, pipelines],
  );
  useEffect(() => {
    setStageMap(Object.fromEntries(stageValues.map(([v]) => [v, guessStage(v, targetStages)])));
  }, [stageValues, targetStages]);
  const defaultOwner = ownerId ?? me?.id ?? '';

  const run = useMutation({
    mutationFn: async () => {
      setError('');
      // 1. Create any new custom fields.
      const keys = [...mapping];
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] === '__new') {
          const { attribute } = await api.post<{ attribute: Attribute }>('/attributes', { label: sheet.headers[i] || `Column ${i + 1}`, type: 'text' });
          keys[i] = `custom:${attribute.key}`;
        }
      }
      // 2. Resolve the pipeline.
      let pipelineId: string | null = null;
      if (pipelineChoice === 'new') {
        const { pipeline } = await api.post<{ pipeline: Pipeline }>('/pipelines', { name: newPipelineName || 'Cold Calls', template: 'cold_call' });
        pipelineId = pipeline.id;
        setPipelineChoice(pipeline.id);
      } else if (pipelineChoice) {
        pipelineId = pipelineChoice;
      }
      // 3. Build rows and send in chunks.
      const rows = sheet.rows.map((r) => {
        const row: Record<string, unknown> = { custom: {} };
        keys.forEach((k, i) => {
          if (!k) return;
          const v = r[i];
          if (k.startsWith('custom:')) (row.custom as Record<string, unknown>)[k.slice(7)] = typeof v === 'number' || typeof v === 'boolean' ? v : cellToString(v);
          else if (k === 'call_count') row[k] = typeof v === 'number' ? v : parseInt(cellToString(v), 10) || 0;
          else if (k === 'stage') {
            const raw = cellToString(v);
            const target = stageMap[raw] || '__create';
            row.stage = !raw || target === '__first' ? '' : target === '__create' ? raw : target;
          } else if (k === 'note' && row.note) row.note = `${row.note}\n\n${cellToString(v)}`;
          else row[k] = cellToString(v);
        });
        return row;
      });
      const total: Result = { created: 0, updated: 0, skipped: 0, notes: 0, stagesCreated: 0, errors: [] };
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        setProgress(`Importing ${Math.min(i + CHUNK, rows.length)} of ${rows.length}…`);
        const r = await api.post<Result>('/contacts/import', {
          rows: rows.slice(i, i + CHUNK),
          pipelineId,
          dedupe,
          defaultOwnerId: defaultOwner || null,
          tag: tag.trim() || undefined,
        });
        total.created += r.created;
        total.updated += r.updated;
        total.skipped += r.skipped;
        total.notes += r.notes;
        total.stagesCreated += r.stagesCreated;
        total.errors.push(...r.errors);
      }
      return { total, pipelineId };
    },
    onSuccess: ({ total }) => {
      setProgress('');
      setResult(total);
      qc.invalidateQueries();
    },
    onError: (e) => {
      setProgress('');
      setError(e.message);
    },
  });

  if (result) {
    const pid = pipelineChoice && pipelineChoice !== 'new' ? pipelineChoice : null;
    return (
      <div>
        <PageHeader title="Import" icon={<Upload className="size-4" />} />
        <div className="mx-auto max-w-lg p-6 text-center">
          <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
          <h2 className="mt-3 text-lg font-semibold">Import complete</h2>
          <p className="mt-1 text-sm text-gray-600">
            {result.created} created · {result.updated} updated · {result.skipped} skipped · {result.notes} notes added
            {result.stagesCreated > 0 && ` · ${result.stagesCreated} new stages`}
          </p>
          {result.errors.length > 0 && (
            <div className="mt-3 max-h-40 overflow-y-auto rounded-md bg-amber-50 p-2 text-left text-xs text-amber-800">{result.errors.map((e) => <div key={e}>{e}</div>)}</div>
          )}
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={() => { setResult(null); setSheets([]); }}>Import another</Button>
            <Link to="/contacts"><Button>View contacts</Button></Link>
            {pid && <Link to={`/pipelines/${pid}`}><Button variant="primary">Open pipeline</Button></Link>}
          </div>
        </div>
      </div>
    );
  }

  const nameMapped = mapping.includes('name');
  const targetOptions = (
    <>
      <option value="">— Don't import —</option>
      <optgroup label="Contact fields">
        {CORE_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
      </optgroup>
      <optgroup label="Calling">
        {SPECIAL.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
      </optgroup>
      <optgroup label="Custom fields">
        {attributes.map((a) => <option key={a.id} value={`custom:${a.key}`}>{a.label}</option>)}
        <option value="__new">+ Create new custom field</option>
      </optgroup>
    </>
  );

  return (
    <div>
      <PageHeader title="Import contacts" icon={<Upload className="size-4" />} />
      <div className="mx-auto max-w-4xl space-y-5 p-4">
        <label
          className="card flex cursor-pointer flex-col items-center gap-2 border-dashed p-8 text-center transition hover:bg-gray-50"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
        >
          <FileSpreadsheet className="size-8 text-gray-400" />
          <div className="font-medium">{fileName || 'Drop an Excel (.xlsx) or CSV file here'}</div>
          <div className="text-sm text-gray-500">{sheet ? `${sheet.rows.length} rows · ${sheet.headers.length} columns — click to choose a different file` : 'or click to browse'}</div>
          <input type="file" accept=".xlsx,.csv,.tsv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        </label>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {sheet && (
          <>
            {sheets.length > 1 && (
              <Field label="Sheet">
                <select className="input w-auto" value={sheetIdx} onChange={(e) => { const i = +e.target.value; setSheetIdx(i); loadSheet(sheets[i]); }}>
                  {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} rows)</option>)}
                </select>
              </Field>
            )}

            <div className="card overflow-hidden">
              <div className="border-b border-gray-100 px-4 py-2.5">
                <h3 className="font-semibold">1. Match columns</h3>
                <p className="text-xs text-gray-500">We guessed based on your headers. Adjust anything that looks off.</p>
              </div>
              <div className="divide-y divide-gray-100">
                {sheet.headers.map((h, i) => {
                  const sample = sheet.rows.slice(0, 3).map((r) => cellToString(r[i])).filter(Boolean);
                  return (
                    <div key={i} className="grid items-center gap-2 px-4 py-2 sm:grid-cols-[1fr_1fr_220px]">
                      <div className="truncate text-sm font-medium">{h || <span className="text-gray-400">Column {i + 1}</span>}</div>
                      <div className="truncate text-xs text-gray-500">{sample.join(' · ').slice(0, 120) || '—'}</div>
                      <select className={clsx('input', mapping[i] ? 'border-indigo-200 bg-indigo-50/40' : 'text-gray-400')} value={mapping[i] || ''} onChange={(e) => { const m = [...mapping]; m[i] = e.target.value; setMapping(m); }}>
                        {targetOptions}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card space-y-4 p-4">
              <h3 className="font-semibold">2. Pipeline & options</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Add everyone to pipeline">
                  <select className="input" value={pipelineChoice} onChange={(e) => setPipelineChoice(e.target.value)}>
                    <option value="new">+ New cold-call pipeline</option>
                    {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    <option value="">Don't add to a pipeline</option>
                  </select>
                </Field>
                {pipelineChoice === 'new' && (
                  <Field label="New pipeline name"><input className="input" value={newPipelineName} onChange={(e) => setNewPipelineName(e.target.value)} /></Field>
                )}
                <Field label="If a contact already exists (same phone, website or name)">
                  <select className="input" value={dedupe} onChange={(e) => setDedupe(e.target.value as typeof dedupe)}>
                    <option value="skip">Skip it</option>
                    <option value="update">Update it with the file's values</option>
                    <option value="create">Create a duplicate anyway</option>
                  </select>
                </Field>
                <Field label="Owner when the file has none">
                  <select className="input" value={defaultOwner} onChange={(e) => setOwnerId(e.target.value)}>
                    <option value="">Unassigned</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me?.id ? ' (me)' : ''}</option>)}
                  </select>
                </Field>
                <Field label="Tag these contacts"><input className="input" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. Oct list" /></Field>
              </div>
              {pipelineChoice !== '' && (
                <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                  {stageCol >= 0 ? (
                    <>
                      <p className="mb-2">
                        Each value in <b>{sheet.headers[stageCol]}</b> goes to the stage you pick below. Empty cells go to the first stage.
                      </p>
                      <div className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
                        {stageValues.map(([v, n]) => (
                          <div key={v} className="grid items-center gap-2 px-3 py-1.5 sm:grid-cols-[1fr_auto_220px]">
                            <span className="truncate text-gray-800">{v}</span>
                            <span className="text-xs text-gray-400">{n} rows</span>
                            <select className="input" value={stageMap[v] || '__create'} onChange={(e) => setStageMap({ ...stageMap, [v]: e.target.value })}>
                              {targetStages.map((t) => <option key={t} value={t}>{t}</option>)}
                              <option value="__create">+ New stage “{v.length > 30 ? v.slice(0, 30) + '…' : v}”</option>
                              <option value="__first">First stage</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>Everyone starts in the pipeline's first stage. Map a column to <b>Pipeline stage</b> to place them individually.</>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3">
              {!nameMapped && <span className="text-sm text-amber-700">Map one column to <b>Name</b> to continue.</span>}
              {progress && <span className="text-sm text-gray-500">{progress}</span>}
              <Button variant="primary" disabled={!nameMapped} loading={run.isPending} onClick={() => run.mutate()}>
                Import {sheet.rows.length} rows
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
