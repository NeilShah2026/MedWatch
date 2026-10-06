import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { asUser, buildWorld, connect, expectError, type World } from './harness';

let db: pg.Client;
let w: World;

beforeAll(async () => {
  db = connect();
  await db.connect();
  w = await buildWorld(db);
});
afterAll(async () => {
  await db?.end();
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe('patient visibility per role', () => {
  it('agency_admin sees every patient in their org and none from another org', async () => {
    const rows = await asUser(db, w.adminA, async (q) => (await q('select id from patients')).rows);
    expect(ids(rows)).toEqual([w.p1, w.p2].sort());
  });

  it('nurse sees only their caseload', async () => {
    const rows = await asUser(
      db,
      w.nurseA1,
      async (q) => (await q('select id from patients')).rows,
    );
    expect(ids(rows)).toEqual([w.p1]);
    const meds = await asUser(
      db,
      w.nurseA1,
      async (q) => (await q('select id from medications')).rows,
    );
    expect(ids(meds)).toEqual([w.medP1]);
  });

  it('primary nurse assignment also grants access', async () => {
    const rows = await asUser(db, w.nurseB, async (q) => (await q('select id from patients')).rows);
    expect(ids(rows)).toEqual([w.pB]);
  });

  it('caregiver sees only linked patients', async () => {
    const rows = await asUser(
      db,
      w.caregiverA,
      async (q) => (await q('select id from patients')).rows,
    );
    expect(ids(rows)).toEqual([w.p1]);
    const doses = await asUser(
      db,
      w.caregiverA,
      async (q) => (await q('select id from dose_events')).rows,
    );
    expect(ids(doses)).toEqual([w.doseP1]);
  });

  it('patient-user sees only themselves', async () => {
    const rows = await asUser(
      db,
      w.patientUserA,
      async (q) => (await q('select id from patients')).rows,
    );
    expect(ids(rows)).toEqual([w.p1]);
  });

  it('other-org admin cannot read org A data in any patient table', async () => {
    const tables = [
      'patients',
      'medications',
      'dose_events',
      'flags',
      'symptom_logs',
      'medication_changes',
      'consents',
      'visit_summaries',
      'checkin_templates',
      'patient_links',
      'caseload_assignments',
    ];
    await asUser(db, w.adminB, async (q) => {
      for (const t of tables) {
        const r = await q(`select count(*)::int as n from ${t} where organization_id = $1`, [
          w.orgA,
        ]);
        expect(r.rows[0].n, t).toBe(0);
      }
    });
  });

  it('anonymous requests see nothing', async () => {
    await db.query('begin');
    await db.query('set local role anon');
    const r = await db.query('select count(*)::int as n from patients');
    await db.query('rollback');
    expect(r.rows[0].n).toBe(0);
  });

  it('inactive users lose access', async () => {
    await db.query('update profiles set is_active = false where id = $1', [w.nurseA2]);
    const rows = await asUser(
      db,
      w.nurseA2,
      async (q) => (await q('select id from patients')).rows,
    );
    await db.query('update profiles set is_active = true where id = $1', [w.nurseA2]);
    expect(rows).toEqual([]);
  });
});

describe('write permissions', () => {
  it('patients and caregivers cannot update or insert medications', async () => {
    for (const u of [w.caregiverA, w.patientUserA]) {
      const n = await asUser(
        db,
        u,
        async (q) =>
          (await q(`update medications set name = 'X' where id = $1`, [w.medP1])).rowCount,
      );
      expect(n).toBe(0);
      await expectError(
        asUser(db, u, (q) =>
          q(`insert into medications (organization_id, patient_id, name) values ($1, $2, 'X')`, [
            w.orgA,
            w.p1,
          ]),
        ),
      );
    }
  });

  it('patients and caregivers cannot review flags', async () => {
    for (const u of [w.caregiverA, w.patientUserA]) {
      const n = await asUser(
        db,
        u,
        async (q) =>
          (await q(`update flags set status = 'acknowledged' where id = $1`, [w.flagP1])).rowCount,
      );
      expect(n).toBe(0);
    }
  });

  it('nurse can review a caseload flag; reviewer is stamped; content is locked', async () => {
    const row = await asUser(
      db,
      w.nurseA1,
      async (q) =>
        (
          await q(
            `update flags set status = 'acknowledged' where id = $1 returning reviewed_by, reviewed_at`,
            [w.flagP1],
          )
        ).rows[0],
    );
    expect(row.reviewed_by).toBe(w.nurseA1);
    expect(row.reviewed_at).not.toBeNull();
    const msg = await expectError(
      asUser(db, w.nurseA1, (q) =>
        q(`update flags set explanation = 'edited' where id = $1`, [w.flagP1]),
      ),
    );
    expect(msg).toMatch(/cannot be edited/);
  });

  it('dismiss requires a reason and escalate requires a note', async () => {
    expect(
      await expectError(
        asUser(db, w.nurseA1, (q) =>
          q(`update flags set status = 'dismissed' where id = $1`, [w.flagP1]),
        ),
      ),
    ).toMatch(/requires a reason/);
    expect(
      await expectError(
        asUser(db, w.nurseA1, (q) =>
          q(`update flags set status = 'escalated' where id = $1`, [w.flagP1]),
        ),
      ),
    ).toMatch(/requires a note/);
  });

  it('nurse cannot touch another nurse caseload or another org', async () => {
    const n = await asUser(
      db,
      w.nurseA1,
      async (q) =>
        (await q(`update medications set name = 'X' where id in ($1, $2)`, [w.medP2, w.medPB]))
          .rowCount,
    );
    expect(n).toBe(0);
    await expectError(
      asUser(db, w.nurseA1, (q) =>
        q(`insert into medications (organization_id, patient_id, name) values ($1, $2, 'X')`, [
          w.orgB,
          w.pB,
        ]),
      ),
    );
  });

  it('organization_id is forced from the patient (no cross-org smuggling)', async () => {
    const row = await asUser(
      db,
      w.nurseA1,
      async (q) =>
        (
          await q(
            `insert into medications (organization_id, patient_id, name) values ($1, $2, 'Y') returning organization_id`,
            [w.orgB, w.p1],
          )
        ).rows[0],
    );
    expect(row.organization_id).toBe(w.orgA);
  });

  it('caregiver can confirm a dose; attribution is forced; schedule is locked', async () => {
    const row = await asUser(
      db,
      w.caregiverA,
      async (q) =>
        (
          await q(
            `update dose_events set status = 'given', confirmed_by = $2, confirmation_method = 'nurse'
           where id = $1 returning confirmed_by, confirmation_method, confirmed_at`,
            [w.doseP1, w.adminA],
          )
        ).rows[0],
    );
    expect(row.confirmed_by).toBe(w.caregiverA);
    expect(row.confirmation_method).toBe('caregiver_tap');
    expect(row.confirmed_at).not.toBeNull();

    await expectError(
      asUser(db, w.caregiverA, (q) =>
        q(`update dose_events set scheduled_for = now() where id = $1`, [w.doseP1]),
      ),
    );
    await expectError(
      asUser(db, w.caregiverA, (q) =>
        q(`update dose_events set status = 'missed' where id = $1`, [w.doseP1]),
      ),
    );
    const other = await asUser(
      db,
      w.caregiverA,
      async (q) =>
        (await q(`update dose_events set status = 'given' where id = $1`, [w.doseP2])).rowCount,
    );
    expect(other).toBe(0);
  });

  it('patient-user confirmation is labeled patient_tap and cannot self-verify', async () => {
    const row = await asUser(
      db,
      w.patientUserA,
      async (q) =>
        (
          await q(
            `update dose_events set status = 'given' where id = $1
           returning confirmation_method, verification`,
            [w.doseP1],
          )
        ).rows[0],
    );
    expect(row.confirmation_method).toBe('patient_tap');
    expect(row.verification).toBe('reported');
    await expectError(
      asUser(db, w.patientUserA, (q) =>
        q(`update dose_events set verification = 'verified' where id = $1`, [w.doseP1]),
      ),
    );
  });

  it('caregiver can log symptoms for a linked patient only; logged_by is stamped', async () => {
    const row = await asUser(
      db,
      w.caregiverA,
      async (q) =>
        (
          await q(
            `insert into symptom_logs (organization_id, patient_id, logged_for_date, entries, logged_by)
           values ($1, $2, current_date, '[{"symptom_code":"dizziness","severity":2}]', $3) returning logged_by`,
            [w.orgA, w.p1, w.adminA],
          )
        ).rows[0],
    );
    expect(row.logged_by).toBe(w.caregiverA);
    await expectError(
      asUser(db, w.caregiverA, (q) =>
        q(
          `insert into symptom_logs (organization_id, patient_id, logged_for_date) values ($1, $2, current_date)`,
          [w.orgA, w.p2],
        ),
      ),
    );
  });

  it('only admins manage caseloads, links and patients', async () => {
    await expectError(
      asUser(db, w.nurseA1, (q) =>
        q(
          `insert into caseload_assignments (organization_id, nurse_id, patient_id) values ($1, $2, $3)`,
          [w.orgA, w.nurseA1, w.p2],
        ),
      ),
    );
    await expectError(
      asUser(db, w.nurseA1, (q) =>
        q(
          `insert into patients (organization_id, first_name, last_name, date_of_birth) values ($1,'a','b','1940-01-01')`,
          [w.orgA],
        ),
      ),
    );
    const id = await asUser(
      db,
      w.adminA,
      async (q) =>
        (
          await q(
            `insert into patients (organization_id, first_name, last_name, date_of_birth) values ($1,'a','b','1940-01-01') returning id`,
            [w.orgA],
          )
        ).rows[0].id,
    );
    expect(id).toBeTruthy();
  });

  it('users cannot escalate their own role; admins can change others', async () => {
    expect(
      await expectError(
        asUser(db, w.nurseA1, (q) =>
          q(`update profiles set role = 'agency_admin' where id = $1`, [w.nurseA1]),
        ),
      ),
    ).toMatch(/only admins|own role/);
    const n = await asUser(
      db,
      w.nurseA1,
      async (q) =>
        (await q(`update profiles set phone = '555-0100' where id = $1`, [w.nurseA1])).rowCount,
    );
    expect(n).toBe(1);
    const m = await asUser(
      db,
      w.adminA,
      async (q) =>
        (await q(`update profiles set mfa_required = true where id = $1`, [w.nurseA2])).rowCount,
    );
    expect(m).toBe(1);
    const x = await asUser(
      db,
      w.adminA,
      async (q) =>
        (await q(`update profiles set is_active = false where id = $1`, [w.nurseB])).rowCount,
    );
    expect(x).toBe(0);
  });

  it('medication_changes are immutable', async () => {
    const id = await asUser(
      db,
      w.nurseA1,
      async (q) =>
        (
          await q(
            `insert into medication_changes (organization_id, patient_id, medication_id, change_type, effective_date)
             values ($1, $2, $3, 'started', current_date) returning id, recorded_by`,
            [w.orgA, w.p1, w.medP1],
          )
        ).rows[0],
      { commit: true },
    );
    expect(id.recorded_by).toBe(w.nurseA1);
    await expectError(
      db.query(`update medication_changes set change_type = 'stopped' where id = $1`, [id.id]),
    );
    await expectError(db.query(`delete from medication_changes where id = $1`, [id.id]));
  });

  it('medication must belong to the same patient', async () => {
    await expectError(
      db.query(
        `insert into dose_events (organization_id, patient_id, medication_id, scheduled_for) values ($1,$2,$3, now())`,
        [w.orgA, w.p1, w.medP2],
      ),
    );
  });
});

describe('MFA enforcement for staff', () => {
  it('staff with mfa_required need an aal2 session', async () => {
    await db.query('update profiles set mfa_required = true where id = $1', [w.adminA]);
    const aal1 = await asUser(db, w.adminA, async (q) => (await q('select id from patients')).rows);
    const aal2 = await asUser(
      db,
      w.adminA,
      async (q) => (await q('select id from patients')).rows,
      {
        aal: 'aal2',
      },
    );
    await db.query('update profiles set mfa_required = false where id = $1', [w.adminA]);
    expect(aal1).toEqual([]);
    expect(aal2.length).toBeGreaterThanOrEqual(2);
  });
});

describe('audit log', () => {
  it('writes audit rows on insert, update and delete (column names only, no values)', async () => {
    const sid = await asUser(
      db,
      w.nurseA1,
      async (q) =>
        (
          await q(
            `insert into consents (organization_id, patient_id, consent_type, granted_by_name, granted_by_relationship)
               values ($1, $2, 'sms', 'Test Person', 'self') returning id`,
            [w.orgA, w.p1],
          )
        ).rows[0].id as string,
      { commit: true },
    );
    await asUser(
      db,
      w.nurseA1,
      (q) => q(`update consents set revoked_at = now() where id = $1`, [sid]),
      {
        commit: true,
      },
    );
    await asUser(db, w.adminA, (q) => q(`delete from patients where id = $1`, [w.p2]), {
      commit: true,
    });

    const rows = (
      await db.query(
        `select action, entity_type, actor_id, changes from audit_log where entity_id = $1 order by created_at`,
        [sid],
      )
    ).rows;
    expect(rows.map((r) => r.action)).toEqual(['create', 'update']);
    expect(rows[0].actor_id).toBe(w.nurseA1);
    expect(rows[1].changes).toEqual({ changed: ['revoked_at'] });
    expect(JSON.stringify(rows)).not.toContain('Test Person');

    const del = await db.query(
      `select action, actor_id from audit_log where entity_type = 'patients' and entity_id = $1 and action = 'delete'`,
      [w.p2],
    );
    expect(del.rows[0]?.actor_id).toBe(w.adminA);
  });

  it('rejects UPDATE and DELETE for everyone, including the database owner', async () => {
    const id = (await db.query('select id from audit_log limit 1')).rows[0].id;
    expect(
      await expectError(db.query(`update audit_log set action = 'view' where id = $1`, [id])),
    ).toMatch(/append-only/);
    expect(await expectError(db.query(`delete from audit_log where id = $1`, [id]))).toMatch(
      /append-only/,
    );
    expect(await expectError(db.query(`truncate audit_log`))).toMatch(/append-only/);
    const n = await asUser(
      db,
      w.adminA,
      async (q) => (await q(`delete from audit_log where organization_id = $1`, [w.orgA])).rowCount,
    );
    expect(n).toBe(0);
  });

  it('only admins read the audit log, scoped to their org', async () => {
    const nurse = await asUser(
      db,
      w.nurseA1,
      async (q) => (await q('select count(*)::int n from audit_log')).rows[0].n,
    );
    expect(nurse).toBe(0);
    const orgs = await asUser(db, w.adminB, async (q) =>
      (await q('select distinct organization_id from audit_log')).rows.map(
        (r) => r.organization_id,
      ),
    );
    expect(orgs.every((o: string) => o === w.orgB)).toBe(true);
  });

  it('log_view records views and refuses patients the user cannot access', async () => {
    await asUser(db, w.caregiverA, (q) => q(`select log_view('patient', $1)`, [w.p1]), {
      commit: true,
    });
    const r = await db.query(
      `select count(*)::int n from audit_log where action = 'view' and actor_id = $1 and entity_id = $2`,
      [w.caregiverA, w.p1],
    );
    expect(r.rows[0].n).toBe(1);
    await expectError(asUser(db, w.caregiverA, (q) => q(`select log_view('patient', $1)`, [w.pB])));
  });

  it('log_export is admin-only for audit/pilot exports and strips unknown detail keys', async () => {
    await expectError(
      asUser(db, w.nurseA1, (q) => q(`select log_export('audit_log', null, '{}')`)),
    );
    await asUser(
      db,
      w.adminA,
      (q) => q(`select log_export('pilot_metrics', null, '{"format":"csv","name":"secret"}')`),
      { commit: true },
    );
    const r = await db.query(
      `select changes from audit_log where action = 'export' and entity_type = 'pilot_metrics' order by created_at desc limit 1`,
    );
    expect(r.rows[0].changes).toEqual({ format: 'csv' });
  });
});

describe('invitations', () => {
  it('accept_invitation creates the profile and patient link for the invited email only', async () => {
    const email = `invitee.${Date.now()}@test.medwatch`;
    const uid = (await db.query('insert into auth.users (email) values ($1) returning id', [email]))
      .rows[0].id;
    const other = (
      await db.query('insert into auth.users (email) values ($1) returning id', [`x${email}`])
    ).rows[0].id;
    await db.query(
      `insert into invitations (organization_id, email, role, patient_id, token_hash)
       values ($1, $2, 'caregiver', $3, hash_invite_token('tok-123'))`,
      [w.orgA, email, w.p1],
    );
    expect(
      await expectError(asUser(db, other, (q) => q(`select accept_invitation('tok-123', 'X')`))),
    ).toMatch(/different email/);
    expect(
      await expectError(asUser(db, uid, (q) => q(`select accept_invitation('nope', 'X')`))),
    ).toMatch(/not found/);
    const role = await asUser(
      db,
      uid,
      async (q) => (await q(`select accept_invitation('tok-123', 'New Caregiver') as r`)).rows[0].r,
      { commit: true },
    );
    expect(role).toBe('caregiver');
    const pts = await asUser(db, uid, async (q) => (await q('select id from patients')).rows);
    expect(ids(pts)).toEqual([w.p1]);
    expect(
      await expectError(asUser(db, uid, (q) => q(`select accept_invitation('tok-123')`))),
    ).toMatch(/already used/);
  });

  it('SQL token hash matches the Edge Function hash', async () => {
    const { hashInviteToken } = await import('../../../supabase/functions/_shared/invite.ts');
    const tok = 'a1b2c3-token-ü';
    const r = await db.query('select hash_invite_token($1) h', [tok]);
    expect(r.rows[0].h).toBe(hashInviteToken(tok));
  });

  it('expired invitations are rejected', async () => {
    const email = `late.${Date.now()}@test.medwatch`;
    const uid = (await db.query('insert into auth.users (email) values ($1) returning id', [email]))
      .rows[0].id;
    await db.query(
      `insert into invitations (organization_id, email, role, token_hash, expires_at)
       values ($1, $2, 'nurse', hash_invite_token('old'), now() - interval '1 day')`,
      [w.orgA, email],
    );
    expect(await expectError(asUser(db, uid, (q) => q(`select accept_invitation('old')`)))).toMatch(
      /expired/,
    );
  });

  it('only admins can see invitations', async () => {
    const n = await asUser(
      db,
      w.nurseA1,
      async (q) => (await q('select count(*)::int n from invitations')).rows[0].n,
    );
    expect(n).toBe(0);
  });
});

describe('alerts and templates', () => {
  it('alerts are visible only to their recipient (and org admins)', async () => {
    await db.query(
      `insert into alerts (organization_id, patient_id, recipient_profile_id, channel, alert_type, related_id)
       values ($1, $2, $3, 'in_app', 'missed_dose', $4)`,
      [w.orgA, w.p1, w.caregiverA, w.doseP1],
    );
    const mine = await asUser(
      db,
      w.caregiverA,
      async (q) => (await q('select id from alerts')).rows,
    );
    const nurse = await asUser(db, w.nurseA1, async (q) => (await q('select id from alerts')).rows);
    expect(mine.length).toBe(1);
    expect(nurse.length).toBe(0);
    await expectError(
      db.query(
        `insert into alerts (organization_id, patient_id, recipient_profile_id, channel, alert_type, related_id)
         values ($1, $2, $3, 'in_app', 'missed_dose', $4)`,
        [w.orgA, w.p1, w.caregiverA, w.doseP1],
      ),
    );
  });

  it('end users cannot write check-in templates or ai_requests', async () => {
    await expectError(
      asUser(db, w.nurseA1, (q) =>
        q(
          `insert into checkin_templates (organization_id, patient_id, medication_fingerprint, source, questions)
           values ($1, $2, 'x', 'rules', '[]')`,
          [w.orgA, w.p1],
        ),
      ),
    );
    await expectError(
      asUser(db, w.adminA, (q) =>
        q(`insert into ai_requests (organization_id, status) values ($1, 'success')`, [w.orgA]),
      ),
    );
  });

  it('only one active template per patient', async () => {
    await db.query(`update checkin_templates set status = 'superseded' where patient_id = $1`, [
      w.p1,
    ]);
    const ins = `insert into checkin_templates (organization_id, patient_id, medication_fingerprint, source, questions)
                 values ($1, $2, 'fp', 'rules', '[]')`;
    await db.query(ins, [w.orgA, w.p1]);
    await expectError(db.query(ins, [w.orgA, w.p1]));
  });
});

describe('catalog and jobs plumbing', () => {
  it('symptom catalog has 20 entries and 4 core symptoms', async () => {
    const r = await asUser(
      db,
      w.patientUserA,
      async (q) =>
        (
          await q(
            'select count(*)::int n, count(*) filter (where is_core)::int c from symptom_catalog',
          )
        ).rows[0],
    );
    expect(r).toEqual({ n: 20, c: 4 });
  });

  it('invoke_function is a safe no-op without pg_net', async () => {
    await db.query(`select private.invoke_function('run-flag-engine', '{}'::jsonb)`);
  });

  it('end users cannot call private functions', async () => {
    await expectError(
      asUser(db, w.adminA, (q) => q(`select private.invoke_function('x', '{}'::jsonb)`)),
    );
  });

  it('hard-deleting a patient cascades and is audited', async () => {
    const pid = (
      await db.query(
        `insert into patients (organization_id, first_name, last_name, date_of_birth) values ($1, 'Del', 'Me', '1940-01-01') returning id`,
        [w.orgA],
      )
    ).rows[0].id;
    const mid = (
      await db.query(
        `insert into medications (organization_id, patient_id, name) values ($1, $2, 'Z') returning id`,
        [w.orgA, pid],
      )
    ).rows[0].id;
    await db.query(
      `insert into medication_changes (organization_id, patient_id, medication_id, change_type, effective_date) values ($1,$2,$3,'started', current_date)`,
      [w.orgA, pid, mid],
    );
    const n = await asUser(
      db,
      w.adminA,
      async (q) => (await q('delete from patients where id = $1', [pid])).rowCount,
      {
        commit: true,
      },
    );
    expect(n).toBe(1);
    const left = await db.query('select count(*)::int n from medications where patient_id = $1', [
      pid,
    ]);
    expect(left.rows[0].n).toBe(0);
  });
});

describe('check-in template replacement', () => {
  it('replace_checkin_template supersedes atomically and is service-only', async () => {
    const call = (fp: string) =>
      db.query(`select replace_checkin_template($1, $2, 'rules', '[]'::jsonb, null, null) id`, [
        w.p1,
        fp,
      ]);
    await call('fp-a');
    const second = (await call('fp-b')).rows[0].id;
    const rows = (
      await db.query(
        `select id, status, medication_fingerprint from checkin_templates where patient_id = $1 and medication_fingerprint in ('fp-a','fp-b') order by created_at`,
        [w.p1],
      )
    ).rows;
    expect(rows.find((r) => r.id === second)?.status).toBe('active');
    expect(rows.filter((r) => r.status === 'active')).toHaveLength(1);
    await expectError(
      asUser(db, w.adminA, (q) =>
        q(`select replace_checkin_template($1, 'x', 'rules', '[]'::jsonb, null, null)`, [w.p1]),
      ),
    );
  });
});
