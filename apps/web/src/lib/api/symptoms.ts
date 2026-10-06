import type { SymptomEntry } from '@medwatch/core';
import { supabase } from '../supabase';
import type { SymptomLogRow } from '../types';

const COLS =
  'id, patient_id, logged_for_date, logged_by, entries, overall_feeling, free_text, updated_at';

export async function fetchLogForDay(
  patientId: string,
  date: string,
): Promise<SymptomLogRow | null> {
  const { data, error } = await supabase
    .from('symptom_logs')
    .select(COLS)
    .eq('patient_id', patientId)
    .eq('logged_for_date', date)
    .maybeSingle();
  if (error) throw error;
  return (data as SymptomLogRow) ?? null;
}

export async function fetchLogs(patientId: string, from: string): Promise<SymptomLogRow[]> {
  const { data, error } = await supabase
    .from('symptom_logs')
    .select(COLS)
    .eq('patient_id', patientId)
    .gte('logged_for_date', from)
    .order('logged_for_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SymptomLogRow[];
}

/** One row per patient per day: edits update the same row (and are audited). */
export async function saveLog(input: {
  organization_id: string;
  patient_id: string;
  logged_for_date: string;
  entries: SymptomEntry[];
  overall_feeling: number | null;
  free_text: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('symptom_logs')
    .upsert(input, { onConflict: 'patient_id,logged_for_date' });
  if (error) throw error;
}
