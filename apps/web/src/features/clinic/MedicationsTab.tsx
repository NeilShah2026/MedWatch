import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SYMPTOM_CATALOG,
  addDays,
  formatDose,
  isMedicationActiveOn,
  type ChangeType,
} from '@medwatch/core';
import {
  addMedication,
  changeMedication,
  fetchChanges,
  fetchMedications,
  type MedicationInput,
} from '@/lib/api/meds';
import { fetchActiveTemplate, regenerateTemplate } from '@/lib/api/templates';
import { triggerFunction } from '@/lib/functions';
import { qk } from '@/lib/queryKeys';
import { classLabel, rules } from '@/lib/rules';
import { formatClock, formatDate, formatDateTime, todayIn } from '@/lib/format';
import type { MedicationRow, PatientRow } from '@/lib/types';
import { nurseCopy } from '@/copy/nurse';
import { flagCopy } from '@/copy/flags';
import { medsCopy } from '@/copy/meds';
import { common } from '@/copy/common';
import { useMe } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { CheckboxField, SelectField, TextField } from '@/components/ui/Field';
import { Card, Table, td, th } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Badge';
import { EmptyState, QueryState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';

const TIME_LIST = /^\s*(([01]\d|2[0-3]):[0-5]\d)(\s*,\s*([01]\d|2[0-3]):[0-5]\d)*\s*$/;

const medSchema = z
  .object({
    name: z.string().trim().min(1, nurseCopy.medForm.required).max(120),
    generic_name: z.string().trim().max(120).optional(),
    drug_class: z.string().min(1),
    purpose: z.string().trim().max(120).optional(),
    dose_amount: z.string().trim().optional(),
    dose_unit: z.string().trim().max(20).optional(),
    route: z.string().trim().max(40).optional(),
    frequency_label: z.string().trim().max(60).optional(),
    times: z.string().optional(),
    prn: z.boolean(),
    start_date: z.string().min(10, nurseCopy.medForm.required),
    prescriber_name: z.string().trim().max(120).optional(),
    change_type: z.string().optional(),
    effective_date: z.string().min(10, nurseCopy.medForm.required),
  })
  .refine((v) => v.prn || TIME_LIST.test(v.times ?? ''), {
    path: ['times'],
    message: nurseCopy.medForm.timesInvalid,
  })
  .refine((v) => !v.dose_amount || !Number.isNaN(Number(v.dose_amount)), {
    path: ['dose_amount'],
    message: nurseCopy.medForm.required,
  });

type MedForm = z.infer<typeof medSchema>;

function toInput(v: MedForm): MedicationInput {
  return {
    name: v.name,
    generic_name: v.generic_name || null,
    drug_class: v.drug_class,
    purpose: v.purpose || null,
    dose_amount: v.dose_amount ? Number(v.dose_amount) : null,
    dose_unit: v.dose_unit || null,
    route: v.route || null,
    frequency_label: v.frequency_label || null,
    schedule_times: v.prn
      ? []
      : (v.times ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .sort(),
    prn: v.prn,
    start_date: v.start_date,
    prescriber_name: v.prescriber_name || null,
  };
}

function MedicationForm({
  patient,
  med,
  onDone,
}: {
  patient: PatientRow;
  med?: MedicationRow;
  onDone: () => void;
}) {
  const { timezone } = useMe();
  const today = todayIn(timezone);
  const qc = useQueryClient();
  const toast = useToast();
  const { register, handleSubmit, watch, formState } = useForm<MedForm>({
    resolver: zodResolver(medSchema),
    defaultValues: {
      name: med?.name ?? '',
      generic_name: med?.generic_name ?? '',
      drug_class: med?.drug_class ?? 'other',
      purpose: med?.purpose ?? '',
      dose_amount: med?.dose_amount?.toString() ?? '',
      dose_unit: med?.dose_unit ?? 'mg',
      route: med?.route ?? 'oral',
      frequency_label: med?.frequency_label ?? '',
      times: med?.schedule_times.join(', ') ?? '08:00',
      prn: med?.prn ?? false,
      start_date: med?.start_date ?? today,
      prescriber_name: med?.prescriber_name ?? '',
      change_type: med ? 'dose_increased' : undefined,
      effective_date: today,
    },
  });
  const save = useMutation({
    mutationFn: async (v: MedForm) => {
      const input = toInput(v);
      if (med)
        await changeMedication(
          med,
          input,
          (v.change_type ?? 'schedule_changed') as ChangeType,
          v.effective_date,
        );
      else
        await addMedication(patient, { ...input, start_date: v.effective_date }, v.effective_date);
    },
    onSuccess: () => {
      toast(nurseCopy.medSaved);
      void qc.invalidateQueries({ queryKey: qk.medications(patient.id) });
      void qc.invalidateQueries({ queryKey: qk.changes(patient.id) });
      // Regenerate the tailored check-in (idempotent per fingerprint) and re-run the flag engine.
      void regenerateTemplate(patient.id)
        .catch(() => undefined)
        .finally(() => void qc.invalidateQueries({ queryKey: qk.template(patient.id) }));
      triggerFunction('run-flag-engine', { patient_id: patient.id });
      onDone();
    },
    onError: () => toast(nurseCopy.medFailed, 'error'),
  });
  const prn = watch('prn');
  const e = formState.errors;
  const classes = [...rules.drugClasses].sort((a, b) =>
    a.code === 'other' ? 1 : b.code === 'other' ? -1 : a.label.localeCompare(b.label),
  );
  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((v) => save.mutate(v))}
      noValidate
      data-testid="medication-form"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={nurseCopy.medForm.name} {...register('name')} error={e.name?.message} />
        <TextField label={nurseCopy.medForm.generic} {...register('generic_name')} />
        <SelectField
          label={nurseCopy.medForm.drugClass}
          hint={nurseCopy.medForm.drugClassHint}
          options={classes.map((c) => ({ value: c.code, label: c.label }))}
          {...register('drug_class')}
        />
        <TextField label={nurseCopy.medForm.purpose} {...register('purpose')} />
        <TextField
          label={nurseCopy.medForm.doseAmount}
          inputMode="decimal"
          {...register('dose_amount')}
          error={e.dose_amount?.message}
        />
        <TextField label={nurseCopy.medForm.doseUnit} {...register('dose_unit')} />
        <TextField label={nurseCopy.medForm.route} {...register('route')} />
        <TextField label={nurseCopy.medForm.frequency} {...register('frequency_label')} />
      </div>
      <CheckboxField label={nurseCopy.medForm.prn} {...register('prn')} />
      {!prn ? (
        <TextField
          label={nurseCopy.medForm.times}
          hint={nurseCopy.medForm.timesHint}
          {...register('times')}
          error={e.times?.message}
        />
      ) : null}
      <TextField label={nurseCopy.medForm.orderingClinician} {...register('prescriber_name')} />
      <div className="grid gap-4 sm:grid-cols-2">
        {med ? (
          <SelectField
            label={nurseCopy.medForm.changeType}
            options={(
              Object.keys(nurseCopy.changeTypes) as (keyof typeof nurseCopy.changeTypes)[]
            ).map((k) => ({ value: k, label: nurseCopy.changeTypes[k] }))}
            {...register('change_type')}
          />
        ) : null}
        <TextField
          label={nurseCopy.medForm.effectiveDate}
          type="date"
          max={addDays(today, 30)}
          {...register('effective_date')}
          error={e.effective_date?.message}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {common.cancel}
        </Button>
        <Button type="submit" busy={save.isPending}>
          {nurseCopy.medForm.save}
        </Button>
      </div>
    </form>
  );
}

