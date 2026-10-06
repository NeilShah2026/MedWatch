import type { OrgSettings } from '@medwatch/core';
import { supabase } from '../supabase';
import { invokeFunction } from '../functions';
import type { AuditRow, InvitationRow, PatientRow, ProfileRow } from '../types';

export interface DashboardKpis {
  active_patients: number;
  adherence_7d: { given: number; total: number; rate: number | null };
  open_flags: { high: number; medium: number; low: number };
  median_review_hours_30d: number | null;
  reviewed_30d: number;
  checkin_completion_7d: { done: number; expected: number; rate: number | null };
}
export interface AttentionRow {
  patient_id: string;
  first_name: string;
  last_name: string;
  high_flags: number;
  escalations_24h: number;
  last_checkin: string | null;
  missing_checkin: boolean;
}
export interface AiStats {
  active_templates: { ai: number; rules: number; default: number };
  ai_requests_7d: number;
  ai_failures_7d: number;
}
export interface PilotMetrics {
  from: string;
  to: string;
  flags_by_type_severity: { flag_type: string; severity: string; count: number }[];
  flags_created: number;
  flags_reviewed: number;
  median_review_hours: number | null;
  flags_escalated: number;
  adherence: { given: number; total: number; rate: number | null };
  checkin_completion: { done: number; expected: number; rate: number | null };
  missed_dose_alerts: number;
  escalation_alerts: number;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const fetchKpis = () => rpc<DashboardKpis>('dashboard_kpis');
export const fetchNeedsAttention = () => rpc<AttentionRow[]>('needs_attention');
export const fetchAiStats = () => rpc<AiStats>('ai_checkin_stats');
export const fetchOrgAdherence = (from: string, to: string) =>
  rpc<{ day: string; given: number; counted: number }[]>('org_adherence_daily', {
    p_start: from,
    p_end: to,
  });
export const fetchFlagsWeekly = (from: string, to: string) =>
  rpc<{ week_start: string; created: number; reviewed: number }[]>('flags_weekly', {
    p_start: from,
    p_end: to,
  });
export const fetchPilotMetrics = (from: string, to: string) =>
  rpc<PilotMetrics>('pilot_metrics', { p_start: from, p_end: to });

// ---- patients
export async function fetchAllPatients(): Promise<PatientRow[]> {
  const { data, error } = await supabase
    .from('patients')
    .select(
      'id, organization_id, first_name, last_name, date_of_birth, primary_nurse_id, notes, status, last_visit_at',
    )
    .order('last_name');
  if (error) throw error;
  return (data ?? []) as PatientRow[];
}

export async function createPatient(input: {
  organization_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  primary_nurse_id: string | null;
  notes: string | null;
  consent: { granted_by_name: string; granted_by_relationship: string; document_version: string };
}): Promise<PatientRow> {
  const { consent, ...p } = input;
  const { data, error } = await supabase
    .from('patients')
    .insert(p)
    .select(
      'id, organization_id, first_name, last_name, date_of_birth, primary_nurse_id, notes, status, last_visit_at',
    )
    .single();
  if (error) throw error;
  const patient = data as PatientRow;
  const c = await supabase
    .from('consents')
    .insert({
      organization_id: patient.organization_id,
      patient_id: patient.id,
      consent_type: 'data_use',
      ...consent,
    });
  if (c.error) throw c.error;
  if (p.primary_nurse_id) {
    const a = await supabase
      .from('caseload_assignments')
      .insert({
        organization_id: patient.organization_id,
        nurse_id: p.primary_nurse_id,
        patient_id: patient.id,
      });
    if (a.error) throw a.error;
  }
  return patient;
}

export async function updatePatient(
  id: string,
  patch: Partial<Pick<PatientRow, 'status' | 'primary_nurse_id' | 'notes'>>,
) {
  const { error } = await supabase.from('patients').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deletePatient(id: string) {
  const { error } = await supabase.from('patients').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchCaseload(
  patientId: string,
): Promise<{ id: string; nurse_id: string }[]> {
  const { data, error } = await supabase
    .from('caseload_assignments')
    .select('id, nurse_id')
    .eq('patient_id', patientId);
  if (error) throw error;
  return data ?? [];
}

export async function setCaseload(patient: PatientRow, nurseIds: string[]) {
  const current = await fetchCaseload(patient.id);
  const remove = current.filter((c) => !nurseIds.includes(c.nurse_id)).map((c) => c.id);
  const add = nurseIds.filter((n) => !current.some((c) => c.nurse_id === n));
  if (remove.length) {
    const { error } = await supabase.from('caseload_assignments').delete().in('id', remove);
    if (error) throw error;
  }
  if (add.length) {
    const { error } = await supabase
      .from('caseload_assignments')
      .insert(
        add.map((nurse_id) => ({
          organization_id: patient.organization_id,
          patient_id: patient.id,
          nurse_id,
        })),
      );
    if (error) throw error;
  }
}

export async function linkCaregiver(patient: PatientRow, profileId: string) {
  const { error } = await supabase
    .from('patient_links')
    .insert({
      organization_id: patient.organization_id,
      patient_id: patient.id,
      profile_id: profileId,
      relationship: 'caregiver',
    });
  if (error) throw error;
}

export async function unlink(linkId: string) {
  const { error } = await supabase.from('patient_links').delete().eq('id', linkId);
  if (error) throw error;
}

/** Everything held about one patient, for data-rights requests (export is audit-logged first). */
export async function exportPatientData(patientId: string): Promise<Record<string, unknown>> {
  const tables = [
    'medications',
    'medication_changes',
    'dose_events',
    'symptom_logs',
    'flags',
    'consents',
    'visit_summaries',
    'checkin_templates',
    'patient_links',
  ] as const;
  const { data: patient, error } = await supabase
    .from('patients')
    .select('*')
    .eq('id', patientId)
    .single();
  if (error) throw error;
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), patient };
  for (const t of tables) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error: e } = await supabase
        .from(t)
        .select('*')
        .eq('patient_id', patientId)
        .range(from, from + 999);
      if (e) throw e;
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    out[t] = rows;
  }
  return out;
}

