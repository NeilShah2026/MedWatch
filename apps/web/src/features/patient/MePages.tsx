import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMe } from '@/app/AuthProvider';
import { fetchLogForDay } from '@/lib/api/symptoms';
import { qk } from '@/lib/queryKeys';
import { todayIn } from '@/lib/format';
import type { PatientRow } from '@/lib/types';
import { patientCopy } from '@/copy/patient';
import { checkinCopy } from '@/copy/checkin';
import { medsCopy } from '@/copy/meds';
import { doseCopy } from '@/copy/doses';
import { PageHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState } from '@/components/ui/States';
import { TodayDoses } from '@/features/doses/TodayDoses';
import { CheckinFlow } from '@/features/symptoms/CheckinFlow';
import { MedicineList } from '@/features/meds/MedicineList';
import { LatestSummary } from '@/features/summary/LatestSummary';
import { useSelfPatient } from '@/features/patients/hooks';

function WithSelf({ children }: { children: (p: PatientRow) => React.ReactNode }) {
  const { profile } = useMe();
  const q = useSelfPatient(profile.id);
  return (
    <QueryState query={q} isEmpty={(p) => !p} empty={<EmptyState title={patientCopy.notLinked} />}>
      {(p) => <>{children(p!)}</>}
    </QueryState>
  );
}

function CheckinCta({ patient }: { patient: PatientRow }) {
  const { timezone } = useMe();
  const today = todayIn(timezone);
  const log = useQuery({
    queryKey: qk.symptomLogDay(patient.id, today),
    queryFn: () => fetchLogForDay(patient.id, today),
  });
  const done = Boolean(log.data);
  return (
    <Link
      to="/me/checkin"
      className={`flex min-h-touch w-full items-center justify-center rounded-2xl px-4 py-4 text-lg font-semibold shadow-card transition ${done ? 'border border-primary/50 bg-surface text-primary hover:bg-primary-light' : 'bg-accent text-ink hover:brightness-95'}`}
    >
      {done ? patientCopy.checkinDoneCta : patientCopy.checkinCta}
    </Link>
  );
}

export function MeTodayPage() {
  return (
    <WithSelf>
      {(p) => (
        <div className="mx-auto max-w-2xl space-y-6">
          <PageHeader title={patientCopy.greeting(p.first_name)} subtitle={doseCopy.todayTitle} />
          <CheckinCta patient={p} />
          <TodayDoses patient={p} mode="patient" />
          <section>
            <h2 className="mb-3 text-xl font-bold">{patientCopy.summaryTitle}</h2>
            <LatestSummary patient={p} />
          </section>
        </div>
      )}
    </WithSelf>
  );
}

export function MeCheckinPage() {
  return (
    <WithSelf>
      {(p) => (
        <div className="mx-auto max-w-2xl space-y-6">
          <PageHeader title={checkinCopy.title} subtitle={checkinCopy.intro} />
          <CheckinFlow patient={p} mode="patient" />
        </div>
      )}
    </WithSelf>
  );
}

export function MeMedicinesPage() {
  return (
    <WithSelf>
      {(p) => (
        <div className="mx-auto max-w-2xl space-y-6">
          <PageHeader title={medsCopy.myMedicines} />
          <MedicineList patient={p} />
        </div>
      )}
    </WithSelf>
  );
}
