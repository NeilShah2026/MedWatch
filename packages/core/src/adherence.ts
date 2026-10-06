import type { DoseEvent, IsoDate, Medication } from './types.ts';
import type { OrgSettings } from './settings.ts';
import { isMedicationActiveOn } from './medications.ts';
import { toInstant, zonedTimeToUtc } from './time.ts';

const MINUTE = 60_000;

export interface DoseDraft {
  organization_id: string;
  patient_id: string;
  medication_id: string;
  scheduled_for: string; // ISO instant
  status: 'pending';
}

/**
 * Expected doses for one calendar day in the organization's timezone.
 * Skips PRN medicines and respects start_date / end_date (inclusive).
 * Wall-clock times are converted DST-safely (see zonedTimeToUtc).
 */
export function generateExpectedDoses(
  medications: readonly Medication[],
  date: IsoDate,
  timezone: string,
): DoseDraft[] {
  const drafts: DoseDraft[] = [];
  for (const m of medications) {
    if (m.prn || !isMedicationActiveOn(m, date)) continue;
    const seen = new Set<string>();
    for (const time of m.schedule_times ?? []) {
      const at = zonedTimeToUtc(date, time, timezone).toISOString();
      if (seen.has(at)) continue;
      seen.add(at);
      drafts.push({
        organization_id: m.organization_id,
        patient_id: m.patient_id,
        medication_id: m.id,
        scheduled_for: at,
        status: 'pending',
      });
    }
  }
  return drafts.sort(
    (a, b) =>
      a.scheduled_for.localeCompare(b.scheduled_for) ||
      a.medication_id.localeCompare(b.medication_id),
  );
}

export interface ExistingAlertRef {
  related_id: string | null;
  alert_type: 'missed_dose' | 'flag' | 'escalation';
}

export interface MissedDoseEvaluation {
  /** Pending doses past scheduled_for + grace → mark `missed`. */
  markMissed: string[];
  /** Missed (or about to be) doses whose caregivers have not yet been alerted. */
  caregiverAlerts: string[];
  /** Still unconfirmed past scheduled_for + agency_escalation_minutes and not yet escalated. */
  escalations: string[];
}

export interface MissedDoseOptions {
  /** Ignore doses older than this when sending alerts (default 24h) so history never re-alerts. */
  alertLookbackHours?: number;
  existingAlerts?: readonly ExistingAlertRef[];
}

export function evaluateMissedDoses(
  doseEvents: readonly DoseEvent[],
  now: Date | string,
  settings: Pick<OrgSettings, 'missed_dose_grace_minutes' | 'agency_escalation_minutes'>,
  options: MissedDoseOptions = {},
): MissedDoseEvaluation {
  const t = toInstant(now);
  const grace = settings.missed_dose_grace_minutes * MINUTE;
  const escalate = settings.agency_escalation_minutes * MINUTE;
  const lookback = (options.alertLookbackHours ?? 24) * 60 * MINUTE;
  const alerted = new Set(
    (options.existingAlerts ?? []).map((a) => `${a.alert_type}:${a.related_id ?? ''}`),
  );

  const out: MissedDoseEvaluation = { markMissed: [], caregiverAlerts: [], escalations: [] };
  const sorted = [...doseEvents].sort(
    (a, b) => a.scheduled_for.localeCompare(b.scheduled_for) || a.id.localeCompare(b.id),
  );
  for (const d of sorted) {
    const due = toInstant(d.scheduled_for);
    const unconfirmed = d.status === 'pending' || d.status === 'missed';
    if (!unconfirmed) continue;
    const pastGrace = t >= due + grace;
    if (d.status === 'pending' && pastGrace) out.markMissed.push(d.id);
    const recent = t - due <= lookback;
    if (pastGrace && recent && !alerted.has(`missed_dose:${d.id}`)) out.caregiverAlerts.push(d.id);
    if (t >= due + escalate && recent && !alerted.has(`escalation:${d.id}`)) {
      out.escalations.push(d.id);
    }
  }
  return out;
}

export interface AdherenceResult {
  /** given ÷ (given + missed + refused + skipped-without-note); null when nothing to count. */
  rate: number | null;
  given: number;
  missed: number;
  refused: number;
  skipped: number;
  /** skipped doses that carry a note — excluded from the rate */
  excused: number;
  /** past doses still pending (not yet evaluated) — excluded */
  unresolved: number;
  /** denominator */
  total: number;
  /** Adherence is caregiver/patient-reported (spec §7.2). */
  label: 'reported';
}

/**
 * Adherence over [start, end) for doses already due at `now`.
 * Future doses and still-pending doses are excluded; `skipped` with a note is excused;
 * `skipped` without a note counts against adherence.
 */
export function adherenceRate(
  doseEvents: readonly DoseEvent[],
  period: { start: Date | string; end: Date | string },
  now: Date | string = new Date(),
): AdherenceResult {
  const s = toInstant(period.start);
  const e = toInstant(period.end);
  const n = toInstant(now);
  const r: AdherenceResult = {
    rate: null,
    given: 0,
    missed: 0,
    refused: 0,
    skipped: 0,
    excused: 0,
    unresolved: 0,
    total: 0,
    label: 'reported',
  };
  for (const d of doseEvents) {
    const t = toInstant(d.scheduled_for);
    if (t < s || t >= e || t > n) continue;
    switch (d.status) {
      case 'given':
        r.given++;
        break;
      case 'missed':
        r.missed++;
        break;
      case 'refused':
        r.refused++;
        break;
      case 'skipped':
        if (d.note && d.note.trim()) r.excused++;
        else r.skipped++;
        break;
      case 'pending':
        r.unresolved++;
        break;
    }
  }
  r.total = r.given + r.missed + r.refused + r.skipped;
  r.rate = r.total ? r.given / r.total : null;
  return r;
}

/** Statuses that count as "resolved" for adherence math. */
export function isCountedDose(d: DoseEvent): boolean {
  return (
    d.status === 'given' ||
    d.status === 'missed' ||
    d.status === 'refused' ||
    (d.status === 'skipped' && !(d.note && d.note.trim()))
  );
}

/** Longest run of consecutive `missed` doses (chronological). */
export function longestMissedRun(doses: readonly DoseEvent[]): number {
  let best = 0;
  let run = 0;
  for (const d of [...doses].sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))) {
    if (d.status === 'missed') {
      run++;
      best = Math.max(best, run);
    } else if (isCountedDose(d)) {
      run = 0;
    }
  }
  return best;
}
