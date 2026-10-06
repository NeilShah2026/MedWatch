import { supabase } from '../supabase';
import type { ProfileRow } from '../types';

/** Profiles visible to the caller (staff for everyone; whole org for staff). */
export async function fetchStaff(): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, organization_id, role, full_name, email, phone, sms_opt_in, mfa_required, is_active',
    )
    .order('full_name');
  if (error) throw error;
  return (data ?? []) as ProfileRow[];
}
