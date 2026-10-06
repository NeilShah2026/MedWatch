/**
 * Loads the full demo seed into the local verification database through the same runner the
 * cloud `db:reset` uses, then checks constraints, RLS for the demo accounts, and that reset is
 * repeatable (cascades, audit protections and unique constraints all cooperate).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PgSeedWriter } from '../../../supabase/seed/writers/pg.ts';
import { runSeed } from '../../../supabase/seed/run.ts';
import type { SeedData } from '../../../supabase/seed/generate.ts';
import { asUser, connect, expectError } from './harness';
import {
  getBundledRules,
  resolveOrgSettings,
  runFlagEngine,
  type DoseEvent,
  type ExistingFlag,
  type Medication,
  type MedicationChange,
  type SymptomLog,
} from '../../../packages/core/src/index.ts';

let db: pg.Client;
let data: SeedData;
const NOW = new Date();

beforeAll(async () => {
  db = connect();
  await db.connect();
  const w = new PgSeedWriter(process.env.LOCAL_PG_URL!);
  data = await runSeed(w, { mode: 'reset', now: NOW });
  await w.close();
}, 120_000);
afterAll(async () => {
  await db?.end();
});

const uid = (email: string) => data.users.find((u) => u.email === email)!.id;
const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query(sql, params)).rows[0].n);

describe('demo seed in Postgres', () => {
  it('inserted every table', async () => {
    for (const [table, rows] of Object.entries(data.tables)) {
      const org = data.tables.organizations[0]!.id;
      const n =
        table === 'organizations'
          ? await count('select count(*) n from organizations where id = $1', [org])
          : await count(`select count(*) n from ${table} where organization_id = $1`, [org]);
      expect(n, table).toBe(rows.length);
    }
  });

  it('nurse1 sees their 8 patients, caregiver1 two, patient1 one; admin all 25', async () => {
    const seen = async (email: string) =>
      asUser(db, uid(email), async (q) => (await q('select count(*) n from patients')).rows[0].n);
    expect(Number(await seen('nurse1@demo.medwatch'))).toBe(8);
    expect(Number(await seen('nurse3@demo.medwatch'))).toBe(9);
    expect(Number(await seen('caregiver1@demo.medwatch'))).toBe(2);
    expect(Number(await seen('caregiver2@demo.medwatch'))).toBe(2);
    expect(Number(await seen('patient1@demo.medwatch'))).toBe(1);
    expect(Number(await seen('admin@demo.medwatch'))).toBe(25);
  });

  it('each patient has exactly one active check-in template', async () => {
    expect(
      await count(`select count(*) n from checkin_templates where status = 'active'`),
    ).toBeGreaterThanOrEqual(25);
  });

  it('re-running the flag engine on database rows creates no duplicates (idempotent)', async () => {
    const rules = getBundledRules();
    const settings = resolveOrgSettings({});
    const org = data.tables.organizations[0]!.id as string;
    let created = 0;
    for (const p of data.tables.patients) {
      const pid = p.id as string;
      const q = async <T>(sql: string) => (await db.query(sql, [pid])).rows as T[];
      const drafts = runFlagEngine({
        patient: { id: pid, organization_id: org },
        medications: await q<Medication>(
          `select id, organization_id, patient_id, name, drug_class, schedule_times, prn, to_char(start_date,'YYYY-MM-DD') start_date, to_char(end_date,'YYYY-MM-DD') end_date, status from medications where patient_id = $1`,
        ),
        medicationChanges: await q<MedicationChange>(
          `select id, patient_id, medication_id, change_type, to_char(effective_date,'YYYY-MM-DD') effective_date from medication_changes where patient_id = $1`,
        ),
        doseEvents: (
          await q<DoseEvent & { scheduled_for: Date }>(
            `select id, patient_id, medication_id, scheduled_for, status, note from dose_events where patient_id = $1`,
          )
        ).map((d) => ({ ...d, scheduled_for: new Date(d.scheduled_for).toISOString() })),
        symptomLogs: await q<SymptomLog>(
          `select id, patient_id, to_char(logged_for_date,'YYYY-MM-DD') logged_for_date, entries from symptom_logs where patient_id = $1`,
        ),
        existingFlags: (
          await q<ExistingFlag & { created_at: Date }>(
            `select id, dedupe_key, status, severity, created_at from flags where patient_id = $1`,
          )
        ).map((f) => ({ ...f, created_at: new Date(f.created_at).toISOString() })),
        rules,
        settings,
        now: NOW,
        timezone: 'America/New_York',
      });
      created += drafts.filter((d) => !d.upgrades_flag_id).length;
    }
    expect(created).toBe(0);
  });

  it('reset can run again (wipe cascades, audit log stays append-only)', async () => {
    const auditBefore = await count('select count(*) n from audit_log');
    const w = new PgSeedWriter(process.env.LOCAL_PG_URL!);
    const again = await runSeed(w, { mode: 'reset', now: NOW });
    await w.close();
    expect(await count('select count(*) n from patients')).toBe(
      again.tables.patients.length +
        (await count(`select count(*) n from patients where organization_id <> $1`, [
          again.tables.organizations[0]!.id,
        ])),
    );
    expect(
      await count('select count(*) n from organizations where name = $1', [
        'Riverbend Home Health (Demo)',
      ]),
    ).toBe(1);
    expect(await count('select count(*) n from audit_log')).toBeGreaterThan(auditBefore);
    data = again;
  }, 120_000);

  it('reporting RPCs respect RLS and match the seeded stories', async () => {
    const story = (k: string) => data.stories.find((s) => s.key === k)!.patient_id;
    const nurseRows = await asUser(
      db,
      uid('nurse1@demo.medwatch'),
      async (q) => (await q('select * from patient_overview()')).rows,
    );
    expect(nurseRows).toHaveLength(8);
    const s1 = nurseRows.find((r) => r.patient_id === story('story1'))!;
    expect(s1.open_high).toBeGreaterThanOrEqual(2);
    expect(Number(s1.total_7d)).toBeGreaterThan(0);
    const cg = await asUser(
      db,
      uid('caregiver2@demo.medwatch'),
      async (q) => (await q('select patient_id from patient_overview()')).rows,
    );
    expect(cg.map((r) => r.patient_id).sort()).toEqual([story('story3'), story('story4')].sort());

    const daily = await asUser(
      db,
      uid('nurse1@demo.medwatch'),
      async (q) =>
        (
          await q(`select * from adherence_daily($1, org_today() - 29, org_today())`, [
            story('story2'),
          ])
        ).rows,
    );
    expect(daily.length).toBeGreaterThanOrEqual(29);
    const none = await asUser(
      db,
      uid('nurse1@demo.medwatch'),
      async (q) =>
        (
          await q(`select * from adherence_daily($1, org_today() - 29, org_today())`, [
            story('story4'),
          ])
        ).rows,
    );
    expect(none).toEqual([]); // story 4 is nurse2's patient

    const admin = uid('admin@demo.medwatch');
    const t0 = Date.now();
    const [kpis, attention, weekly, trend, ai] = await asUser(db, admin, async (q) => [
      (await q('select dashboard_kpis() k')).rows[0].k,
      (await q('select * from needs_attention()')).rows,
      (await q('select * from flags_weekly(org_today() - 56, org_today())')).rows,
      (await q('select * from org_adherence_daily(org_today() - 29, org_today())')).rows,
      (await q('select ai_checkin_stats() s')).rows[0].s,
    ]);
    expect(Date.now() - t0).toBeLessThan(2000); // spec §12: dashboard < 2s with seed data
    expect(kpis.active_patients).toBe(25);
    expect(kpis.open_flags.high).toBeGreaterThanOrEqual(3);
    expect(kpis.adherence_7d.rate).toBeGreaterThan(0.8);
    expect(attention.some((r: { patient_id: string }) => r.patient_id === story('story1'))).toBe(
      true,
    );
    expect(
      attention.find((r: { patient_id: string }) => r.patient_id === story('story4'))
        ?.escalations_24h,
    ).toBeGreaterThanOrEqual(1);
    expect(weekly.length).toBeGreaterThanOrEqual(8);
    expect(weekly.reduce((s: number, w: { created: number }) => s + w.created, 0)).toBe(
      data.tables.flags.length,
    );
    expect(trend.length).toBeGreaterThanOrEqual(29);
    expect(ai.active_templates.rules).toBe(25);

    const pilot = await asUser(
      db,
      admin,
      async (q) => (await q(`select pilot_metrics(org_today() - 30, org_today()) m`)).rows[0].m,
    );
    expect(pilot.flags_created).toBeGreaterThan(0);
    expect(pilot.missed_dose_alerts).toBeGreaterThan(0);
    await expectError(
      asUser(db, uid('nurse1@demo.medwatch'), (q) =>
        q(`select pilot_metrics(org_today() - 30, org_today())`),
      ),
    );
  });

  it('plain seed refuses when the demo org already exists', async () => {
    const w = new PgSeedWriter(process.env.LOCAL_PG_URL!);
    await expect(runSeed(w, { mode: 'seed' })).rejects.toThrow(/already exists/);
    await w.close();
  });
});
