import type {
  ChangeType,
  DoseEvent,
  DoseStatus,
  Medication,
  MedicationChange,
  SymptomEntry,
  SymptomLog,
} from '../src/types.ts';
import { dateRange, zonedTimeToUtc } from '../src/time.ts';
import { getBundledRules } from '../src/rules/bundled.ts';

export const TZ = 'America/New_York';
export const ORG = 'org-1';
export const PAT = 'pat-1';
export const patient = { id: PAT, organization_id: ORG };
export const rules = getBundledRules();
export const settings = { flag_dedupe_hours: 72 };

export function med(id: string, o: Partial<Medication> = {}): Medication {
  return {
    id,
    organization_id: ORG,
    patient_id: PAT,
    name: `Med ${id}`,
    drug_class: 'other',
    schedule_times: ['08:00'],
    prn: false,
    start_date: '2026-01-01',
    end_date: null,
    status: 'active',
    dose_amount: 10,
    dose_unit: 'mg',
    ...o,
  };
}

export function change(
  id: string,
  medication_id: string,
  change_type: ChangeType,
  effective_date: string,
  o: Partial<MedicationChange> = {},
): MedicationChange {
  return { id, patient_id: PAT, medication_id, change_type, effective_date, ...o };
}

/** Doses for each day in [from, to] at the given local times; status chosen per dose index. */
export function doses(
  medication_id: string,
  from: string,
  to: string,
  times: string[] = ['08:00'],
  status: (i: number, date: string) => DoseStatus = () => 'given',
): DoseEvent[] {
  const out: DoseEvent[] = [];
  let i = 0;
  for (const date of dateRange(from, to)) {
    for (const t of times) {
      out.push({
        id: `dose-${medication_id}-${date}-${t}`,
        patient_id: PAT,
        medication_id,
        scheduled_for: zonedTimeToUtc(date, t, TZ).toISOString(),
        status: status(i, date),
      });
      i++;
    }
  }
  return out;
}

export function log(date: string, entries: Record<string, number> = {}): SymptomLog {
  const list: SymptomEntry[] = Object.entries(entries).map(([symptom_code, severity]) => ({
    symptom_code,
    severity,
  }));
  return { id: `log-${date}`, patient_id: PAT, logged_for_date: date, entries: list };
}

/** Empty logs (check-in done, nothing reported) for each day in the range. */
export function quietLogs(from: string, to: string): SymptomLog[] {
  return dateRange(from, to).map((d) => log(d));
}
