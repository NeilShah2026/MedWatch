/**
 * Pure planning functions for the background jobs (spec §8). Each takes current state and
 * returns the actions to apply; applying them and planning again yields no new actions,
 * which is how every job stays idempotent ("safe to run twice").
 */
import {
  SEVERITY_RANK,
  addDays,
  evaluateMissedDoses,
  generateExpectedDoses,
  isMedicationActiveOn,
  localDate,
  zonedParts,
  type DoseDraft,
  type DoseEvent,
  type Medication,
  type OrgSettings,
  type Severity,
} from '../../../../packages/core/src/index.ts';

export type AlertType = 'missed_dose' | 'flag' | 'escalation';

export interface AlertDraft {
  organization_id: string;
  patient_id: string;
  recipient_profile_id: string;
  alert_type: AlertType;
  related_id: string;
}

export interface ExistingAlert {
  recipient_profile_id: string;
  alert_type: AlertType;
  related_id: string | null;
}

export const alertKey = (a: {
  recipient_profile_id: string;
  alert_type: string;
  related_id: string | null;
}) => `${a.recipient_profile_id}|${a.alert_type}|${a.related_id ?? ''}`;

// ------------------------------------------------------------------ generate-doses

/** The hourly job acts on an organization in the hour after its local midnight. */
export function isLocalMidnightHour(timezone: string, now: Date): boolean {
  return zonedParts(now, timezone).hour === 0;
}

/** Today's and tomorrow's expected doses that do not exist yet. */
export function planDoseGeneration(
  medications: readonly Medication[],
  timezone: string,
  now: Date,
  existing: ReadonlySet<string>,
): DoseDraft[] {
  const today = localDate(now, timezone);
  return [today, addDays(today, 1)]
    .flatMap((d) => generateExpectedDoses(medications, d, timezone))
    .filter((d) => !existing.has(`${d.medication_id}|${new Date(d.scheduled_for).toISOString()}`));
}

// ------------------------------------------------------------------ check-missed-doses

export interface CareTeam {
  /** caregivers linked to the patient (receive missed-dose alerts) */
  caregivers: string[];
  /** primary nurse + caseload nurses (receive escalations and flag alerts) */
  nurses: string[];
}

export interface MissedPlanInput {
  doses: readonly DoseEvent[];
  medications: readonly Medication[];
  organizationId: string;
  timezone: string;
  settings: Pick<OrgSettings, 'missed_dose_grace_minutes' | 'agency_escalation_minutes'>;
  teams: ReadonlyMap<string, CareTeam>;
  admins: readonly string[];
  existingAlerts: readonly ExistingAlert[];
  now: Date;
}

export interface MissedPlan {
  markMissed: string[];
  /** Pending doses for medicines no longer active that day → skipped ("Medicine stopped"). */
  markStopped: string[];
  alerts: AlertDraft[];
}

export function planMissedDoses(input: MissedPlanInput): MissedPlan {
  const meds = new Map(input.medications.map((m) => [m.id, m]));
  const markStopped: string[] = [];
  const live: DoseEvent[] = [];
  for (const d of input.doses) {
    const med = meds.get(d.medication_id);
    const day = localDate(d.scheduled_for, input.timezone);
    if (d.status === 'pending' && (!med || !isMedicationActiveOn(med, day))) markStopped.push(d.id);
    else live.push(d);
  }
  // Per-recipient dedupe happens below; evaluate with no prior alerts so every recipient is considered.
  const ev = evaluateMissedDoses(live, input.now, input.settings);
  const existing = new Set(input.existingAlerts.map(alertKey));
  const byId = new Map(live.map((d) => [d.id, d]));
  const alerts: AlertDraft[] = [];
  const push = (doseId: string, type: AlertType, recipients: readonly string[]) => {
    const d = byId.get(doseId)!;
    for (const r of new Set(recipients)) {
      const a: AlertDraft = {
        organization_id: input.organizationId,
        patient_id: d.patient_id,
        recipient_profile_id: r,
        alert_type: type,
        related_id: doseId,
      };
      if (!existing.has(alertKey(a))) {
        existing.add(alertKey(a));
        alerts.push(a);
      }
    }
  };
  for (const id of ev.caregiverAlerts)
    push(id, 'missed_dose', input.teams.get(byId.get(id)!.patient_id)?.caregivers ?? []);
  for (const id of ev.escalations)
    push(id, 'escalation', [
      ...(input.teams.get(byId.get(id)!.patient_id)?.nurses ?? []),
      ...input.admins,
    ]);
  return { markMissed: ev.markMissed, markStopped, alerts };
}

// ------------------------------------------------------------------ run-flag-engine

export interface NewFlagRef {
  id: string;
  organization_id: string;
  patient_id: string;
  severity: Severity;
}

/** Alerts for newly created (or upgraded) flags at or above the org threshold. */
export function planFlagAlerts(
  flags: readonly NewFlagRef[],
  threshold: Severity,
  teams: ReadonlyMap<string, CareTeam>,
  existingAlerts: readonly ExistingAlert[],
): AlertDraft[] {
  const existing = new Set(existingAlerts.map(alertKey));
  const out: AlertDraft[] = [];
  for (const f of flags) {
    if (SEVERITY_RANK[f.severity] < SEVERITY_RANK[threshold]) continue;
    for (const r of new Set(teams.get(f.patient_id)?.nurses ?? [])) {
      const a: AlertDraft = {
        organization_id: f.organization_id,
        patient_id: f.patient_id,
        recipient_profile_id: r,
        alert_type: 'flag',
        related_id: f.id,
      };
      if (!existing.has(alertKey(a))) {
        existing.add(alertKey(a));
        out.push(a);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ send-alert

export interface RecipientInfo {
  id: string;
  phone: string | null;
  sms_opt_in: boolean;
}

export interface DeliveryPlan {
  inApp: AlertDraft[];
  /** SMS only when the recipient opted in, has a phone, and the patient has an active SMS consent. */
  sms: (AlertDraft & { phone: string })[];
}

export function planDeliveries(
  alerts: readonly AlertDraft[],
  recipients: ReadonlyMap<string, RecipientInfo>,
  patientsWithSmsConsent: ReadonlySet<string>,
  existingAlerts: readonly (ExistingAlert & { channel: 'in_app' | 'sms' })[] = [],
): DeliveryPlan {
  const have = new Set(existingAlerts.map((a) => `${a.channel}|${alertKey(a)}`));
  const inApp = alerts.filter((a) => !have.has(`in_app|${alertKey(a)}`));
  const sms = alerts
    .filter((a) => {
      const r = recipients.get(a.recipient_profile_id);
      return (
        r?.sms_opt_in &&
        r.phone &&
        patientsWithSmsConsent.has(a.patient_id) &&
        !have.has(`sms|${alertKey(a)}`)
      );
    })
    .map((a) => ({ ...a, phone: recipients.get(a.recipient_profile_id)!.phone! }));
  return { inApp, sms };
}
