import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type EntryRef } from '../api';
import { usePipelines } from '../hooks';
import { OUTCOMES, fromLocalInput, quickDate, toLocalInput } from '../lib';
import { Button, Modal, toast } from './ui';

type Props = {
  contactId: string;
  entries: EntryRef[];
  preferredPipelineId?: string;
  onDone?: (outcome: string) => void;
  submitLabel?: string;
  autoFocus?: boolean;
};

// Suggest a stage to move to based on the outcome, by matching common stage names.
const STAGE_HINTS: Record<string, RegExp> = {
  no_answer: /attempt|no answer|tried/i,
  voicemail: /voice ?mail|vm|attempt/i,
  gatekeeper: /gatekeeper|attempt/i,
  connected: /connect|engaged|contacted|conversation/i,
  callback: /follow|call ?back|nurtur/i,
  meeting_booked: /meeting|booked|discovery|demo|scheduled/i,
  not_interested: /not interested|lost|dead|disqualif/i,
  wrong_number: /wrong|bad|invalid|disqualif/i,
};

export function CallForm({ contactId, entries, preferredPipelineId, onDone, submitLabel = 'Log call', autoFocus }: Props) {
  const { pipelines } = usePipelines();
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [entryId, setEntryId] = useState('');
  const [stageId, setStageId] = useState('');
  const [stageTouched, setStageTouched] = useState(false);
  const [followUp, setFollowUp] = useState<string | null>(null);

  useEffect(() => {
    const preferred = entries.find((e) => e.pipeline_id === preferredPipelineId) || entries[0];
    setEntryId(preferred?.id || '');
    setStageId(preferred?.stage_id || '');
    setOutcome('');
    setNotes('');
    setFollowUp(null);
    setStageTouched(false);
    // Only reset when the contact or its pipeline memberships change, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId, preferredPipelineId, entries.map((e) => e.id).join()]);

  const entry = entries.find((e) => e.id === entryId);
  const pipeline = pipelines.find((p) => p.id === entry?.pipeline_id);

  const pickOutcome = (o: string) => {
    setOutcome(o);
    if (pipeline && !stageTouched) {
      const hint = STAGE_HINTS[o];
      const match = hint && pipeline.stages.find((s) => hint.test(s.name));
      setStageId(match?.id || entry?.stage_id || '');
    }
    if (o === 'callback' && !followUp) setFollowUp(quickDate('tomorrow'));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= OUTCOMES.length) pickOutcome(OUTCOMES[n - 1].value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const save = useMutation({
    mutationFn: () =>
      api.post(`/contacts/${contactId}/calls`, {
        outcome,
        notes: notes.trim() || undefined,
        entryId: entry && stageId && stageId !== entry.stage_id ? entry.id : undefined,
        stageId: entry && stageId && stageId !== entry.stage_id ? stageId : undefined,
        followUpAt: followUp ?? undefined,
      }),
    onSuccess: () => {
      toast('Call logged');
      onDone?.(outcome);
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <div className="label">Outcome</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5">
          {OUTCOMES.map((o, i) => (
            <button
              key={o.value}
              type="button"
              onClick={() => pickOutcome(o.value)}
              className={clsx(
                'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs font-medium transition',
                outcome === o.value ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50',
              )}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: o.color }} />
              <span className="flex-1 truncate">{o.label}</span>
              <kbd className={clsx('hidden text-[10px] sm:inline', outcome === o.value ? 'text-gray-300' : 'text-gray-400')}>{i + 1}</kbd>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="label">Call notes</div>
        <textarea
          className="input min-h-24"
          placeholder="Who did you speak with? What did they say? Next steps…"
          value={notes}
          autoFocus={autoFocus}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && outcome) save.mutate();
          }}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="label">Move stage</div>
          {entries.length ? (
            <div className="flex gap-1.5">
              {entries.length > 1 && (
                <select
                  className="input w-auto max-w-36"
                  value={entryId}
                  onChange={(e) => {
                    const en = entries.find((x) => x.id === e.target.value);
                    setEntryId(e.target.value);
                    setStageId(en?.stage_id || '');
                  }}
                >
                  {entries.map((en) => (
                    <option key={en.id} value={en.id}>
                      {pipelines.find((p) => p.id === en.pipeline_id)?.name}
                    </option>
                  ))}
                </select>
              )}
              <select
                className="input"
                value={stageId}
                onChange={(e) => {
                  setStageId(e.target.value);
                  setStageTouched(true);
                }}
              >
                {pipeline?.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.id === entry?.stage_id ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="py-1.5 text-xs text-gray-400">Not in any pipeline</div>
          )}
        </div>
        <div>
          <div className="label">Follow-up</div>
          <input
            type="datetime-local"
            className="input"
            value={toLocalInput(followUp)}
            onChange={(e) => setFollowUp(fromLocalInput(e.target.value))}
          />
          <div className="mt-1 flex flex-wrap gap-1">
            {(
              [
                ['later', 'In 3h'],
                ['tomorrow', 'Tomorrow'],
                ['3days', '3 days'],
                ['week', '1 week'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFollowUp(quickDate(k))} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-200">
                {l}
              </button>
            ))}
            {followUp && (
              <button type="button" onClick={() => setFollowUp(null)} className="rounded px-1.5 py-0.5 text-[11px] text-gray-400 hover:text-gray-700">
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto hidden text-xs text-gray-400 sm:inline">Press 1–8 to pick an outcome · ⌘/Ctrl+Enter to save</span>
        <Button variant="primary" disabled={!outcome} loading={save.isPending} onClick={() => save.mutate()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function LogCallModal({ open, onClose, contactId, contactName, entries, preferredPipelineId }: {
  open: boolean;
  onClose: () => void;
  contactId: string;
  contactName: string;
  entries: EntryRef[];
  preferredPipelineId?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={`Log call · ${contactName}`} width="max-w-2xl">
      {open && <CallForm contactId={contactId} entries={entries} preferredPipelineId={preferredPipelineId} onDone={() => onClose()} autoFocus />}
    </Modal>
  );
}
