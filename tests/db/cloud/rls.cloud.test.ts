/**
 * RLS tests against the cloud **dev** project (spec §11 "Database").
 * Uses supabase-js clients signed in as each role. Builds an isolated two-org fixture with
 * the service role and deletes it afterwards. Skipped when dev-project credentials are absent
 * (see PROGRESS.md); the same policies are also verified locally by `npm run test:db:local`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cloud, hasCloud } from '../../support/cloud-env';

const PASSWORD = `Rls!${Math.random().toString(36).slice(2)}A1`;
const tag = `rls${Date.now().toString(36)}`;

type Who = 'adminA' | 'nurseA1' | 'nurseA2' | 'caregiverA' | 'patientA' | 'adminB';

describe.skipIf(!hasCloud)('cloud RLS (dev project)', () => {
  let admin: SupabaseClient;
  const users = {} as Record<Who, { id: string; email: string; client: SupabaseClient }>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    admin = createClient(cloud.url!, cloud.serviceKey!, { auth: { persistSession: false } });
    const org = async (name: string) =>
      (await admin.from('organizations').insert({ name }).select('id').single()).data!.id as string;
    ids.orgA = await org(`RLS test A ${tag}`);
    ids.orgB = await org(`RLS test B ${tag}`);

    const roles: Record<Who, [string, string]> = {
      adminA: [ids.orgA, 'agency_admin'],
      nurseA1: [ids.orgA, 'nurse'],
      nurseA2: [ids.orgA, 'nurse'],
      caregiverA: [ids.orgA, 'caregiver'],
      patientA: [ids.orgA, 'patient'],
      adminB: [ids.orgB, 'agency_admin'],
    };
    for (const [who, [orgId, role]] of Object.entries(roles) as [Who, [string, string]][]) {
      const email = `${who.toLowerCase()}.${tag}@test.medwatch`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      const id = data.user.id;
      await admin
        .from('profiles')
        .insert({ id, organization_id: orgId, role, full_name: `Test ${who}`, email });
      const client = createClient(cloud.url!, cloud.anonKey!, { auth: { persistSession: false } });
      const s = await client.auth.signInWithPassword({ email, password: PASSWORD });
      if (s.error) throw s.error;
      users[who] = { id, email, client };
    }

    const patient = async (orgId: string, label: string) =>
      (
        await admin
          .from('patients')
          .insert({
            organization_id: orgId,
            first_name: 'Test',
            last_name: label,
            date_of_birth: '1940-01-01',
          })
          .select('id')
          .single()
      ).data!.id as string;
    ids.p1 = await patient(ids.orgA, 'One');
    ids.p2 = await patient(ids.orgA, 'Two');
    ids.pB = await patient(ids.orgB, 'Bee');
    await admin.from('caseload_assignments').insert([
      { organization_id: ids.orgA, nurse_id: users.nurseA1.id, patient_id: ids.p1 },
      { organization_id: ids.orgA, nurse_id: users.nurseA2.id, patient_id: ids.p2 },
    ]);
    await admin.from('patient_links').insert([
      {
        organization_id: ids.orgA,
        patient_id: ids.p1,
        profile_id: users.caregiverA.id,
        relationship: 'caregiver',
      },
      {
        organization_id: ids.orgA,
        patient_id: ids.p1,
        profile_id: users.patientA.id,
        relationship: 'self',
      },
    ]);
    ids.med1 = (
      await admin
        .from('medications')
        .insert({
          organization_id: ids.orgA,
          patient_id: ids.p1,
          name: 'Testamine',
          schedule_times: ['08:00'],
        })
        .select('id')
        .single()
    ).data!.id;
    ids.flag1 = (
      await admin
        .from('flags')
        .insert({
          organization_id: ids.orgA,
          patient_id: ids.p1,
          flag_type: 'adherence',
          severity: 'low',
          title: 't',
          explanation: 'e. For clinician review.',
          dedupe_key: `k:${tag}`,
        })
        .select('id')
        .single()
    ).data!.id;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
    await admin.from('organizations').delete().in('id', [ids.orgA, ids.orgB]);
  }, 120_000);

  const patientIds = async (who: Who) =>
    ((await users[who].client.from('patients').select('id')).data ?? []).map((r) => r.id).sort();

  it('admin sees all org patients, none from other org', async () => {
    expect(await patientIds('adminA')).toEqual([ids.p1, ids.p2].sort());
    expect(await patientIds('adminB')).toEqual([ids.pB]);
  });
  it('nurse sees only own caseload', async () => {
    expect(await patientIds('nurseA1')).toEqual([ids.p1]);
    expect(await patientIds('nurseA2')).toEqual([ids.p2]);
  });
  it('caregiver and patient see only linked patient', async () => {
    expect(await patientIds('caregiverA')).toEqual([ids.p1]);
    expect(await patientIds('patientA')).toEqual([ids.p1]);
  });
  it('patients/caregivers cannot update medications or flags', async () => {
    for (const who of ['caregiverA', 'patientA'] as Who[]) {
      const m = await users[who].client
        .from('medications')
        .update({ name: 'X' })
        .eq('id', ids.med1)
        .select('id');
      expect(m.data ?? []).toEqual([]);
      const f = await users[who].client
        .from('flags')
        .update({ status: 'acknowledged' })
        .eq('id', ids.flag1)
        .select('id');
      expect(f.data ?? []).toEqual([]);
    }
  });
  it('nurse can review own caseload flag', async () => {
    const f = await users.nurseA1.client
      .from('flags')
      .update({ status: 'acknowledged' })
      .eq('id', ids.flag1)
      .select('reviewed_by');
    expect(f.data?.[0]?.reviewed_by).toBe(users.nurseA1.id);
  });
  it('audit_log rejects update and delete; audit rows exist for writes', async () => {
    const rows = await users.adminA.client
      .from('audit_log')
      .select('id, action')
      .eq('entity_id', ids.flag1);
    expect((rows.data ?? []).map((r) => r.action)).toContain('update');
    const id = rows.data![0]!.id;
    const del = await admin.from('audit_log').delete().eq('id', id);
    expect(del.error?.message).toMatch(/append-only/);
    const upd = await admin.from('audit_log').update({ action: 'view' }).eq('id', id);
    expect(upd.error?.message).toMatch(/append-only/);
  });
});
