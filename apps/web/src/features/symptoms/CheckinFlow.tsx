import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SYMPTOM_CATALOG,
  buildRulesCheckin,
  orderForDisplay,
  type CheckinQuestion,
  type SymptomEntry,
} from '@medwatch/core';
import { fetchActiveTemplate } from '@/lib/api/templates';
import { fetchMedications } from '@/lib/api/meds';
import { fetchLogForDay, saveLog } from '@/lib/api/symptoms';
import { triggerFunction } from '@/lib/functions';
import { qk } from '@/lib/queryKeys';
import { rules } from '@/lib/rules';
import { todayIn } from '@/lib/format';
import type { PatientRow, SymptomLogRow } from '@/lib/types';
import { checkinCopy } from '@/copy/checkin';
import { common } from '@/copy/common';
import { useMe } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/Field';
import { ErrorState, Loading } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';

type Step =
  | { kind: 'feeling' }
  | { kind: 'question'; index: number }
  | { kind: 'extra' }
  | { kind: 'note' }
  | { kind: 'done' };

function SeverityButtons({
  value,
  onPick,
  name,
}: {
  value: number;
  onPick: (n: 1 | 2 | 3) => void;
  name: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`${checkinCopy.howMuch} ${name}`}
      className="grid grid-cols-3 gap-2"
    >
      {checkinCopy.severity.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const selected = value === n;
        return (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onPick(n)}
            className={`min-h-touch rounded-xl border-2 px-2 py-3 font-semibold ${selected ? 'border-primary bg-primary text-white' : 'border-line bg-surface hover:border-primary'}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The 30-second daily check-in (spec §10). Questions come from the patient's active tailored
 * template (core first). If no template exists yet, the rules builder runs in the browser.
 * Each "Yes" records severity 1–3 and each "No" records 0, so symptom_logs.entries keeps the
 * shape the flag engine expects. Patients never see which medicine a question relates to.
 */
export function CheckinFlow({
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
  const first = patient.first_name;
  const template = useQuery({
    queryKey: qk.template(patient.id),
    queryFn: () => fetchActiveTemplate(patient.id),
  });
  const meds = useQuery({
    queryKey: qk.medications(patient.id),
    queryFn: () => fetchMedications(patient.id),
  });
  const existing = useQuery({
    queryKey: qk.symptomLogDay(patient.id, today),
    queryFn: () => fetchLogForDay(patient.id, today),
  });

  const questions: CheckinQuestion[] = useMemo(() => {
    if (template.data?.questions?.length) return orderForDisplay(template.data.questions);
    if (meds.data) return buildRulesCheckin(meds.data, SYMPTOM_CATALOG, rules, today);
    return [];
  }, [template.data, meds.data, today]);

  const [step, setStep] = useState<Step | null>(null);
  const [feeling, setFeeling] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [yesPending, setYesPending] = useState<string | null>(null);
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  const prefill = (log: SymptomLogRow) => {
    const asked = new Set(questions.map((q) => q.symptom_code));
    setFeeling(log.overall_feeling);
    setAnswers(
      Object.fromEntries(
        log.entries
          .filter((e) => asked.has(e.symptom_code))
          .map((e) => [e.symptom_code, e.severity]),
      ),
    );
    setExtras(
      Object.fromEntries(
        log.entries
          .filter((e) => !asked.has(e.symptom_code) && e.severity > 0)
          .map((e) => [e.symptom_code, e.severity]),
      ),
    );
    setNote(log.free_text ?? '');
  };

  useEffect(() => {
    if (step === null && existing.isSuccess && questions.length)
      setStep(existing.data ? { kind: 'done' } : { kind: 'feeling' });
  }, [step, existing.isSuccess, existing.data, questions.length]);

  useEffect(() => {
    heading.current?.focus();
  }, [step, yesPending]);

  const save = useMutation({
    mutationFn: async () => {
      const entries: SymptomEntry[] = [
        ...questions.map((q) => ({
          symptom_code: q.symptom_code,
          severity: answers[q.symptom_code] ?? 0,
        })),
        ...Object.entries(extras)
          .filter(([, s]) => s > 0)
          .map(([symptom_code, severity]) => ({ symptom_code, severity })),
      ];
      await saveLog({
        organization_id: patient.organization_id,
        patient_id: patient.id,
        logged_for_date: today,
        entries,
        overall_feeling: feeling,
        free_text: note.trim() || null,
      });
    },
    onSuccess: () => {
      triggerFunction('run-flag-engine', { patient_id: patient.id });
      void qc.invalidateQueries({ queryKey: qk.symptomLogDay(patient.id, today) });
      void qc.invalidateQueries({ queryKey: ['overview'] });
      setStep({ kind: 'done' });
    },
    onError: () => toast(checkinCopy.failed, 'error'),
  });

  if (template.isLoading || meds.isLoading || existing.isLoading || step === null) {
    if (template.isError || meds.isError || existing.isError)
      return <ErrorState onRetry={() => void existing.refetch()} />;
    return <Loading />;
  }

  const total = questions.length;
  const catalogExtra = SYMPTOM_CATALOG.filter(
    (s) => !questions.some((q) => q.symptom_code === s.code),
  );
  const goQuestion = (i: number) =>
    setStep(i < total ? { kind: 'question', index: i } : { kind: 'extra' });

  if (step.kind === 'done') {
    const log = existing.data;
    const reported = [
      ...questions.map((q) => ({ code: q.symptom_code, sev: answers[q.symptom_code] ?? 0 })),
      ...Object.entries(extras).map(([code, sev]) => ({ code, sev })),
    ]
      .filter((x) => x.sev > 0)
      .map((x) => SYMPTOM_CATALOG.find((s) => s.code === x.code)?.label ?? x.code);
    const fromLog = log
      ? log.entries
          .filter((e) => e.severity > 0)
          .map(
            (e) => SYMPTOM_CATALOG.find((s) => s.code === e.symptom_code)?.label ?? e.symptom_code,
          )
      : [];
    const shown = save.isSuccess ? reported : fromLog;
    return (
      <div className="card space-y-4 text-center" data-testid="checkin-done">
        <h2 ref={heading} tabIndex={-1} className="text-2xl font-bold">
          {save.isSuccess ? checkinCopy.thanks : checkinCopy.alreadyDone}
        </h2>
        {save.isSuccess ? (
          <p>{mode === 'patient' ? checkinCopy.thanksBody : checkinCopy.thanksBodyFor(first)}</p>
        ) : null}
        <p className="font-semibold">
          {shown.length
            ? `${checkinCopy.youReported} ${shown.join(', ')}`
            : checkinCopy.nothingReported}
        </p>
        <p className="text-ink-muted">{checkinCopy.callNote}</p>
        <Button
          variant="secondary"
          onClick={() => {
            if (log && !save.isSuccess) prefill(log);
            setStep({ kind: 'feeling' });
          }}
        >
          {checkinCopy.editToday}
        </Button>
      </div>
    );
  }

  const progress = step.kind === 'question' ? checkinCopy.stepOf(step.index + 1, total) : null;

  return (
    <div className="card mx-auto max-w-xl space-y-5" data-testid="checkin-flow">
      {progress ? <p className="text-sm font-semibold text-ink-muted">{progress}</p> : null}

      {step.kind === 'feeling' ? (
        <>
          <h2 ref={heading} tabIndex={-1} className="text-2xl font-bold">
            {mode === 'patient'
              ? checkinCopy.feelingQuestion
              : checkinCopy.feelingQuestionFor(first)}
          </h2>
          <div
            role="radiogroup"
            aria-label={checkinCopy.feelingQuestion}
            className="grid grid-cols-5 gap-2"
          >
            {checkinCopy.feelings.map((label, i) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={feeling === i + 1}
                onClick={() => {
                  setFeeling(i + 1);
                  goQuestion(0);
                }}
                className={`flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-xl border-2 p-2 ${feeling === i + 1 ? 'border-primary bg-primary-light' : 'border-line hover:border-primary'}`}
              >
                <span aria-hidden="true" className="text-4xl">
                  {checkinCopy.feelingFaces[i]}
                </span>
                <span className="text-sm font-semibold">{label}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {step.kind === 'question'
        ? (() => {
            const q = questions[step.index]!;
            const asking = yesPending === q.symptom_code;
            return (
              <>
                <h2
                  ref={heading}
                  tabIndex={-1}
                  className="text-2xl font-bold"
                  data-testid="checkin-question"
                  data-symptom={q.symptom_code}
                >
                  {asking ? checkinCopy.howMuch : q.question_text}
                </h2>
                {!asking && q.help_text ? <p className="text-ink-muted">{q.help_text}</p> : null}
                {asking ? (
                  <SeverityButtons
                    name={q.question_text}
                    value={answers[q.symptom_code] ?? 0}
                    onPick={(n) => {
                      setAnswers((a) => ({ ...a, [q.symptom_code]: n }));
                      setYesPending(null);
                      goQuestion(step.index + 1);
                    }}
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      size="lg"
                      onClick={() => setYesPending(q.symptom_code)}
                      aria-pressed={(answers[q.symptom_code] ?? 0) > 0}
                    >
                      {common.yes}
                    </Button>
                    <Button
                      size="lg"
                      variant="secondary"
                      aria-pressed={answers[q.symptom_code] === 0}
                      onClick={() => {
                        setAnswers((a) => ({ ...a, [q.symptom_code]: 0 }));
                        goQuestion(step.index + 1);
                      }}
                    >
                      {common.no}
                    </Button>
                  </div>
                )}
              </>
            );
          })()
        : null}

      {step.kind === 'extra' ? (
        <>
          <h2 ref={heading} tabIndex={-1} className="text-2xl font-bold">
            {mode === 'patient' ? checkinCopy.anythingElse : checkinCopy.anythingElseFor(first)}
          </h2>
          <p className="text-ink-muted">{checkinCopy.pickAny}</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {catalogExtra.map((s) => {
              const sev = extras[s.code] ?? 0;
              return (
                <li
                  key={s.code}
                  className={`rounded-xl border-2 p-2 ${sev ? 'border-primary bg-primary-light' : 'border-line'}`}
                >
                  <button
                    type="button"
                    aria-pressed={sev > 0}
                    onClick={() => setExtras((x) => ({ ...x, [s.code]: sev ? 0 : 1 }))}
                    className="flex min-h-touch w-full items-center justify-between rounded-lg px-2 text-left font-semibold"
                  >
                    {s.label}
                  </button>
                  {sev ? (
                    <SeverityButtons
                      name={s.label}
                      value={sev}
                      onPick={(n) => setExtras((x) => ({ ...x, [s.code]: n }))}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
          <Button block size="lg" onClick={() => setStep({ kind: 'note' })}>
            {checkinCopy.next}
          </Button>
        </>
      ) : null}

      {step.kind === 'note' ? (
        <>
          <h2 ref={heading} tabIndex={-1} className="sr-only">
            {checkinCopy.noteLabel}
          </h2>
          <TextAreaField
            label={checkinCopy.noteLabel}
            hint={checkinCopy.noteHint}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button block size="lg" busy={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? checkinCopy.sending : checkinCopy.submit}
          </Button>
        </>
      ) : null}

      <div className="flex justify-between">
        <Button
          variant="ghost"
          onClick={() => {
            setYesPending(null);
            if (step.kind === 'question')
              setStep(
                step.index === 0
                  ? { kind: 'feeling' }
                  : { kind: 'question', index: step.index - 1 },
              );
            else if (step.kind === 'extra')
              setStep(total ? { kind: 'question', index: total - 1 } : { kind: 'feeling' });
            else if (step.kind === 'note') setStep({ kind: 'extra' });
          }}
          disabled={step.kind === 'feeling'}
        >
          {checkinCopy.back}
        </Button>
        {step.kind === 'feeling' && feeling ? (
          <Button variant="ghost" onClick={() => goQuestion(0)}>
            {checkinCopy.next}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