function StopForm({ med, onDone }: { med: MedicationRow; onDone: () => void }) {
  const { timezone } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState(todayIn(timezone));
  const stop = useMutation({
    mutationFn: () => {
      const end = addDays(date, -1) < med.start_date ? med.start_date : addDays(date, -1);
      return changeMedication(med, { status: 'stopped', end_date: end }, 'stopped', date);
    },
    onSuccess: () => {
      toast(nurseCopy.medSaved);
      void qc.invalidateQueries({ queryKey: qk.medications(med.patient_id) });
      void qc.invalidateQueries({ queryKey: qk.changes(med.patient_id) });
      void regenerateTemplate(med.patient_id).catch(() => undefined);
      triggerFunction('run-flag-engine', { patient_id: med.patient_id });
      onDone();
    },
    onError: () => toast(nurseCopy.medFailed, 'error'),
  });
  return (
    <div className="space-y-4">
      <p>{nurseCopy.stopBody}</p>
      <TextField
        label={nurseCopy.medForm.effectiveDate}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {common.cancel}
        </Button>
        <Button variant="danger" busy={stop.isPending} onClick={() => stop.mutate()}>
          {nurseCopy.stop}
        </Button>
      </div>
    </div>
  );
}

function TemplatePanel({ patient, meds }: { patient: PatientRow; meds: MedicationRow[] }) {
  const { timezone } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useQuery({
    queryKey: qk.template(patient.id),
    queryFn: () => fetchActiveTemplate(patient.id),
  });
  const regen = useMutation({
    mutationFn: () => regenerateTemplate(patient.id, true),
    onSuccess: () => {
      toast(nurseCopy.regenerated);
      void qc.invalidateQueries({ queryKey: qk.template(patient.id) });
    },
    onError: () => toast(nurseCopy.regenerateFailed, 'error'),
  });
  const name = new Map(meds.map((m) => [m.id, m.name]));
  return (
    <Card
      title={nurseCopy.templateTitle}
      actions={
        <Button variant="secondary" busy={regen.isPending} onClick={() => regen.mutate()}>
          {nurseCopy.regenerate}
        </Button>
      }
    >
      <QueryState query={t}>
        {(tpl) =>
          !tpl ? (
            <p className="text-ink-muted">{nurseCopy.noTemplate}</p>
          ) : (
            <div className="space-y-2" data-testid="template-panel" data-source={tpl.source}>
              <div className="flex flex-wrap gap-2">
                <Pill tone={tpl.source === 'ai' ? 'info' : 'neutral'}>
                  {nurseCopy.templateSource[tpl.source]}
                </Pill>
                <span className="text-sm text-ink-muted">
                  {nurseCopy.templateMade(formatDateTime(tpl.created_at, timezone))}
                </span>
              </div>
              <ol className="list-decimal space-y-1 pl-6">
                {tpl.questions.map((q) => (
                  <li
                    key={q.symptom_code}
                    data-testid="template-question"
                    data-symptom={q.symptom_code}
                  >
                    <span className="font-semibold">{q.question_text}</span>{' '}
                    <span className="text-sm text-ink-muted">
                      {q.reason_medication_ids.length
                        ? nurseCopy.askedBecause(
                            q.reason_medication_ids
                              .map((id) => name.get(id) ?? '')
                              .filter(Boolean)
                              .join(', '),
                          )
                        : q.is_core
                          ? nurseCopy.core
                          : SYMPTOM_CATALOG.find((s) => s.code === q.symptom_code)?.label}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )
        }
      </QueryState>
    </Card>
  );
}

export function MedicationsTab({ patient }: { patient: PatientRow }) {
  const { timezone } = useMe();
  const today = todayIn(timezone);
  const meds = useQuery({
    queryKey: qk.medications(patient.id),
    queryFn: () => fetchMedications(patient.id),
  });
  const changes = useQuery({
    queryKey: qk.changes(patient.id),
    queryFn: () => fetchChanges(patient.id),
  });
  const [editing, setEditing] = useState<MedicationRow | 'new' | null>(null);
  const [stopping, setStopping] = useState<MedicationRow | null>(null);

  return (
    <div className="space-y-4">
      <QueryState query={meds}>
        {(list) => {
          const active = list.filter(
            (m) =>
              isMedicationActiveOn(m, today) || (m.status === 'active' && m.start_date > today),
          );
          const stopped = list.filter((m) => !active.includes(m));
          const name = new Map(list.map((m) => [m.id, m.name]));
          return (
            <>
              <Card
                title={nurseCopy.activeMeds}
                actions={
                  <Button onClick={() => setEditing('new')}>{nurseCopy.addMedication}</Button>
                }
              >
                {active.length ? (
                  <Table caption={nurseCopy.activeMeds}>
                    <thead>
                      <tr>
                        <th className={th}>{medsCopy.myMedicines}</th>
                        <th className={th}>{medsCopy.dose}</th>
                        <th className={th}>{medsCopy.when}</th>
                        <th className={th}>{nurseCopy.medForm.drugClass}</th>
                        <th className={th}>
                          <span className="sr-only">{nurseCopy.edit}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.map((m) => (
                        <tr key={m.id} data-testid="med-row">
                          <td className={td}>
                            <span className="font-semibold">{m.name}</span>
                            {m.purpose ? (
                              <span className="block text-sm text-ink-muted">{m.purpose}</span>
                            ) : null}
                          </td>
                          <td className={td}>{formatDose(m)}</td>
                          <td className={td}>
                            {m.prn
                              ? medsCopy.asNeeded
                              : m.schedule_times.map(formatClock).join(', ')}
                          </td>
                          <td className={td}>{classLabel(m.drug_class)}</td>
                          <td className={td}>
                            <div className="flex flex-wrap gap-1">
                              <Button variant="ghost" onClick={() => setEditing(m)}>
                                {nurseCopy.edit}
                              </Button>
                              <Button variant="ghost" onClick={() => setStopping(m)}>
                                {nurseCopy.stop}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <EmptyState title={nurseCopy.noMeds} />
                )}
                {stopped.length ? (
                  <details className="mt-3">
                    <summary className="min-h-touch cursor-pointer py-2 font-semibold">
                      {nurseCopy.stoppedMeds}
                    </summary>
                    <ul className="space-y-1">
                      {stopped.map((m) => (
                        <li key={m.id}>
                          {m.name} <Pill>{medsCopy.stopped}</Pill>{' '}
                          {m.end_date ? formatDate(m.end_date) : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </Card>
              <TemplatePanel patient={patient} meds={list} />
              <Card title={nurseCopy.history}>
                <QueryState
                  query={changes}
                  isEmpty={(c) => c.length === 0}
                  empty={<p className="text-ink-muted">{nurseCopy.noHistory}</p>}
                >
                  {(rows) => (
                    <Table caption={nurseCopy.history}>
                      <thead>
                        <tr>
                          <th className={th}>{nurseCopy.medForm.effectiveDate}</th>
                          <th className={th}>{medsCopy.myMedicines}</th>
                          <th className={th}>{nurseCopy.medForm.changeType}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 50).map((c) => (
                          <tr key={c.id}>
                            <td className={td}>{formatDate(c.effective_date)}</td>
                            <td className={td}>{name.get(c.medication_id)}</td>
                            <td className={td}>{flagCopy.changeLabel[c.change_type]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </QueryState>
              </Card>
            </>
          );
        }}
      </QueryState>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? nurseCopy.addMedication : nurseCopy.editMedication}
      >
        {editing ? (
          <MedicationForm
            patient={patient}
            med={editing === 'new' ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Modal>
      <Modal
        open={stopping !== null}
        onClose={() => setStopping(null)}
        title={nurseCopy.stopMedication}
      >
        {stopping ? <StopForm med={stopping} onDone={() => setStopping(null)} /> : null}
      </Modal>
    </div>
  );
}
