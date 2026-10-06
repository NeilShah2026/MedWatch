import pg from 'pg';

export type Role = 'patient' | 'caregiver' | 'nurse' | 'agency_admin';

export function connect(): pg.Client {
  const url = process.env.LOCAL_PG_URL;
  if (!url) throw new Error('LOCAL_PG_URL not set; run `npm run test:db:local`.');
  return new pg.Client({ connectionString: url });
}

/** Run `fn` inside a transaction as an authenticated end user (PostgREST-style claims). */
export async function asUser<T>(
  db: pg.Client,
  userId: string,
  fn: (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>,
  opts: { aal?: 'aal1' | 'aal2'; commit?: boolean } = {},
): Promise<T> {
  await db.query('begin');
  try {
    await db.query('set local role authenticated');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated', aal: opts.aal ?? 'aal1' }),
    ]);
    const result = await fn((sql, params) => db.query(sql, params as unknown[]));
    await db.query(opts.commit ? 'commit' : 'rollback');
    return result;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}

/** Expect a statement to fail (RLS violation, guard trigger, etc.). Returns the error message. */
export async function expectError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected statement to fail, but it succeeded');
}

export interface World {
  orgA: string;
  orgB: string;
  adminA: string;
  nurseA1: string;
  nurseA2: string;
  caregiverA: string;
  patientUserA: string;
  adminB: string;
  nurseB: string;
  p1: string; // org A, nurse A1 caseload, caregiver + patient-user linked
  p2: string; // org A, nurse A2 caseload
  pB: string; // org B
  medP1: string;
  medP2: string;
  medPB: string;
  doseP1: string;
  doseP2: string;
  flagP1: string;
  flagPB: string;
}

/** Build a two-organization fixture as the database owner (bypasses RLS). */
export async function buildWorld(db: pg.Client): Promise<World> {
  const one = async (sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows[0] as Record<string, string>;

  const org = async (name: string) =>
    (await one('insert into organizations (name) values ($1) returning id', [name])).id!;
  const user = async (orgId: string, role: Role, name: string) => {
    const email = `${name}.${Math.random().toString(36).slice(2, 8)}@test.medwatch`;
    const id = (await one('insert into auth.users (email) values ($1) returning id', [email])).id!;
    await db.query(
      'insert into profiles (id, organization_id, role, full_name, email) values ($1,$2,$3,$4,$5)',
      [id, orgId, role, `Test ${name}`, email],
    );
    return id;
  };
  const patient = async (orgId: string, nurse: string | null, label: string) =>
    (
      await one(
        `insert into patients (organization_id, first_name, last_name, date_of_birth, primary_nurse_id)
         values ($1, 'Test', $2, '1940-01-01', $3) returning id`,
        [orgId, label, nurse],
      )
    ).id!;
  const med = async (patientId: string) =>
    (
      await one(
        `insert into medications (organization_id, patient_id, name, drug_class, schedule_times)
         values ((select organization_id from patients where id=$1), $1, 'Testamine', 'other', '{08:00}') returning id`,
        [patientId],
      )
    ).id!;
  const dose = async (patientId: string, medId: string) =>
    (
      await one(
        `insert into dose_events (organization_id, patient_id, medication_id, scheduled_for)
         values ((select organization_id from patients where id=$1), $1, $2, now() - interval '1 hour') returning id`,
        [patientId, medId],
      )
    ).id!;
  const flag = async (patientId: string) =>
    (
      await one(
        `insert into flags (organization_id, patient_id, flag_type, severity, title, explanation, dedupe_key)
         values ((select organization_id from patients where id=$1), $1, 'adherence', 'medium', 't', 'e. For clinician review.', 'k:' || $1) returning id`,
        [patientId],
      )
    ).id!;

  const orgA = await org('Org A (test)');
  const orgB = await org('Org B (test)');
  const adminA = await user(orgA, 'agency_admin', 'adminA');
  const nurseA1 = await user(orgA, 'nurse', 'nurseA1');
  const nurseA2 = await user(orgA, 'nurse', 'nurseA2');
  const caregiverA = await user(orgA, 'caregiver', 'caregiverA');
  const patientUserA = await user(orgA, 'patient', 'patientA');
  const adminB = await user(orgB, 'agency_admin', 'adminB');
  const nurseB = await user(orgB, 'nurse', 'nurseB');

  const p1 = await patient(orgA, null, 'One');
  const p2 = await patient(orgA, null, 'Two');
  const pB = await patient(orgB, nurseB, 'Bee');

  await db.query(
    `insert into caseload_assignments (organization_id, nurse_id, patient_id) values ($1,$2,$3), ($1,$4,$5), ($6,$7,$8)`,
    [orgA, nurseA1, p1, nurseA2, p2, orgB, nurseB, pB],
  );
  await db.query(
    `insert into patient_links (organization_id, patient_id, profile_id, relationship) values ($1,$2,$3,'caregiver'), ($1,$2,$4,'self')`,
    [orgA, p1, caregiverA, patientUserA],
  );

  const medP1 = await med(p1);
  const medP2 = await med(p2);
  const medPB = await med(pB);
  const doseP1 = await dose(p1, medP1);
  const doseP2 = await dose(p2, medP2);
  const flagP1 = await flag(p1);
  const flagPB = await flag(pB);

  return {
    orgA,
    orgB,
    adminA,
    nurseA1,
    nurseA2,
    caregiverA,
    patientUserA,
    adminB,
    nurseB,
    p1,
    p2,
    pB,
    medP1,
    medP2,
    medPB,
    doseP1,
    doseP2,
    flagP1,
    flagPB,
  };
}
