/**
 * Supabase I/O around the pure planners. Used by the Edge Functions (service role).
 * Every write is idempotent: unique constraints (doses, alerts, active flags) back up the
 * planners' own dedupe, and conflicts are ignored.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addDays,
  getBundledRules,
  localDate,
  resolveOrgSettings,
  runFlagEngine,
  type DoseEvent,
  type ExistingFlag,
  type Medication,
  type MedicationChange,
  type OrgSettings,
  type SymptomLog,
} from '../../../../packages/core/src/index.ts';
import { fnLog } from '../logger.ts';
import { SMS_BODY, type SmsProvider } from '../sms/index.ts';
import {
  isLocalMidnightHour,
  planDeliveries,
  planDoseGeneration,
  planFlagAlerts,
  planMissedDoses,
  type AlertDraft,
  type CareTeam,
  type ExistingAlert,
  type NewFlagRef,
} from './planners.ts';

const PAGE = 1000;

/** Page through a PostgREST query (default max rows is 1000). */
export async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error('select_failed');
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

interface Org {
  id: string;
  timezone: string;
  settings: OrgSettings;
}

export async function loadOrgs(db: SupabaseClient): Promise<Org[]> {
  const { data } = await db.from('organizations').select('id, timezone, settings');
  return (data ?? []).map((o) => ({
    id: o.id,
    timezone: o.timezone,
    settings: resolveOrgSettings(o.settings),
  }));
}

const MED_COLS =
  'id, organization_id, patient_id, name, generic_name, drug_class, dose_amount, dose_unit, schedule_times, prn, start_date, end_date, status';

