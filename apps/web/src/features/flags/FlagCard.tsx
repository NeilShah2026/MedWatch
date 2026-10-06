import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SYMPTOM_CATALOG, localDate } from '@medwatch/core';
import { supabase } from '@/lib/supabase';
import { reviewFlag } from '@/lib/api/flags';
import { formatDate, formatDateTime } from '@/lib/format';
import type { FlagRow, MedicationChangeRow } from '@/lib/types';
import { flagCopy } from '@/copy/flags';
import { doseCopy } from '@/copy/doses';
import { useMe } from '@/app/AuthProvider';
import { SeverityBadge, Pill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextAreaField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { IconChevronDown, IconChevronRight } from '@/components/ui/icons';

function Evidence({ flag }: { flag: FlagRow }) {
  const { timezone } = useMe();
  const ev = flag.evidence;
  const details = useQuery({
    queryKey: ['flagEvidence', flag.id],
    queryFn: async () => {
      const changeIds = [...ev.medication_change_ids, ...(ev.other_candidate_change_ids ?? [])];
      const [d, l, m, c] = await Promise.all([
        ev.dose_event_ids.length
          ? supabase
              .from('dose_events')
              .select('id, scheduled_for, status')
              .in('id', ev.dose_event_ids.slice(0, 200))
          : Promise.resolve({ data: [] }),
        ev.symptom_log_ids.length
          ? supabase
              .from('symptom_logs')
              .select('id, logged_for_date, entries')
              .in('id', ev.symptom_log_ids)
          : Promise.resolve({ data: [] }),
        ev.medication_ids.length || changeIds.length
          ? supabase.from('medications').select('id, name').eq('patient_id', flag.patient_id)
          : Promise.resolve({ data: [] }),
        changeIds.length
          ? supabase
              .from('medication_changes')
              .select('id, medication_id, change_type, effective_date')
              .in('id', changeIds)
          : Promise.resolve({ data: [] }),
      ]);
      return {
        doses: (d.data ?? []) as { id: string; scheduled_for: string; status: string }[],
        logs: (l.data ?? []) as {
          id: string;
          logged_for_date: string;
          entries: { symptom_code: string; severity: number }[];
        }[],
        meds: new Map(((m.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x])),
        changes: new Map(
          (
            (c.data ?? []) as Pick<
              MedicationChangeRow,
              'id' | 'medication_id' | 'change_type' | 'effective_date'
            >[]
          ).map((x) => [x.id, x]),
        ),
      };
    },
  });
  const meds = details.data?.meds ?? new Map<string, { id: string; name: string }>();
  const changes =
    details.data?.changes ??
    new Map<
      string,
      Pick<MedicationChangeRow, 'id' | 'medication_id' | 'change_type' | 'effective_date'>
    >();
  const symptom = ev.symptom_code
    ? SYMPTOM_CATALOG.find((s) => s.code === ev.symptom_code)?.label
    : null;
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-bg p-3 text-sm" data-testid="flag-evidence">
      {ev.medication_ids.length ? (
        <div>
          <p className="font-semibold">{flagCopy.evidenceMedicines}</p>
          <p>{ev.medication_ids.map((id) => meds.get(id)?.name ?? id).join(', ')}</p>
        </div>
      ) : null}
      {ev.medication_change_ids.map((id) => {
        const c = changes.get(id);
        return c ? (
          <div key={id}>
            <p className="font-semibold">{flagCopy.evidenceChange}</p>
            <p>
              {meds.get(c.medication_id)?.name} — {flagCopy.changeLabel[c.change_type]} —{' '}
              {formatDate(c.effective_date)}
            </p>
          </div>
        ) : null;
      })}
      {details.data?.doses.length ? (
        <div>
          <p className="font-semibold">{flagCopy.evidenceDoses}</p>
          <ul className="flex flex-wrap gap-1">
            {[...details.data.doses]
              .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
              .map((d) => (
                <li key={d.id}>
                  <Pill tone={d.status === 'given' ? 'good' : 'bad'}>
                    {formatDateTime(d.scheduled_for, timezone)} ·{' '}
                    {doseCopy.status[d.status as keyof typeof doseCopy.status]}
                  </Pill>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
      {details.data?.logs.length && ev.symptom_code ? (
        <div>
          <p className="font-semibold">{flagCopy.evidenceSymptoms}</p>
          <ul className="flex flex-wrap gap-1">
            {[...details.data.logs]
              .sort((a, b) => a.logged_for_date.localeCompare(b.logged_for_date))
              .map((l) => {
                const sev =
                  l.entries.find((e) => e.symptom_code === ev.symptom_code)?.severity ?? 0;
                return (
                  <li key={l.id}>
                    <Pill tone={sev ? 'warn' : 'neutral'}>
                      {formatDate(l.logged_for_date)} · {symptom}: {sev}
                    </Pill>
                  </li>
                );
              })}
          </ul>
        </div>
      ) : null}
      {ev.score_parts?.length ? (
        <div>
          <p className="font-semibold">{flagCopy.evidenceScore}</p>
          <ul>
            {ev.score_parts.map((p) => (
              <li key={p.label}>
                {p.label}: {flagCopy.points(p.points)}
              </li>
            ))}
            <li className="font-semibold">
              {flagCopy.total}: {ev.score}
            </li>
          </ul>
        </div>
      ) : null}
      {ev.other_candidate_change_ids?.length ? (
        <div>
          <p className="font-semibold">{flagCopy.evidenceOtherChanges}</p>
          <p>
            {ev.other_candidate_change_ids
              .map((id) => changes.get(id))
              .filter(Boolean)
              .map((c) => `${meds.get(c!.medication_id)?.name} (${formatDate(c!.effective_date)})`)
              .join(', ')}
          </p>
        </div>
      ) : null}
      {flag.rule_id ? (
        <p>
          <span className="font-semibold">{flagCopy.evidenceRule}:</span>{' '}
          <code>{flag.rule_id}</code>
        </p>
      ) : null}
    </div>
  );
}

type ReviewKind = 'dismissed' | 'escalated' | 'note';

export function FlagCard({
  flag,
  readOnly,
  reviewerName,
  onSelect,
  selected,
  patientLabel,
}: {
  flag: FlagRow;
  readOnly?: boolean;
  reviewerName?: (id: string) => string | undefined;
  onSelect?: (flag: FlagRow) => void;
  selected?: boolean;
  patientLabel?: React.ReactNode;
}) {
  const { timezone } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<ReviewKind | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const m = useMutation({
    mutationFn: (v: { status: FlagRow['status']; note?: string }) =>
      reviewFlag(flag.id, v.status, v.note),
    onSuccess: () => {
      toast(flagCopy.reviewed);
      setReview(null);
      void qc.invalidateQueries({ queryKey: ['flags'] });
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: () => toast(flagCopy.required, 'error'),
  });
  const reviewable = !readOnly && (flag.status === 'open' || flag.status === 'acknowledged');
  const titleFor: Record<ReviewKind, string> = {
    dismissed: flagCopy.dismissTitle,
    escalated: flagCopy.escalateTitle,
    note: flagCopy.addNote,
  };
  const labelFor: Record<ReviewKind, string> = {
    dismissed: flagCopy.dismissReason,
    escalated: flagCopy.escalateNote,
    note: flagCopy.note,
  };

  return (
    <article
      className={`card ${flag.severity === 'high' && flag.status === 'open' ? 'border-l-8 border-l-severity-high' : ''} ${selected ? 'ring-4 ring-accent' : ''}`}
      data-testid="flag-card"
      data-flag-type={flag.flag_type}
      data-severity={flag.severity}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={flag.severity} />
        <Pill>{flagCopy.type[flag.flag_type]}</Pill>
        <Pill tone={flag.status === 'open' ? 'warn' : 'neutral'}>
          {flagCopy.status[flag.status]}
        </Pill>
        <span className="text-sm text-ink-muted">
          {flagCopy.created} {formatDate(localDate(flag.created_at, timezone))}
        </span>
        {patientLabel}
      </div>
      <h3 className="mt-2 text-lg font-bold">{flag.title}</h3>
      <p className="mt-1">{flag.explanation}</p>
      {flag.reviewed_at && flag.reviewed_by ? (
        <p className="mt-2 text-sm text-ink-muted">
          {flagCopy.reviewedBy(
            reviewerName?.(flag.reviewed_by) ?? '—',
            formatDateTime(flag.reviewed_at, timezone),
          )}
          {flag.review_note ? ` — “${flag.review_note}”` : ''}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? <IconChevronDown /> : <IconChevronRight />}
          {open ? flagCopy.hideWhy : flagCopy.why}
        </Button>
        {onSelect ? (
          <Button variant="ghost" onClick={() => onSelect(flag)}>
            {flagCopy.showOnTimeline}
          </Button>
        ) : null}
        {reviewable ? (
          <>
            {flag.status === 'open' ? (
              <Button
                variant="secondary"
                onClick={() => m.mutate({ status: 'acknowledged' })}
                busy={m.isPending}
              >
                {flagCopy.acknowledge}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => {
                setText('');
                setError(undefined);
                setReview('dismissed');
              }}
            >
              {flagCopy.dismiss}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setText('');
                setError(undefined);
                setReview('escalated');
              }}
            >
              {flagCopy.escalate}
            </Button>
          </>
        ) : null}
        {!readOnly ? (
          <Button
            variant="ghost"
            onClick={() => {
              setText(flag.review_note ?? '');
              setError(undefined);
              setReview('note');
            }}
          >
            {flagCopy.addNote}
          </Button>
        ) : null}
      </div>
      {open ? <Evidence flag={flag} /> : null}
      <Modal
        open={review !== null}
        onClose={() => setReview(null)}
        title={review ? titleFor[review] : ''}
        footer={
          <Button
            busy={m.isPending}
            onClick={() => {
              if (!review) return;
              if (review !== 'note' && !text.trim()) {
                setError(flagCopy.required);
                return;
              }
              m.mutate(
                review === 'note'
                  ? { status: flag.status, note: text.trim() }
                  : { status: review, note: text.trim() },
              );
            }}
          >
            {flagCopy.saveNote}
          </Button>
        }
      >
        {review ? (
          <TextAreaField
            label={labelFor[review]}
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={error}
            required={review !== 'note'}
          />
        ) : null}
      </Modal>
    </article>
  );
}
