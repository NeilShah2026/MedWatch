import { startOfLocalDay, addDays } from '@medwatch/core';
import { supabase } from '../supabase';
import type { DoseEventRow } from '../types';

export interface DoseWithMed extends DoseEventRow {
  medications: {
    name: string;
    dose_amount: number | null;
    dose_unit: string | null;
    purpose: string | null;
  } | null;
}

const SELECT =
  'id, patient_id, medication_id, scheduled_for, status, confirmed_at, confirmed_by, confirmation_method, verification, note, medications(name, dose_amount, dose_unit, purpose)';

export async function fetchDosesForDay(
  patientId: string,
  date: string,
  tz: string,
): Promise<DoseWithMed[]> {
  const { data, error } = await supabase
    .from('dose_events')
    .select(SELECT)
    .eq('patient_id', patientId)
    .gte('scheduled_for', startOfLocalDay(date, tz).toISOString())
    .lt('scheduled_for', startOfLocalDay(addDays(date, 1), tz).toISOString())
    .order('scheduled_for');
  if (error) throw error;
  return (data ?? []) as unknown as DoseWithMed[];
}

export async function fetchDoses(
  patientId: string,
  from: string,
  to: string,
  tz: string,
  status?: string,
): Promise<DoseWithMed[]> {
  let q = supabase
    .from('dose_events')
    .select(SELECT)
    .eq('patient_id', patientId)
    .gte('scheduled_for', startOfLocalDay(from, tz).toISOString())
    .lt('scheduled_for', startOfLocalDay(addDays(to, 1), tz).toISOString())
    .order('scheduled_for', { ascending: false })
    .limit(1000);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as DoseWithMed[];
}

/**
 * Confirm or correct a dose. Attribution (confirmed_by / method) is set by the database
 * from the signed-in user, so the client cannot spoof who confirmed it.
 */
export async function updateDose(
  id: string,
  patch: {
    status: DoseEventRow['status'];
    note?: string | null;
    verification?: 'reported' | 'verified';
  },
): Promise<void> {
  const body: Record<string, unknown> = { status: patch.status };
  if (patch.note !== undefined) body.note = patch.note;
  if (patch.verification) body.verification = patch.verification;
  const { error } = await supabase.from('dose_events').update(body).eq('id', id);
  if (error) throw error;
}

export interface AdherenceDay {
  day: string;
  given: number;
  missed: number;
  refused: number;
  skipped: number;
  pending: number;
}

export async function fetchAdherenceDaily(
  patientId: string,
  from: string,
  to: string,
): Promise<AdherenceDay[]> {
  const { data, error } = await supabase.rpc('adherence_daily', {
    p_patient_id: patientId,
    p_start: from,
    p_end: to,
  });
  if (error) throw error;
  return (data ?? []) as AdherenceDay[];
}
