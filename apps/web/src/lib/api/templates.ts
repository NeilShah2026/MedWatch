import { supabase } from '../supabase';
import type { CheckinTemplateRow } from '../types';
import { invokeFunction } from '../functions';

export async function fetchActiveTemplate(patientId: string): Promise<CheckinTemplateRow | null> {
  const { data, error } = await supabase
    .from('checkin_templates')
    .select(
      'id, patient_id, medication_fingerprint, source, questions, model, prompt_version, status, created_at',
    )
    .eq('patient_id', patientId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return (data as CheckinTemplateRow) ?? null;
}

export function regenerateTemplate(patientId: string, force = false) {
  return invokeFunction<{ status: string }>('tailor-checkin', { patient_id: patientId, force });
}
