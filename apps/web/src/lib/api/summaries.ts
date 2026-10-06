import type { VisitSummaryContent } from '@medwatch/core';
import { supabase } from '../supabase';
import type { VisitSummaryRow } from '../types';

export async function fetchSummaries(patientId: string): Promise<VisitSummaryRow[]> {
  const { data, error } = await supabase
    .from('visit_summaries')
    .select('id, patient_id, generated_by, period_start, period_end, content, created_at')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as VisitSummaryRow[];
}

export async function saveSummary(input: {
  organization_id: string;
  patient_id: string;
  generated_by: string;
  period_start: string;
  period_end: string;
  content: VisitSummaryContent;
}): Promise<VisitSummaryRow> {
  const { data, error } = await supabase
    .from('visit_summaries')
    .insert(input)
    .select('id, patient_id, generated_by, period_start, period_end, content, created_at')
    .single();
  if (error) throw error;
  return data as VisitSummaryRow;
}
