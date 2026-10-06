import { supabase } from '../supabase';
import type { AlertRow } from '../types';

export async function fetchMyAlerts(userId: string): Promise<AlertRow[]> {
  const { data, error } = await supabase
    .from('alerts')
    .select(
      'id, patient_id, recipient_profile_id, channel, alert_type, related_id, sent_at, read_at, patients(first_name, last_name)',
    )
    .eq('recipient_profile_id', userId)
    .eq('channel', 'in_app')
    .order('sent_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as unknown as AlertRow[];
}

export async function markAlertsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase
    .from('alerts')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw error;
}