export async function loadCareTeams(
  db: SupabaseClient,
  orgId: string,
): Promise<{ teams: Map<string, CareTeam>; admins: string[] }> {
  const [patients, caseload, links, admins] = await Promise.all([
    selectAll<{ id: string; primary_nurse_id: string | null }>((a, b) =>
      db.from('patients').select('id, primary_nurse_id').eq('organization_id', orgId).range(a, b),
    ),
    selectAll<{ patient_id: string; nurse_id: string }>((a, b) =>
      db
        .from('caseload_assignments')
        .select('patient_id, nurse_id')
        .eq('organization_id', orgId)
        .range(a, b),
    ),
    selectAll<{ patient_id: string; profile_id: string; relationship: string }>((a, b) =>
      db
        .from('patient_links')
        .select('patient_id, profile_id, relationship')
        .eq('organization_id', orgId)
        .range(a, b),
    ),
    selectAll<{ id: string }>((a, b) =>
      db
        .from('profiles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('role', 'agency_admin')
        .eq('is_active', true)
        .range(a, b),
    ),
  ]);
  const teams = new Map<string, CareTeam>();
  for (const p of patients)
    teams.set(p.id, { caregivers: [], nurses: p.primary_nurse_id ? [p.primary_nurse_id] : [] });
  for (const c of caseload) teams.get(c.patient_id)?.nurses.push(c.nurse_id);
  for (const l of links)
    if (l.relationship === 'caregiver') teams.get(l.patient_id)?.caregivers.push(l.profile_id);
  for (const t of teams.values()) t.nurses = [...new Set(t.nurses)];
  return { teams, admins: admins.map((a) => a.id) };
}

// ------------------------------------------------------------------ alerts

export async function deliverAlerts(
  db: SupabaseClient,
  drafts: AlertDraft[],
  sms: SmsProvider,
): Promise<{ inApp: number; sms: number }> {
  if (!drafts.length) return { inApp: 0, sms: 0 };
  const recipientIds = [...new Set(drafts.map((d) => d.recipient_profile_id))];
  const patientIds = [...new Set(drafts.map((d) => d.patient_id))];
  const [{ data: profiles }, { data: consents }] = await Promise.all([
    db.from('profiles').select('id, phone, sms_opt_in').in('id', recipientIds),
    db
      .from('consents')
      .select('patient_id')
      .in('patient_id', patientIds)
      .eq('consent_type', 'sms')
      .is('revoked_at', null),
  ]);
  const plan = planDeliveries(
    drafts,
    new Map((profiles ?? []).map((p) => [p.id, p])),
    new Set((consents ?? []).map((c) => c.patient_id)),
  );
  let inApp = 0;
  for (const a of plan.inApp) {
    const { error } = await db
      .from('alerts')
      .insert({ ...a, channel: 'in_app', delivery_status: 'delivered' });
    if (!error) inApp++;
    else if (error.code !== '23505')
      fnLog.warn('alert.insert_failed', { related_id: a.related_id, code: error.code });
  }
  let sent = 0;
  for (const a of plan.sms) {
    const { phone, ...row } = a;
    const { data: ins, error } = await db
      .from('alerts')
      .insert({ ...row, channel: 'sms', delivery_status: 'queued' })
      .select('id')
      .single();
    if (error) continue; // 23505 → already sent
    const r = await sms.send(phone, SMS_BODY, ins.id);
    await db
      .from('alerts')
      .update({ delivery_status: r.ok ? 'sent' : 'failed' })
      .eq('id', ins.id);
    if (r.ok) sent++;
  }
  return { inApp, sms: sent };
}

// ------------------------------------------------------------------ generate-doses

export async function runGenerateDoses(
  db: SupabaseClient,
  now: Date,
  opts: { all?: boolean } = {},
) {
  let created = 0;
  let orgsProcessed = 0;
  for (const org of await loadOrgs(db)) {
    if (!opts.all && !isLocalMidnightHour(org.timezone, now)) continue;
    orgsProcessed++;
    const meds = await selectAll<Medication>((a, b) =>
      db
        .from('medications')
        .select(MED_COLS)
        .eq('organization_id', org.id)
        .eq('prn', false)
        .range(a, b),
    );
    const today = localDate(now, org.timezone);
    const existing = await selectAll<{ medication_id: string; scheduled_for: string }>((a, b) =>
      db
        .from('dose_events')
        .select('medication_id, scheduled_for')
        .eq('organization_id', org.id)
        .gte('scheduled_for', new Date(now.getTime() - 36 * 3600_000).toISOString())
        .range(a, b),
    );
    const drafts = planDoseGeneration(
      meds,
      org.timezone,
      now,
      new Set(existing.map((e) => `${e.medication_id}|${new Date(e.scheduled_for).toISOString()}`)),
    );
    for (let i = 0; i < drafts.length; i += 500) {
      const { error } = await db
        .from('dose_events')
        .upsert(drafts.slice(i, i + 500), {
          onConflict: 'medication_id,scheduled_for',
          ignoreDuplicates: true,
        });
      if (error) throw new Error('dose_insert_failed');
    }
    created += drafts.length;
    fnLog.info('doses.generated', {
      organization_id: org.id,
      count: drafts.length,
      code: `${today}`,
    });
  }
  return { orgsProcessed, created };
}

// ------------------------------------------------------------------ check-missed-doses

export async function runCheckMissedDoses(db: SupabaseClient, sms: SmsProvider, now: Date) {
  const totals = { missed: 0, stopped: 0, alerts: 0 };
  for (const org of await loadOrgs(db)) {
    const since = new Date(now.getTime() - 48 * 3600_000).toISOString();
    const doses = await selectAll<DoseEvent & { organization_id: string }>((a, b) =>
      db
        .from('dose_events')
        .select('id, organization_id, patient_id, medication_id, scheduled_for, status, note')
        .eq('organization_id', org.id)
        .in('status', ['pending', 'missed'])
        .gte('scheduled_for', since)
        .lte('scheduled_for', now.toISOString())
        .range(a, b),
    );
    if (!doses.length) continue;
    const medIds = [...new Set(doses.map((d) => d.medication_id))];
    const { data: meds } = await db.from('medications').select(MED_COLS).in('id', medIds);
    const { teams, admins } = await loadCareTeams(db, org.id);
    const { data: alerts } = await db
      .from('alerts')
      .select('recipient_profile_id, alert_type, related_id')
      .in(
        'related_id',
        doses.map((d) => d.id),
      )
      .eq('channel', 'in_app');
    const plan = planMissedDoses({
      doses,
      medications: (meds ?? []) as Medication[],
      organizationId: org.id,
      timezone: org.timezone,
      settings: org.settings,
      teams,
      admins,
      existingAlerts: (alerts ?? []) as ExistingAlert[],
      now,
    });
    if (plan.markMissed.length)
      await db
        .from('dose_events')
        .update({ status: 'missed' })
        .in('id', plan.markMissed)
        .eq('status', 'pending');
    if (plan.markStopped.length)
      await db
        .from('dose_events')
        .update({ status: 'skipped', note: 'Medicine stopped', confirmation_method: 'system' })
        .in('id', plan.markStopped)
        .eq('status', 'pending');
    const delivered = await deliverAlerts(db, plan.alerts, sms);
    totals.missed += plan.markMissed.length;
    totals.stopped += plan.markStopped.length;
    totals.alerts += delivered.inApp;
  }
  return totals;
}

// ------------------------------------------------------------------ run-flag-engine

export async function runFlagEngineForPatient(
  db: SupabaseClient,
  patientId: string,
  sms: SmsProvider,
  now: Date,
) {
  const { data: p } = await db
    .from('patients')
    .select('id, organization_id, status, organizations(timezone, settings)')
    .eq('id', patientId)
    .maybeSingle();
  if (!p) return { created: 0, upgraded: 0, alerts: 0 };
  const org = p.organizations as unknown as { timezone: string; settings: unknown };
  const tz = org?.timezone ?? 'America/New_York';
  const settings = resolveOrgSettings(org?.settings);
  const today = localDate(now, tz);
  const since = addDays(today, -60);
  const [meds, changes, doses, logs, flags] = await Promise.all([
    selectAll<Medication>((a, b) =>
      db.from('medications').select(MED_COLS).eq('patient_id', patientId).range(a, b),
    ),
    selectAll<MedicationChange>((a, b) =>
      db
        .from('medication_changes')
        .select('id, patient_id, medication_id, change_type, effective_date')
        .eq('patient_id', patientId)
        .gte('effective_date', addDays(today, -30))
        .range(a, b),
    ),
    selectAll<DoseEvent>((a, b) =>
      db
        .from('dose_events')
        .select('id, patient_id, medication_id, scheduled_for, status, note')
        .eq('patient_id', patientId)
        .gte('scheduled_for', `${since}T00:00:00Z`)
        .range(a, b),
    ),
    selectAll<SymptomLog>((a, b) =>
      db
        .from('symptom_logs')
        .select('id, patient_id, logged_for_date, entries')
        .eq('patient_id', patientId)
        .gte('logged_for_date', addDays(today, -30))
        .range(a, b),
    ),
    selectAll<ExistingFlag>((a, b) =>
      db
        .from('flags')
        .select('id, dedupe_key, status, severity, created_at')
        .eq('patient_id', patientId)
        .range(a, b),
    ),
  ]);
  const drafts = runFlagEngine({
    patient: { id: patientId, organization_id: p.organization_id },
    medications: meds,
    medicationChanges: changes,
    doseEvents: doses,
    symptomLogs: logs,
    existingFlags: flags,
    rules: getBundledRules(),
    settings,
    now,
    timezone: tz,
  });
  const created: NewFlagRef[] = [];
  let upgraded = 0;
  for (const d of drafts) {
    const { upgrades_flag_id, ...row } = d;
    if (upgrades_flag_id) {
      const { error } = await db
        .from('flags')
        .update({ severity: row.severity, explanation: row.explanation, evidence: row.evidence })
        .eq('id', upgrades_flag_id);
      if (!error) {
        upgraded++;
        created.push({
          id: upgrades_flag_id,
          organization_id: row.organization_id,
          patient_id: patientId,
          severity: row.severity,
        });
      }
      continue;
    }
    const { data, error } = await db
      .from('flags')
      .insert({ ...row, status: 'open' })
      .select('id')
      .single();
    if (error) {
      if (error.code !== '23505')
        fnLog.warn('flag.insert_failed', { patient_id: patientId, code: error.code });
      continue; // a concurrent run already created it
    }
    created.push({
      id: data.id,
      organization_id: row.organization_id,
      patient_id: patientId,
      severity: row.severity,
    });
  }
  let alerts = 0;
  if (created.length) {
    const { teams } = await loadCareTeams(db, p.organization_id);
    const { data: existing } = await db
      .from('alerts')
      .select('recipient_profile_id, alert_type, related_id')
      .in(
        'related_id',
        created.map((c) => c.id),
      );
    const delivered = await deliverAlerts(
      db,
      planFlagAlerts(
        created,
        settings.flag_min_severity_for_alert,
        teams,
        (existing ?? []) as ExistingAlert[],
      ),
      sms,
    );
    alerts = delivered.inApp;
  }
  return { created: created.length - upgraded, upgraded, alerts };
}
