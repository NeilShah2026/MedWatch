import { supabase } from '../supabase';
import type { MedicationChangeRow, MedicationRow } from '../types';

const MED_COLS =
  'id, organization_id, patient_id, name, generic_name, drug_class, purpose, dose_amount, dose_unit, route, frequency_label, schedule_times, prn, start_date, end_date, status, prescriber_name, created_at';

export async function fetchMedications(patientId: string): Promise<MedicationRow[]> {
  const { data, error } = await supabase
    .from('medications')
    .select(MED_COLS)
    .eq('patient_id', patientId)
    .order('name');
  if (error) throw error;
  return (data ?? []) as MedicationRow[];
}

export async function fetchChanges(patientId: string): Promise<MedicationChangeRow[]> {
  const { data, error } = await supabase
    .from('medication_changes')
    .select(
      'id, patient_id, medication_id, change_type, previous, current, effective_date, recorded_by, created_at',
    )
    .eq('patient_id', patientId)
    .order('effective_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MedicationChangeRow[];
}

export type MedicationInput = Pick<
  MedicationRow,
  | 'name'
  | 'generic_name'
  | 'drug_class'
  | 'purpose'
  | 'dose_amount'
  | 'dose_unit'
  | 'route'
  | 'frequency_label'
  | 'schedule_times'
  | 'prn'
  | 'start_date'
  | 'prescriber_name'
>;

/** Add a medicine and its "started" history row. */
export async function addMedication(
  patient: { id: string; organization_id: string },
  input: MedicationInput,
  effectiveDate: string,
) {
  const { data, error } = await supabase
    .from('medications')
    .insert({
      ...input,
      patient_id: patient.id,
      organization_id: patient.organization_id,
      status: 'active',
    })
    .select(MED_COLS)
    .single();
  if (error) throw error;
  const med = data as MedicationRow;
  const ch = await supabase.from('medication_changes').insert({
    organization_id: patient.organization_id,
    patient_id: patient.id,
    medication_id: med.id,
    change_type: 'started',
    previous: null,
    current: snapshot(med),
    effective_date: effectiveDate,
  });
  if (ch.error) throw ch.error;
  return med;
}

export function snapshot(m: Partial<MedicationRow>) {
  return {
    dose_amount: m.dose_amount ?? null,
    dose_unit: m.dose_unit ?? null,
    schedule_times: m.schedule_times ?? [],
    drug_class: m.drug_class ?? null,
    status: m.status ?? 'active',
  };
}

/** Edit a medicine; every edit records a medication_changes row (spec §10). */
export async function changeMedication(
  med: MedicationRow,
  patch: Partial<MedicationInput> & { status?: 'active' | 'stopped'; end_date?: string | null },
  changeType: MedicationChangeRow['change_type'],
  effectiveDate: string,
) {
  const { data, error } = await supabase
    .from('medications')
    .update(patch)
    .eq('id', med.id)
    .select(MED_COLS)
    .single();
  if (error) throw error;
  const next = data as MedicationRow;
  const ch = await supabase.from('medication_changes').insert({
    organization_id: med.organization_id,
    patient_id: med.patient_id,
    medication_id: med.id,
    change_type: changeType,
    previous: snapshot(med),
    current: snapshot(next),
    effective_date: effectiveDate,
  });
  if (ch.error) throw ch.error;
  return next;
}
