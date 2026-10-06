import type { Medication } from './types.ts';

/** Active on a calendar day: started, not ended, and not stopped without an end date. */
export function isMedicationActiveOn(m: Medication, date: string): boolean {
  if (m.start_date > date) return false;
  if (m.end_date && m.end_date < date) return false;
  if (m.status === 'stopped' && !m.end_date) return false;
  return true;
}

export function formatDose(m: Pick<Medication, 'dose_amount' | 'dose_unit'>): string {
  if (m.dose_amount === null || m.dose_amount === undefined || m.dose_amount === '') return '';
  return `${m.dose_amount}${m.dose_unit ? ` ${m.dose_unit}` : ''}`;
}
