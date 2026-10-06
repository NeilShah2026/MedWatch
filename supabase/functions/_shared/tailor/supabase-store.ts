import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addDays,
  localDate,
  type Medication,
  type MedicationChange,
} from '../../../../packages/core/src/index.ts';
import type {
  ActiveTemplate,
  AiRequestMeta,
  NewTemplate,
  PatientContext,
  TailorStore,
} from './tailor.ts';

/** TailorStore backed by Supabase (service role, server-side only). */
export class SupabaseTailorStore implements TailorStore {
  constructor(private readonly db: SupabaseClient) {}

  async loadContext(patientId: string): Promise<PatientContext | null> {
    const { data: p } = await this.db
      .from('patients')
      .select('id, organization_id, date_of_birth, status, organizations(timezone)')
      .eq('id', patientId)
      .maybeSingle();
    if (!p) return null;
    const tz =
      (p.organizations as unknown as { timezone: string } | null)?.timezone ?? 'America/New_York';
    const [{ data: meds, error: me }, { data: changes, error: ce }] = await Promise.all([
      this.db
        .from('medications')
        .select(
          'id, organization_id, patient_id, name, generic_name, drug_class, dose_amount, dose_unit, schedule_times, prn, start_date, end_date, status',
        )
        .eq('patient_id', patientId),
      this.db
        .from('medication_changes')
        .select('id, patient_id, medication_id, change_type, effective_date')
        .eq('patient_id', patientId)
        .gte('effective_date', addDays(localDate(new Date(), tz), -15)),
    ]);
    if (me || ce) throw new Error('load_context_failed');
    return {
      patientId,
      organizationId: p.organization_id,
      dateOfBirth: p.date_of_birth,
      timezone: tz,
      medications: (meds ?? []) as Medication[],
      changes: (changes ?? []) as MedicationChange[],
    };
  }

  async getActiveTemplate(patientId: string): Promise<ActiveTemplate | null> {
    const { data } = await this.db
      .from('checkin_templates')
      .select('id, medication_fingerprint, source')
      .eq('patient_id', patientId)
      .eq('status', 'active')
      .maybeSingle();
    return (data as ActiveTemplate) ?? null;
  }

  async countAiRequestsSince(patientId: string, sinceIso: string): Promise<number> {
    const { count } = await this.db
      .from('ai_requests')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId)
      .gte('created_at', sinceIso);
    return count ?? 0;
  }

  async recordAiRequest(meta: AiRequestMeta): Promise<void> {
    await this.db.from('ai_requests').insert(meta);
  }

  async saveTemplate(t: NewTemplate): Promise<{ id: string }> {
    const { data, error } = await this.db.rpc('replace_checkin_template', {
      p_patient_id: t.patient_id,
      p_fingerprint: t.medication_fingerprint,
      p_source: t.source,
      p_questions: t.questions,
      p_model: t.model,
      p_prompt_version: t.prompt_version,
    });
    if (error) throw new Error('save_template_failed');
    return { id: data as string };
  }
}
