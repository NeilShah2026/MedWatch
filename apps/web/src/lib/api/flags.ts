import { supabase } from '../supabase';
import type { FlagRow } from '../types';

const COLS =
  'id, organization_id, patient_id, flag_type, severity, status, title, explanation, evidence, rule_id, dedupe_key, reviewed_by, reviewed_at, review_note, created_at';

export async function fetchFlags(patientId: string): Promise<FlagRow[]> {
  const { data, error } = await supabase
    .from('flags')
    .select(COLS)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as FlagRow[];
}

export interface InboxFlag extends FlagRow {
  patients: { first_name: string; last_name: string } | null;
}

export async function fetchInbox(): Promise<InboxFlag[]> {
  const { data, error } = await supabase
    .from('flags')
    .select(`${COLS}, patients(first_name, last_name)`)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as InboxFlag[];
}

/** Reviewer and time are stamped by the database (guard_flag_update). */
export async function reviewFlag(
  id: string,
  status: FlagRow['status'],
  note?: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (note !== undefined) patch.review_note = note;
  const { error } = await supabase.from('flags').update(patch).eq('id', id);
  if (error) throw error;
}
