/**
 * In-memory stand-in for the MedWatch database, seeded by the real synthetic generator.
 * Emulates the RLS rules and write guards closely enough to drive the UI in the sandbox.
 * LOCAL UI VERIFICATION ONLY — the real security boundary is tested against Postgres
 * (tests/db/local) and the cloud project (tests/db/cloud).
 */
import { randomUUID } from 'node:crypto';
import { generateSeed, type SeedData } from '../../supabase/seed/generate.ts';

export type Row = Record<string, unknown>;
export interface User {
  id: string;
  email: string;
  password: string;
  role: string;
  organization_id: string;
}

export const PATIENT_TABLES = new Set([
  'patient_links',
  'consents',
  'medications',
  'medication_changes',
  'dose_events',
  'symptom_logs',
  'checkin_templates',
  'flags',
  'visit_summaries',
]);

export class MockDb {
  tables: Record<string, Row[]> = {};
  users: User[] = [];
  seed: SeedData;

  constructor(now = new Date()) {
    this.seed = generateSeed({ now });
    const stamp = (r: Row) => ({
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      ...r,
    });
    for (const [t, rows] of Object.entries(this.seed.tables))
      this.tables[t] = rows.map((r) => stamp(structuredClone(r)));
    for (const t of ['audit_log', 'invitations', 'ai_requests', 'visit_summaries'])
      this.tables[t] ??= [];
    this.tables.symptom_catalog = [];
    for (const u of this.seed.users) {
      const p = this.tables.profiles!.find((x) => x.id === u.id)!;
      this.users.push({
        id: u.id,
        email: u.email,
        password: u.password,
        role: u.role,
        organization_id: p.organization_id as string,
      });
    }
  }

  t(name: string): Row[] {
    return (this.tables[name] ??= []);
  }

  profile(uid: string): Row | undefined {
    return this.t('profiles').find((p) => p.id === uid && p.is_active !== false);
  }

  isStaff(uid: string) {
    const r = this.profile(uid)?.role;
    return r === 'nurse' || r === 'agency_admin';
  }

  isAdmin(uid: string) {
    return this.profile(uid)?.role === 'agency_admin';
  }

  accessible(uid: string): Set<string> {
    const me = this.profile(uid);
    if (!me) return new Set();
    const org = me.organization_id;
    const pts = this.t('patients').filter((p) => p.organization_id === org);
    switch (me.role) {
      case 'agency_admin':
        return new Set(pts.map((p) => p.id as string));
      case 'nurse': {
        const cl = new Set(
          this.t('caseload_assignments')
            .filter((c) => c.nurse_id === uid)
            .map((c) => c.patient_id),
        );
        return new Set(
          pts.filter((p) => p.primary_nurse_id === uid || cl.has(p.id)).map((p) => p.id as string),
        );
      }
      default: {
        const rel = me.role === 'patient' ? 'self' : 'caregiver';
        const linked = new Set(
          this.t('patient_links')
            .filter((l) => l.profile_id === uid && l.relationship === rel)
            .map((l) => l.patient_id),
        );
        return new Set(pts.filter((p) => linked.has(p.id)).map((p) => p.id as string));
      }
    }
  }

  canRead(uid: string, table: string, row: Row): boolean {
    const me = this.profile(uid);
    if (!me) return false;
    const acc = this.accessible(uid);
    const org = me.organization_id;
    switch (table) {
      case 'organizations':
        return row.id === org;
      case 'profiles':
        return (
          row.id === uid ||
          (row.organization_id === org &&
            (this.isStaff(uid) || row.role === 'nurse' || row.role === 'agency_admin'))
        );
      case 'patients':
        return acc.has(row.id as string);
      case 'caseload_assignments':
        return (
          row.organization_id === org &&
          this.isStaff(uid) &&
          (row.nurse_id === uid || this.isAdmin(uid))
        );
      case 'patient_links':
        return row.profile_id === uid || (this.isStaff(uid) && acc.has(row.patient_id as string));
      case 'alerts':
        return (
          row.recipient_profile_id === uid || (row.organization_id === org && this.isAdmin(uid))
        );
      case 'audit_log':
      case 'invitations':
      case 'ai_requests':
        return row.organization_id === org && this.isAdmin(uid);
      case 'symptom_catalog':
        return true;
      default:
        return PATCH_PATIENT(table) ? acc.has(row.patient_id as string) : false;
    }
  }

