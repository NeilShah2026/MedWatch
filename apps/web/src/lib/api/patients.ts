import { supabase } from '../supabase';
import type { PatientOverviewRow, PatientRow } from '../types';

export async function fetchOverview(): Promise<PatientOverviewRow[]> {
  const { data, error } = await supabase.rpc('patient_overview');
  if (error) throw error;
  return ((data ?? []) as PatientOverviewRow[]).map((r) => ({
    ...r,
    adherence_7d: r.adherence_7d === null ? null : Number(r.adherence_7d),
  }));
}

/** Returns null when RLS hides the patient (no access) — callers show "no access". */
export async function fetchPatient(id: string): Promise<PatientRow | null> {
  const { data, error } = await supabase
    .from('patients')
    .select(
      'id, organization_id, first_name, last_name, date_of_birth, primary_nurse_id, notes, status, last_visit_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (error && error.code !== '22P02') throw error;
  return (data as PatientRow) ?? null;
}

/** The patient record linked to a patient-user (relationship = self). */
export async function fetchSelfPatient(userId: string): Promise<PatientRow | null> {
  const { data, error } = await supabase
    .from('patient_links')
    .select(
      'patient_id, patients(id, organization_id, first_name, last_name, date_of_birth, primary_nurse_id, notes, status, last_visit_at)',
    )
    .eq('profile_id', userId)
    .eq('relationship', 'self')
    .maybeSingle();
  if (error) throw error;
  return (data?.patients as unknown as PatientRow) ?? null;
}

export async function recordVisit(patientId: string): Promise<void> {
  const { error } = await supabase
    .from('patients')
    .update({ last_visit_at: new Date().toISOString() })
    .eq('id', patientId);
  if (error) throw error;
}
