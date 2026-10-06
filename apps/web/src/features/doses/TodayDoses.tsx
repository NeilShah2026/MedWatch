import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDose } from '@medwatch/core';
import { fetchDosesForDay, updateDose, type DoseWithMed } from '@/lib/api/doses';
import { qk } from '@/lib/queryKeys';
import { formatTime, todayIn } from '@/lib/format';
import type { PatientRow } from '@/lib/types';
import { doseCopy } from '@/copy/doses';
import { useMe } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Badge';
import { EmptyState, QueryState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { IconCheck, IconClock, IconPill } from '@/components/ui/icons';

const DONE = new Set(['given', 'refused', 'skipped']);

function StatusPill({ d }: { d: DoseWithMed }) {
  const tone =
    d.status === 'given'
      ? 'good'
      : d.status === 'missed'
        ? 'bad'
        : d.status === 'pending'
          ? 'neutral'
          : 'warn';
  return <Pill tone={tone}>{doseCopy.status[d.status]}</Pill>;
}

function confirmedLabel(d: DoseWithMed): string | null {
  if (d.confirmation_method === 'caregiver_tap') return doseCopy.confirmedByCaregiver;
  if (d.confirmation_method === 'patient_tap') return doseCopy.confirmedByPatient;
  if (d.confirmation_method === 'nurse') return doseCopy.confirmedByNurse;
  return null;
}

/** Large, time-ordered dose cards for today (patient and caregiver views). */
export function TodayDoses({
  patient,
  mode,
}: {
  patient: PatientRow;
  mode: 'patient' | 'caregiver';
}) {
  const { timezone } = useMe();
  const today = todayIn(timezone);
  const qc = useQueryClient();
  const toast = useToast();
  const [notTaken, setNotTaken] = useState<DoseWithMed | null>(null);
  const [reason, setReason] = useState<string>('');
  const doses = useQuery({
    queryKey: qk.dosesDay(patient.id, today),
    queryFn: () => fetchDosesForDay(patient.id, today, timezone),
  });
  const mutate = useMutation({
    mutationFn: (v: { id: string; status: DoseWithMed['status']; note?: string | null }) =>
      updateDose(v.id, v),
    onSuccess: () => {
      toast(doseCopy.saved);
      void qc.invalidateQueries({ queryKey: ['doses', patient.id] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: () => toast(doseCopy.saveFailed, 'error'),
  });

  return (
    <QueryState
      query={doses}
      isEmpty={(d) => d.length === 0}
      empty={<EmptyState title={doseCopy.noneToday} />}
    >
      {(list) => {
        const done = list.filter((d) => DONE.has(d.status)).length;
        return (
          <div className="space-y-4">
            <div className="card space-y-3" aria-live="polite">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-lg font-semibold" data-testid="dose-progress">
                  {doseCopy.progress(done, list.length)}
                </p>
                <p className="text-ink-muted">
                  {done === list.length ? doseCopy.allDone : doseCopy.remaining(list.length - done)}
                </p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-primary-light" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${(done / list.length) * 100}%` }}
                />
              </div>
            </div>
            <ul className="space-y-3">
              {list.map((d) => {
                const med = d.medications;
                const label = confirmedLabel(d);
                return (
                  <li
                    key={d.id}
                    className="card flex flex-col gap-4 sm:flex-row sm:items-center"
                    data-testid="dose-card"
                  >
                    <div className="flex flex-1 items-start gap-4">
                      <span className="mt-0.5 rounded-xl bg-primary-light p-2.5 text-primary">
                        <IconPill />
                      </span>
                      <div>
                        <p className="text-xl font-bold">{med?.name}</p>
                        <p className="text-ink-muted">{med ? formatDose(med) : ''}</p>
                        <p className="mt-2 flex items-center gap-1.5">
                          <IconClock />
                          {doseCopy.dueAt(formatTime(d.scheduled_for, timezone))}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <StatusPill d={d} />
                          {label && d.status !== 'pending' ? (
                            <span className="text-sm text-ink-muted">{label}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:w-52">
                      {DONE.has(d.status) ? (
                        <Button
                          variant="secondary"
                          block
                          onClick={() => mutate.mutate({ id: d.id, status: 'pending', note: null })}
                          busy={mutate.isPending}
                        >
                          {doseCopy.undo}
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="lg"
                            block
                            onClick={() => mutate.mutate({ id: d.id, status: 'given' })}
                            busy={mutate.isPending}
                          >
                            <IconCheck />
                            {mode === 'patient' ? doseCopy.tookIt : doseCopy.gaveIt}
                          </Button>
                          <Button
                            variant="secondary"
                            block
                            onClick={() => {
                              setReason('');
                              setNotTaken(d);
                            }}
                          >
                            {doseCopy.notTaken}
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Modal
              open={Boolean(notTaken)}
              onClose={() => setNotTaken(null)}
              title={doseCopy.notTakenTitle}
              footer={
                <Button
                  onClick={() => {
                    if (notTaken)
                      mutate.mutate({ id: notTaken.id, status: 'refused', note: reason || null });
                    setNotTaken(null);
                  }}
                >
                  {doseCopy.save}
                </Button>
              }
            >
              <p>{doseCopy.notTakenBody}</p>
              <fieldset className="space-y-2">
                <legend className="font-semibold">{doseCopy.reason}</legend>
                {doseCopy.reasonOptions.map((r) => (
                  <label
                    key={r}
                    className="flex min-h-touch items-center gap-3 rounded-xl border border-line px-3"
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={r}
                      checked={reason === r}
                      onChange={() => setReason(r)}
                      className="h-5 w-5 accent-primary"
                    />
                    {r}
                  </label>
                ))}
              </fieldset>
            </Modal>
          </div>
        );
      }}
    </QueryState>
  );
}
