import { supabase } from '../supabase';
import type { ConsentRow } from '../types';

export interface LinkRow {
  id: string;
  patient_id: string;
  profile_id: string;
  relationship: 'self' | 'caregiver';
  profiles: {
    full_name: string;
    email: string | null;
    phone: string | null;
    sms_opt_in: boolean;
  } | null;
}

export async function fetchLinks(patientId: string): Promise<LinkRow[]> {
  const { data, error } = await supabase
    .from('patient_links')
    .select(
      'id, patient_id, profile_id, relationship, profiles(full_name, email, phone, sms_opt_in)',
    )
    .eq('patient_id', patientId);
  if (error) throw error;
  return (data ?? []) as unknown as LinkRow[];
}

export async function fetchConsents(patientId: string): Promise<ConsentRow[]> {
  const { data, error } = await supabase
    .from('consents')
    .select(
      'id, patient_id, consent_type, granted_by_name, granted_by_relationship, granted_at, revoked_at, document_version',
    )
    .eq('patient_id', patientId)
    .order('granted_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ConsentRow[];
}

export async function addConsent(input: {
  organization_id: string;
  patient_id: string;
  consent_type: ConsentRow['consent_type'];
  granted_by_name: string;
  granted_by_relationship: string;
  document_version: string;
}): Promise<void> {
  const { error } = await supabase.from('consents').insert(input);
  if (error) throw error;
}

export async function revokeConsent(id: string): Promise<void> {
  const { error } = await supabase
    .from('consents')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