// ---- team
export async function fetchTeam(): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, organization_id, role, full_name, email, phone, sms_opt_in, mfa_required, is_active',
    )
    .order('full_name');
  if (error) throw error;
  return (data ?? []) as ProfileRow[];
}

export async function updateProfile(
  id: string,
  patch: Partial<Pick<ProfileRow, 'role' | 'is_active' | 'mfa_required'>>,
) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', id);
  if (error) throw error;
}

export async function fetchInvitations(): Promise<InvitationRow[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, email, role, full_name, patient_id, expires_at, accepted_at, created_at')
    .is('accepted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as InvitationRow[];
}

export async function revokeInvitation(id: string) {
  const { error } = await supabase.from('invitations').delete().eq('id', id);
  if (error) throw error;
}

export const inviteUser = (body: {
  email: string;
  role: string;
  full_name?: string;
  patient_id?: string;
}) => invokeFunction<{ invitation_id: string }>('invite-user', body);

// ---- settings
export async function saveOrgSettings(orgId: string, settings: OrgSettings, timezone: string) {
  const { error } = await supabase
    .from('organizations')
    .update({ settings, timezone })
    .eq('id', orgId);
  if (error) throw error;
}

// ---- audit
export interface AuditFilters {
  actor?: string;
  patient?: string;
  action?: string;
  from?: string;
  to?: string;
}

export async function fetchAudit(f: AuditFilters, limit = 500): Promise<AuditRow[]> {
  let q = supabase
    .from('audit_log')
    .select('id, actor_id, action, entity_type, entity_id, changes, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (f.actor) q = q.eq('actor_id', f.actor);
  if (f.action) q = q.eq('action', f.action);
  if (f.patient) q = q.or(`entity_id.eq.${f.patient},changes->>patient_id.eq.${f.patient}`);
  if (f.from) q = q.gte('created_at', `${f.from}T00:00:00`);
  if (f.to) q = q.lte('created_at', `${f.to}T23:59:59`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AuditRow[];
}
