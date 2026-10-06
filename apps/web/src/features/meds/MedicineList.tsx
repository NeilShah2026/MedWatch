import { useQuery } from '@tanstack/react-query';
import { formatDose, isMedicationActiveOn } from '@medwatch/core';
import { fetchMedications } from '@/lib/api/meds';
import { qk } from '@/lib/queryKeys';
import { formatClock, todayIn } from '@/lib/format';
import type { PatientRow } from '@/lib/types';
import { medsCopy } from '@/copy/meds';
import { useMe } from '@/app/AuthProvider';
import { EmptyState, QueryState } from '@/components/ui/States';
import { IconPill } from '@/components/ui/icons';

/** Simple, read-only medicine list for patients and caregivers. */
export function MedicineList({ patient }: { patient: PatientRow }) {
  const { timezone } = useMe();
  const today = todayIn(timezone);
  const meds = useQuery({
    queryKey: qk.medications(patient.id),
    queryFn: () => fetchMedications(patient.id),
  });
  return (
    <QueryState
      query={meds}
      isEmpty={(m) => !m.some((x) => isMedicationActiveOn(x, today))}
      empty={<EmptyState title={medsCopy.none} />}
    >
      {(list) => (
        <div className="space-y-3">
          <ul className="space-y-3">
            {list
              .filter((m) => isMedicationActiveOn(m, today))
              .map((m) => (
                <li key={m.id} className="card flex items-start gap-3" data-testid="medicine-row">
                  <span className="mt-1 rounded-full bg-primary-light p-2 text-primary">
                    <IconPill />
                  </span>
                  <div>
                    <p className="text-xl font-bold">{m.name}</p>
                    {m.purpose ? <p>{medsCopy.forWhat(m.purpose)}</p> : null}
                    <p className="text-ink-muted">
                      {formatDose(m)}
                      {formatDose(m) ? ' · ' : ''}
                      {m.prn ? medsCopy.asNeeded : m.schedule_times.map(formatClock).join(', ')}
                    </p>
                  </div>
                </li>
              ))}
          </ul>
          <p className="text-ink-muted">{medsCopy.readOnlyNote}</p>
        </div>
      )}
    </QueryState>
  );
}