  canWrite(uid: string, table: string, row: Row, op: 'insert' | 'update' | 'delete'): boolean {
    const me = this.profile(uid);
    if (!me) return false;
    const staffAccess = this.isStaff(uid) && this.accessible(uid).has(row.patient_id as string);
    const access = this.accessible(uid).has(row.patient_id as string);
    switch (table) {
      case 'organizations':
        return op === 'update' && row.id === me.organization_id && this.isAdmin(uid);
      case 'profiles':
        return (
          op === 'update' &&
          (row.id === uid || (row.organization_id === me.organization_id && this.isAdmin(uid)))
        );
      case 'patients':
        if (op === 'update') return this.isStaff(uid) && this.accessible(uid).has(row.id as string);
        return row.organization_id === me.organization_id && this.isAdmin(uid);
      case 'patient_links':
      case 'caseload_assignments':
        return row.organization_id === me.organization_id && this.isAdmin(uid);
      case 'medications':
        return op === 'delete' ? staffAccess && this.isAdmin(uid) : staffAccess;
      case 'medication_changes':
      case 'consents':
      case 'visit_summaries':
        return op !== 'delete' && staffAccess;
      case 'dose_events':
        return op === 'update' ? access : op === 'insert' && staffAccess;
      case 'symptom_logs':
        return op === 'delete' ? staffAccess : access;
      case 'flags':
        return op === 'update' && staffAccess;
      case 'alerts':
        return op === 'update' && row.recipient_profile_id === uid;
      case 'invitations':
        return op === 'delete' && this.isAdmin(uid);
      default:
        return false;
    }
  }

  /** Column guards that mirror the database triggers. */
  applyUpdateGuards(uid: string, table: string, before: Row, patch: Row): Row {
    const next: Row = { ...before, ...patch, updated_at: new Date().toISOString() };
    const role = this.profile(uid)?.role;
    if (table === 'dose_events' && patch.status !== undefined && patch.status !== before.status) {
      if (next.status === 'pending')
        Object.assign(next, { confirmed_at: null, confirmed_by: null, confirmation_method: null });
      else
        Object.assign(next, {
          confirmed_by: uid,
          confirmed_at: new Date().toISOString(),
          confirmation_method:
            role === 'patient' ? 'patient_tap' : role === 'caregiver' ? 'caregiver_tap' : 'nurse',
        });
      if (role === 'patient' || role === 'caregiver') next.verification = before.verification;
    }
    if (table === 'flags' && patch.status !== undefined && patch.status !== before.status) {
      if (
        (next.status === 'dismissed' || next.status === 'escalated') &&
        !String(next.review_note ?? '').trim()
      )
        throw new Error('flag review requires a note');
      Object.assign(next, { reviewed_by: uid, reviewed_at: new Date().toISOString() });
    }
    return next;
  }

  insertDefaults(uid: string, table: string, row: Row): Row {
    const now = new Date().toISOString();
    const out: Row = { id: randomUUID(), created_at: now, updated_at: now, ...row };
    if (out.patient_id && table !== 'patients') {
      const p = this.t('patients').find((x) => x.id === out.patient_id);
      if (p) out.organization_id = p.organization_id;
    }
    if (table === 'symptom_logs') out.logged_by = uid;
    if (table === 'medication_changes') out.recorded_by = uid;
    if (table === 'medications')
      Object.assign(out, {
        status: out.status ?? 'active',
        prn: out.prn ?? false,
        schedule_times: out.schedule_times ?? [],
      });
    if (table === 'flags') out.status ??= 'open';
    if (table === 'patients')
      Object.assign(out, {
        status: out.status ?? 'active',
        last_visit_at: out.last_visit_at ?? null,
        notes: out.notes ?? null,
      });
    if (table === 'consents')
      Object.assign(out, { granted_at: out.granted_at ?? now, revoked_at: out.revoked_at ?? null });
    return out;
  }

  audit(
    uid: string | null,
    action: string,
    entity_type: string,
    entity_id: string | null,
    changes: Row | null = null,
  ) {
    const org = uid ? (this.profile(uid)?.organization_id ?? null) : null;
    this.t('audit_log').push({
      id: randomUUID(),
      organization_id: org,
      actor_id: uid,
      action,
      entity_type,
      entity_id,
      changes,
      created_at: new Date().toISOString(),
    });
  }
}

function PATCH_PATIENT(table: string) {
  return PATIENT_TABLES.has(table);
}
