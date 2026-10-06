import { supabase } from './supabase';
import { logger } from './logger';

/** Record that a patient record or summary was opened (spec §6.3). Never blocks the UI. */
export async function logView(
  entityType: 'patient' | 'visit_summary' | 'audit_log' | 'dashboard' | 'pilot_metrics',
  entityId: string | null,
) {
  const { error } = await supabase.rpc('log_view', {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });
  if (error) logger.warn('audit.log_view_failed', { code: error.code ?? null, entityId });
}

/** Record an export (PDF, CSV, JSON). Awaited by callers so the export is logged first. */
export async function logExport(
  entityType: 'patient' | 'visit_summary' | 'audit_log' | 'pilot_metrics',
  entityId: string | null,
  details: { format: 'pdf' | 'csv' | 'json'; rows?: number; from?: string; to?: string },
) {
  const { error } = await supabase.rpc('log_export', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_details: details,
  });
  if (error) {
    logger.error('audit.log_export_failed', { code: error.code ?? null, entityId });
    throw new Error('export-log-failed');
  }
}
