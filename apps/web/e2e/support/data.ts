import { adminDb } from './helpers';
import { users } from './env';

/** Look up seeded ids with the service role (test setup only). */
export async function profileId(email: string): Promise<string> {
  const { data } = await adminDb().from('profiles').select('id').eq('email', email).single();
  return data!.id as string;
}

export async function linkedPatientIds(email: string): Promise<string[]> {
  const id = await profileId(email);
  const { data } = await adminDb().from('patient_links').select('patient_id').eq('profile_id', id);
  return (data ?? []).map((r) => r.patient_id as string);
}

export async function selfPatientId(): Promise<string> {
  return (await linkedPatientIds(users.patient1))[0]!;
}

/** A patient in the demo org that the given caregiver is NOT linked to. */
export async function unlinkedPatientId(email: string): Promise<string> {
  const linked = new Set(await linkedPatientIds(email));
  const { data } = await adminDb().from('patients').select('id').limit(50);
  return (data ?? []).map((r) => r.id as string).find((id) => !linked.has(id))!;
}

/** Make sure there is at least one pending dose today for the patient (idempotent). */
export async function ensurePendingDoseToday(patientId: string): Promise<void> {
  const db = adminDb();
  const { data: meds } = await db
    .from('medications')
    .select('id, organization_id')
    .eq('patient_id', patientId)
    .eq('status', 'active')
    .limit(1);
  const med = meds![0]!;
  const at = new Date();
  at.setUTCMinutes(0, 0, 0);
  at.setUTCHours(at.getUTCHours() + 1);
  await db.from('dose_events').upsert(
    {
      organization_id: med.organization_id,
      patient_id: patientId,
      medication_id: med.id,
      scheduled_for: at.toISOString(),
      status: 'pending',
    },
    { onConflict: 'medication_id,scheduled_for' },
  );
  await db
    .from('dose_events')
    .update({
      status: 'pending',
      confirmed_at: null,
      confirmed_by: null,
      confirmation_method: null,
    })
    .eq('medication_id', med.id)
    .eq('scheduled_for', at.toISOString());
}
