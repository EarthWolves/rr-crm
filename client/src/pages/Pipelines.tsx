import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { Columns3, Plus, Trash2 } from 'lucide-react';
import { api, type Pipeline } from '../api';
import { usePipelines } from '../hooks';
import { STAGE_COLORS } from '../lib';
import { Button, EmptyState, Field, Modal, PageHeader, PageLoader } from '../components/ui';

export default function Pipelines() {
  const { pipelines, isLoading } = usePipelines();
  const [params, setParams] = useSearchParams();
  const creating = params.get('new') === '1';
  const setCreating = (v: boolean) => setParams(v ? { new: '1' } : {}, { replace: true });

  return (
    <div>
      <PageHeader title="Pipelines" icon={<Columns3 className="size-4" />}>
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus className="size-3.5" /> New pipeline</Button>
      </PageHeader>
      {isLoading ? <PageLoader /> : !pipelines.length ? (
        <EmptyState icon={<Columns3 className="size-10" />} title="No pipelines yet">
          Pipelines are the stages your leads move through. Start with the cold-call template and customize it.
          <div className="mt-3"><Button variant="primary" onClick={() => setCreating(true)}>Create a pipeline</Button></div>
        </EmptyState>
      ) : (
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {pipelines.map((p) => <PipelineCard key={p.id} p={p} />)}
        </div>
      )}
      <CreatePipelineModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function PipelineCard({ p }: { p: Pipeline }) {
  const total = p.entry_count || 1;
  return (
    <Link to={`/pipelines/${p.id}`} className="card block p-4 transition hover:border-gray-300 hover:shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">{p.name}</h3>
        <span className="text-sm text-gray-500">{p.entry_count} records</span>
      </div>
      {p.description && <p className="mt-1 text-sm text-gray-500">{p.description}</p>}
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-gray-100">
        {p.stages.map((s) => <div key={s.id} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} title={`${s.name}: ${s.count}`} />)}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
        {p.stages.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: s.color }} />{s.name} <span className="text-gray-400">{s.count}</span>
          </span>
        ))}
      </div>
    </Link>
  );
}

const TEMPLATE_INFO = {
  cold_call: { label: 'Cold calling', stages: 'Not Contacted → Attempted → Voicemail Left → Gatekeeper → Connected → Follow-up → Meeting Booked / Not Interested' },
  sales: { label: 'Sales deals', stages: 'Lead → Qualified → Discovery → Proposal → Negotiation → Won / Lost' },
  blank: { label: 'Blank', stages: 'Start with one stage and build your own' },
};

