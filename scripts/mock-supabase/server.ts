#!/usr/bin/env -S npx tsx
/**
 * Mock Supabase for local UI verification and demos without a cloud project:
 *   npx tsx scripts/mock-supabase/server.ts --port 54399
 * then run the web app with VITE_SUPABASE_URL=http://localhost:54399.
 *
 * Emulates the subset of Auth (password sign-in), PostgREST (select/filter/embed/insert/
 * upsert/update/delete), RPCs and Edge Functions that MedWatch uses, over the seeded
 * synthetic dataset. Not a security boundary and never used in production.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  SYMPTOM_CATALOG,
  getBundledRules,
  resolveOrgSettings,
  runFlagEngine,
  type DoseEvent,
  type ExistingFlag,
  type Medication,
  type MedicationChange,
  type SymptomLog,
} from '../../packages/core/src/index.ts';
import { MockAiProvider } from '../../supabase/functions/_shared/ai/mock.ts';
import { tailorCheckin, type TailorStore } from '../../supabase/functions/_shared/tailor/tailor.ts';
import {
  planMissedDoses,
  type CareTeam,
  type ExistingAlert,
} from '../../supabase/functions/_shared/jobs/planners.ts';
import { MockDb, type Row } from './db.ts';
import { applyFilters, project } from './postgrest.ts';
import { rpc } from './rpc.ts';

const out = (s: string) => process.stdout.write(`${s}\n`);
const portArg = process.argv.indexOf('--port');
const PORT = portArg > 0 ? Number(process.argv[portArg + 1]) : 54399;
const db = new MockDb();
const sessions = new Map<string, string>(); // token → user id

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function issue(uid: string) {
  const user = db.users.find((u) => u.id === uid)!;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, email: user.email, role: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: exp - 3600 }], exp, session_id: randomUUID() })}.mock`;
  sessions.set(token, uid);
  const refresh = randomUUID();
  sessions.set(`r:${refresh}`, uid);
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: refresh,
    user: authUser(uid),
  };
}
function authUser(uid: string) {
  const u = db.users.find((x) => x.id === uid)!;
  return {
    id: uid,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    app_metadata: {},
    user_metadata: {},
    factors: [],
    created_at: new Date().toISOString(),
  };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Profile',
};
function send(
  res: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}
function userOf(req: IncomingMessage): string | null {
  const t = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  return sessions.get(t) ?? null;
}
const pgErr = (res: ServerResponse, status: number, code: string, message: string) =>
  send(res, status, { code, message, details: null, hint: null });

// ---------------------------------------------------------------- engines on mock data
function runEngine(patientId: string) {
  const p = db.t('patients').find((x) => x.id === patientId);
  if (!p) return 0;
  const of = <T>(t: string) => db.t(t).filter((r) => r.patient_id === patientId) as unknown as T[];
  const drafts = runFlagEngine({
    patient: { id: patientId, organization_id: p.organization_id as string },
    medications: of<Medication>('medications'),
    medicationChanges: of<MedicationChange>('medication_changes'),
    doseEvents: of<DoseEvent>('dose_events'),
    symptomLogs: of<SymptomLog>('symptom_logs'),
    existingFlags: of<ExistingFlag>('flags'),
    rules: getBundledRules(),
    settings: resolveOrgSettings({}),
    now: new Date(),
    timezone: 'America/New_York',
  });
  for (const d of drafts) {
    if (d.upgrades_flag_id) {
      Object.assign(db.t('flags').find((f) => f.id === d.upgrades_flag_id)!, {
        severity: d.severity,
        explanation: d.explanation,
        evidence: d.evidence,
      });
    } else {
      const { upgrades_flag_id: _u, ...rest } = d;
      db.t('flags').push({
        id: randomUUID(),
        ...rest,
        status: 'open',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
      });
    }
  }
  return drafts.length;
}

function runMissedDoses() {
  const org = db.t('organizations')[0]!;
  const teams = new Map<string, CareTeam>();
  for (const p of db.t('patients'))
    teams.set(p.id as string, {
      caregivers: [],
      nurses: p.primary_nurse_id ? [p.primary_nurse_id as string] : [],
    });
  for (const l of db.t('patient_links'))
    if (l.relationship === 'caregiver')
      teams.get(l.patient_id as string)?.caregivers.push(l.profile_id as string);
  const since = Date.now() - 48 * 36e5;
  const doses = db
    .t('dose_events')
    .filter(
      (d) =>
        ['pending', 'missed'].includes(d.status as string) &&
        Date.parse(d.scheduled_for as string) >= since &&
        Date.parse(d.scheduled_for as string) <= Date.now(),
    );
  const plan = planMissedDoses({
    doses: doses as unknown as DoseEvent[],
    medications: db.t('medications') as unknown as Medication[],
    organizationId: org.id as string,
    timezone: 'America/New_York',
    settings: resolveOrgSettings(org.settings),
    teams,
    admins: db
      .t('profiles')
      .filter((p) => p.role === 'agency_admin')
      .map((p) => p.id as string),
    existingAlerts: db
      .t('alerts')
      .filter((a) => a.channel === 'in_app') as unknown as ExistingAlert[],
    now: new Date(),
  });
  for (const d of db.t('dose_events')) {
    if (plan.markMissed.includes(d.id as string)) d.status = 'missed';
    if (plan.markStopped.includes(d.id as string))
      Object.assign(d, { status: 'skipped', note: 'Medicine stopped' });
  }
  for (const a of plan.alerts)
    db.t('alerts').push({
      id: randomUUID(),
      ...a,
      channel: 'in_app',
      delivery_status: 'delivered',
      sent_at: new Date().toISOString(),
      read_at: null,
      created_at: new Date().toISOString(),
    });
  return { missed: plan.markMissed.length, alerts: plan.alerts.length };
}

const store: TailorStore = {
  async loadContext(id) {
    const p = db.t('patients').find((x) => x.id === id);
    if (!p) return null;
    return {
      patientId: id,
      organizationId: p.organization_id as string,
      dateOfBirth: p.date_of_birth as string,
      timezone: 'America/New_York',
      medications: db
        .t('medications')
        .filter((m) => m.patient_id === id) as unknown as Medication[],
      changes: db
        .t('medication_changes')
        .filter((m) => m.patient_id === id) as unknown as MedicationChange[],
    };
  },
  async getActiveTemplate(id) {
    const t = db.t('checkin_templates').find((x) => x.patient_id === id && x.status === 'active');
    return t
      ? {
          id: t.id as string,
          medication_fingerprint: t.medication_fingerprint as string,
          source: t.source as 'ai',
        }
      : null;
  },
  async countAiRequestsSince(id, since) {
    return db
      .t('ai_requests')
      .filter((r) => r.patient_id === id && (r.created_at as string) >= since).length;
  },
  async recordAiRequest(meta) {
    db.t('ai_requests').push({ id: randomUUID(), ...meta, created_at: new Date().toISOString() });
  },
  async saveTemplate(t) {
    for (const x of db.t('checkin_templates'))
      if (x.patient_id === t.patient_id && x.status === 'active') x.status = 'superseded';
    const id = randomUUID();
    db.t('checkin_templates').push({
      id,
      ...t,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { id };
  },
};

// ---------------------------------------------------------------- REST
async function rest(req: IncomingMessage, res: ServerResponse, url: URL, uid: string) {
  const table = url.pathname.replace('/rest/v1/', '');
  const params = url.searchParams;
  const select = params.get('select');
  const prefer = String(req.headers.prefer ?? '');
  const wantsObject = String(req.headers.accept ?? '').includes('vnd.pgrst.object');
  const reply = (rows: Row[], status = 200) => {
    const shaped = rows.map((r) => project(db, uid, table, r, select));
    if (wantsObject) {
      if (shaped.length !== 1)
        return pgErr(res, 406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned');
      return send(res, status, shaped[0]);
    }
    return send(res, status, shaped, {
      'Content-Range': `0-${Math.max(0, shaped.length - 1)}/${shaped.length}`,
    });
  };

  if (table.startsWith('rpc/')) {
    try {
      return send(
        res,
        200,
        rpc(db, uid, table.slice(4), (await readBody(req)) as Record<string, unknown>),
      );
    } catch (e) {
      return pgErr(res, 400, (e as { code?: string }).code ?? 'P0001', (e as Error).message);
    }
  }

  const visible = db.t(table).filter((r) => db.canRead(uid, table, r));
  if (req.method === 'GET' || req.method === 'HEAD') {
    const rows = applyFilters(visible, params);
    if (req.method === 'HEAD')
      return send(res, 200, undefined, { 'Content-Range': `0-0/${rows.length}` });
    return reply(rows);
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    const items = (Array.isArray(body) ? body : [body]) as Row[];
    const conflict = params.get('on_conflict')?.split(',');
    const created: Row[] = [];
    for (const item of items) {
      const row = db.insertDefaults(uid, table, item);
      if (!db.canWrite(uid, table, row, 'insert')) {
        if (!(conflict && prefer.includes('merge-duplicates')))
          return pgErr(
            res,
            403,
            '42501',
            `new row violates row-level security policy for table "${table}"`,
          );
      }
      const existing = conflict
        ? db.t(table).find((r) => conflict.every((c) => String(r[c]) === String(row[c])))
        : undefined;
      if (existing) {
        if (!db.canWrite(uid, table, existing, 'update'))
          return pgErr(res, 403, '42501', 'row-level security');
        Object.assign(existing, db.applyUpdateGuards(uid, table, existing, item));
        db.audit(uid, 'update', table, existing.id as string);
        created.push(existing);
      } else {
        if (!db.canWrite(uid, table, row, 'insert'))
          return pgErr(res, 403, '42501', 'row-level security');
        db.t(table).push(row);
        db.audit(uid, 'create', table, row.id as string);
        created.push(row);
      }
    }
    return prefer.includes('return=representation') ? reply(created, 201) : send(res, 201);
  }
  if (req.method === 'PATCH') {
    const patch = (await readBody(req)) as Row;
    const targets = applyFilters(visible, params).filter((r) =>
      db.canWrite(uid, table, r, 'update'),
    );
    const updated: Row[] = [];
    for (const r of targets) {
      try {
        Object.assign(r, db.applyUpdateGuards(uid, table, r, patch));
      } catch (e) {
        return pgErr(res, 400, '23514', (e as Error).message);
      }
      db.audit(uid, 'update', table, r.id as string, { changed: Object.keys(patch) });
      updated.push(r);
    }
    return prefer.includes('return=representation') ? reply(updated) : send(res, 204);
  }
  if (req.method === 'DELETE') {
    const targets = applyFilters(visible, params).filter((r) =>
      db.canWrite(uid, table, r, 'delete'),
    );
    for (const r of targets) {
      db.tables[table] = db.t(table).filter((x) => x !== r);
      if (table === 'patients')
        for (const t of Object.keys(db.tables))
          if (t !== 'audit_log') db.tables[t] = db.t(t).filter((x) => x.patient_id !== r.id);
      db.audit(uid, 'delete', table, r.id as string);
    }
    return prefer.includes('return=representation') ? reply(targets) : send(res, 204);
  }
  return pgErr(res, 405, 'PGRST000', 'method not allowed');
}

// ---------------------------------------------------------------- server
createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (req.method === 'OPTIONS') return send(res, 204);
    if (url.pathname === '/__health')
      return send(res, 200, { ok: true, users: db.users.map((u) => u.email) });
    // Test helper: story → patient id (ids only, synthetic data).
    if (url.pathname === '/__seed')
      return send(res, 200, {
        stories: Object.fromEntries(db.seed.stories.map((s) => [s.key, s.patient_id])),
      });

    if (url.pathname === '/auth/v1/token') {
      const body = (await readBody(req)) as Record<string, string>;
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const uid = sessions.get(`r:${body.refresh_token}`);
        return uid
          ? send(res, 200, issue(uid))
          : send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      }
      const u = db.users.find(
        (x) => x.email === String(body.email ?? '').toLowerCase() && x.password === body.password,
      );
      return u
        ? send(res, 200, issue(u.id))
        : send(res, 400, {
            error: 'invalid_grant',
            error_description: 'Invalid login credentials',
            code: 'invalid_credentials',
          });
    }
    if (url.pathname === '/auth/v1/user') {
      const uid = userOf(req);
      return uid ? send(res, 200, authUser(uid)) : send(res, 401, { message: 'invalid JWT' });
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204);
    if (url.pathname === '/auth/v1/recover') return send(res, 200, {});
    if (url.pathname.startsWith('/auth/v1/')) return send(res, 200, {});

    // Test-only helpers (mock server only).
    if (url.pathname === '/__test/pending-dose' && req.method === 'POST') {
      const body = (await readBody(req)) as { patient_id: string; hours_ago: number };
      const med = db
        .t('medications')
        .find((m) => m.patient_id === body.patient_id && m.status === 'active' && !m.prn)!;
      const id = randomUUID();
      db.t('dose_events').push({
        id,
        organization_id: med.organization_id,
        patient_id: body.patient_id,
        medication_id: med.id,
        scheduled_for: new Date(Date.now() - body.hours_ago * 36e5).toISOString(),
        status: 'pending',
        verification: 'reported',
        note: null,
        confirmed_at: null,
        confirmed_by: null,
        confirmation_method: null,
      });
      return send(res, 200, { id });
    }
    if (
      url.pathname === '/functions/v1/check-missed-doses' &&
      req.headers['x-cron-secret'] === 'mock-cron'
    )
      return send(res, 200, runMissedDoses());

    const uid = userOf(req);
    if (url.pathname.startsWith('/functions/v1/')) {
      if (!uid) return send(res, 401, { error: 'missing_token' });
      const name = url.pathname.replace('/functions/v1/', '');
      const body = (await readBody(req)) as Record<string, unknown>;
      const pid = String(body.patient_id ?? '');
      if (pid && !db.accessible(uid).has(pid))
        return send(res, 404, { error: 'patient_not_found' });
      if (name === 'run-flag-engine') return send(res, 200, { created: runEngine(pid) });
      if (name === 'tailor-checkin') {
        const r = await tailorCheckin(
          pid,
          {
            store,
            provider: new MockAiProvider('valid'),
            catalog: SYMPTOM_CATALOG,
            rules: getBundledRules(),
          },
          { force: body.force === true && db.isStaff(uid) },
        );
        return send(res, 200, r);
      }
      if (name === 'invite-user') {
        if (!db.isAdmin(uid)) return send(res, 403, { error: 'forbidden' });
        const id = randomUUID();
        db.t('invitations').push({
          id,
          organization_id: db.profile(uid)!.organization_id,
          email: body.email,
          role: body.role,
          full_name: body.full_name ?? null,
          patient_id: body.patient_id ?? null,
          token_hash: randomUUID(),
          expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
          accepted_at: null,
          created_at: new Date().toISOString(),
        });
        return send(res, 200, { invitation_id: id });
      }
      return send(res, 200, {});
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (!uid) return send(res, url.pathname === '/rest/v1/symptom_catalog' ? 200 : 200, []);
      return await rest(req, res, url, uid);
    }
    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    out(`mock-supabase error: ${(e as Error).message}`);
    return send(res, 500, { code: 'XX000', message: 'mock error' });
  }
}).listen(PORT, () =>
  out(`mock-supabase listening on http://localhost:${PORT} (${db.users.length} demo users)`),
);
