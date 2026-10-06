import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays } from '@medwatch/core';
import { fetchDoses, updateDose, type DoseWithMed } from '@/lib/api/doses';
import { formatDateTime, todayIn } from '@/lib/format';
import type { DoseEventRow, PatientRow } from '@/lib/types';
import { doseCopy } from '@/copy/doses';
import { useMe } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { CheckboxField, SelectField, TextField, TextAreaField } from '@/components/ui/Field';
import { Table, td, th } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Badge';
import { EmptyState, QueryState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';

const STATUSES: DoseEventRow['status'][] = ['pending', 'given', 'missed', 'skipped', 'refused'];
const METHOD: Record<string, string> = {
  patient_tap: doseCopy.confirmedByPatient,
  caregiver_tap: doseCopy.confirmedByCaregiver,
  nurse: doseCopy.confirmedByNurse,
  system: '—',
};

export function DosesTab({ patient }: { patient: PatientRow }) {
  const { timezone } = useMe();
  const today = todayIn(timezone);
  const qc = useQueryClient();
  const toast = useToast();
  const [from, setFrom] = useState(addDays(today, -13));
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<DoseWithMed | null>(null);
  const [form, setForm] = useState<{
    status: DoseEventRow['status'];
    note: string;
    verified: boolean;
  }>({ status: 'given', note: '', verified: false });
  const q = useQuery({
    queryKey: ['doses', patient.id, from, to, status],
    queryFn: () => fetchDoses(patient.id, from, to, timezone, status || undefined),
  });
  const save = useMutation({
    mutationFn: () =>
      updateDose(editing!.id, {
        status: form.status,
        note: form.note.trim() || null,
        verification: form.verified ? 'verified' : 'reported',
      }),
    onSuccess: () => {
      toast(doseCopy.saved);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['doses', patient.id] });
      void qc.invalidateQueries({ queryKey: ['adherenceDaily', patient.id] });
    },
    onError: () => toast(doseCopy.saveFailed, 'error'),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label={doseCopy.from}
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          label={doseCopy.to}
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
        <SelectField
          label={doseCopy.statusFilter}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: doseCopy.all },
            ...STATUSES.map((s) => ({ value: s, label: doseCopy.status[s] })),
          ]}
        />
      </div>
      <QueryState
        query={q}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={doseCopy.noDoses} />}
      >
        {(rows) => (
          <Table caption={doseCopy.historyTitle}>
            <thead>
              <tr>
                <th className={th}>{doseCopy.scheduled}</th>
                <th className={th}>{doseCopy.medicine}</th>
                <th className={th}>{doseCopy.newStatus}</th>
                <th className={th}>{doseCopy.method}</th>
                <th className={th}>{doseCopy.note}</th>
                <th className={th}>
                  <span className="sr-only">{doseCopy.correct}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} data-testid="dose-row">
                  <td className={td}>{formatDateTime(d.scheduled_for, timezone)}</td>
                  <td className={td}>{d.medications?.name}</td>
                  <td className={td}>
                    <Pill
                      tone={
                        d.status === 'given'
                          ? 'good'
                          : d.status === 'missed'
                            ? 'bad'
                            : d.status === 'pending'
                              ? 'neutral'
                              : 'warn'
                      }
                    >
                      {doseCopy.status[d.status]}
                    </Pill>{' '}
                    <span className="text-xs text-ink-muted">
                      {d.verification === 'verified' ? doseCopy.verified : doseCopy.reported}
                    </span>
                  </td>
                  <td className={td}>
                    {d.confirmation_method ? METHOD[d.confirmation_method] : ''}
                  </td>
                  <td className={td}>{d.note}</td>
                  <td className={td}>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setForm({
                          status: d.status === 'pending' ? 'given' : d.status,
                          note: d.note ?? '',
                          verified: d.verification === 'verified',
                        });
                        setEditing(d);
                      }}
                    >
                      {doseCopy.correct}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryState>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={doseCopy.correctTitle}
        footer={
          <Button busy={save.isPending} onClick={() => save.mutate()}>
            {doseCopy.save}
          </Button>
        }
      >
        <SelectField
          label={doseCopy.newStatus}
          value={form.status}
          onChange={(e) =>
            setForm((f) => ({ ...f, status: e.target.value as DoseEventRow['status'] }))
          }
          options={STATUSES.map((s) => ({ value: s, label: doseCopy.status[s] }))}
        />
        <TextAreaField
          label={doseCopy.note}
          hint={doseCopy.noteHint}
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
        />
        <CheckboxField
          label={doseCopy.verify}
          checked={form.verified}
          onChange={(e) => setForm((f) => ({ ...f, verified: e.target.checked }))}
        />
      </Modal>
    </div>
  );
}