export function CreatePipelineModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (p: Pipeline) => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('Cold Calls');
  const [template, setTemplate] = useState<keyof typeof TEMPLATE_INFO>('cold_call');
  const create = useMutation({
    mutationFn: () => api.post<{ pipeline: Pipeline }>('/pipelines', { name, template }),
    onSuccess: ({ pipeline }) => {
      onClose();
      if (onCreated) onCreated(pipeline);
      else navigate(`/pipelines/${pipeline.id}`);
    },
  });
  return (
    <Modal open={open} onClose={onClose} title="New pipeline" footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>Create pipeline</Button>
      </>
    }>
      <div className="space-y-4">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <div>
          <div className="label">Start from</div>
          <div className="space-y-2">
            {(Object.keys(TEMPLATE_INFO) as (keyof typeof TEMPLATE_INFO)[]).map((k) => (
              <button key={k} onClick={() => setTemplate(k)} className={clsx('w-full rounded-lg border p-3 text-left transition', template === k ? 'border-indigo-400 bg-indigo-50/50 ring-2 ring-indigo-100' : 'border-gray-200 hover:bg-gray-50')}>
                <div className="text-sm font-medium">{TEMPLATE_INFO[k].label}</div>
                <div className="mt-0.5 text-xs text-gray-500">{TEMPLATE_INFO[k].stages}</div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">You can rename, recolor, reorder, add and remove stages any time.</p>
        </div>
      </div>
    </Modal>
  );
}

export function EditStagesModal({ pipeline, open, onClose }: { pipeline: Pipeline; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(pipeline.name);
  const [newStage, setNewStage] = useState('');
  const rename = useMutation({ mutationFn: () => api.patch(`/pipelines/${pipeline.id}`, { name }) });
  const updateStage = useMutation({ mutationFn: ({ id, ...patch }: { id: string; name?: string; color?: string; kind?: string }) => api.patch(`/stages/${id}`, patch) });
  const addStage = useMutation({
    mutationFn: () => api.post(`/pipelines/${pipeline.id}/stages`, { name: newStage, color: STAGE_COLORS[pipeline.stages.length % STAGE_COLORS.length] }),
    onSuccess: () => setNewStage(''),
  });
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.put(`/pipelines/${pipeline.id}/stage-order`, { ids }) });
  const delStage = useMutation({ mutationFn: ({ id, moveTo }: { id: string; moveTo?: string }) => api.del(`/stages/${id}${moveTo ? `?moveTo=${moveTo}` : ''}`) });
  const delPipeline = useMutation({ mutationFn: () => api.del(`/pipelines/${pipeline.id}`), onSuccess: () => { onClose(); navigate('/pipelines'); } });

  const move = (i: number, d: number) => {
    const ids = pipeline.stages.map((s) => s.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(ids);
  };

  const removeStage = (i: number) => {
    const s = pipeline.stages[i];
    if (s.count > 0) {
      const target = pipeline.stages[i === 0 ? 1 : i - 1];
      if (!confirm(`"${s.name}" has ${s.count} records. Move them to "${target.name}" and delete the stage?`)) return;
      delStage.mutate({ id: s.id, moveTo: target.id });
    } else if (confirm(`Delete stage "${s.name}"?`)) {
      delStage.mutate({ id: s.id });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit pipeline" width="max-w-xl">
      <div className="space-y-5">
        <Field label="Pipeline name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== pipeline.name && rename.mutate()} />
        </Field>
        <div>
          <div className="label">Stages</div>
          <div className="space-y-1.5">
            {pipeline.stages.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <div className="flex flex-col">
                  <button className="text-[10px] leading-none text-gray-400 hover:text-gray-800 disabled:opacity-20" disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
                  <button className="text-[10px] leading-none text-gray-400 hover:text-gray-800 disabled:opacity-20" disabled={i === pipeline.stages.length - 1} onClick={() => move(i, 1)}>▼</button>
                </div>
                <input type="color" className="size-7 shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-0.5" value={s.color} onChange={(e) => updateStage.mutate({ id: s.id, color: e.target.value })} />
                <input className="input" defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && updateStage.mutate({ id: s.id, name: e.target.value.trim() })} />
                <select className="input w-28" value={s.kind} onChange={(e) => updateStage.mutate({ id: s.id, kind: e.target.value })} title="Won/lost stages count toward conversion stats">
                  <option value="open">Open</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
                <span className="w-8 text-right text-xs text-gray-400">{s.count}</span>
                <button className="rounded p-1 text-gray-300 hover:text-red-600" onClick={() => removeStage(i)} disabled={pipeline.stages.length <= 1}><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newStage.trim()) addStage.mutate(); }}>
            <input className="input" placeholder="New stage name" value={newStage} onChange={(e) => setNewStage(e.target.value)} />
            <Button type="submit" disabled={!newStage.trim()} loading={addStage.isPending}><Plus className="size-3.5" /> Add stage</Button>
          </form>
        </div>
        <div className="border-t border-gray-100 pt-4">
          <Button variant="ghost" className="text-red-600" onClick={() => confirm(`Delete pipeline "${pipeline.name}"? Contacts stay, only their stage in this pipeline is removed.`) && delPipeline.mutate()}>
            <Trash2 className="size-3.5" /> Delete pipeline
          </Button>
        </div>
      </div>
    </Modal>
  );
}
