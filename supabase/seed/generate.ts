/**
 * Deterministic synthetic dataset for the demo organization (spec §13).
 * Pure: given (seed, now) it always returns the same rows. Writers in ./writers insert them.
 *
 * Flags are not hand-written: the real flag engine is replayed day by day over the generated
 * history (at 12:00 local each day, then at `now`), exactly as the hourly job would have run.
 */
import {
  SYMPTOM_CATALOG,
  addDays,
  buildRulesCheckin,
  evaluateMissedDoses,
  generateExpectedDoses,
  getBundledRules,
  localDate,
  medicationFingerprint,
  resolveOrgSettings,
  runFlagEngine,
  zonedTimeToUtc,
  SEVERITY_RANK,
  type CheckinQuestion,
  type DoseEvent,
  type ExistingFlag,
  type FlagDraft,
  type Medication,
  type MedicationChange,
  type SymptomEntry,
  type SymptomLog,
} from '../../packages/core/src/index.ts';
import { Prng } from './prng.ts';
import {
  BACKGROUND_POOL,
  DEMO_EMAIL_DOMAIN,
  DEMO_ORG_NAME,
  DEMO_PASSWORD,
  FIRST_NAMES,
  FORMULARY,
  LAST_NAMES,
  ONE_PER_CLASS,
  STAFF,
} from './fixtures.ts';

export const TZ = 'America/New_York';
export const HISTORY_DAYS = 45;
export const PATIENT_COUNT = 25;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Row = Record<string, unknown>;

export interface SeedUser {
  id: string;
  email: string;
  password: string;
  role: string;
  full_name: string;
}

export interface ExpectedFlag {
  story: string;
  patient_id: string;
  flag_type: string;
  severity: string;
  title: string;
}

export interface SeedData {
  now: string;
  today: string;
  users: SeedUser[];
  tables: {
    organizations: Row[];
    profiles: Row[];
    patients: Row[];
    caseload_assignments: Row[];
    patient_links: Row[];
    consents: Row[];
    medications: Row[];
    medication_changes: Row[];
    dose_events: Row[];
    symptom_logs: Row[];
    checkin_templates: Row[];
    flags: Row[];
    alerts: Row[];
  };
  expected: ExpectedFlag[];
  stories: { key: string; patient_id: string; description: string }[];
}

/** Insert order respecting foreign keys. */
export const TABLE_ORDER = [
  'organizations',
  'profiles',
  'patients',
  'caseload_assignments',
  'patient_links',
  'consents',
  'medications',
  'medication_changes',
  'dose_events',
  'symptom_logs',
  'checkin_templates',
  'flags',
  'alerts',
] as const;

interface PatientPlan {
  id: string;
  index: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  nurseKey: 'nurse1' | 'nurse2' | 'nurse3';
  caregiverKey?: 'caregiver1' | 'caregiver2';
  selfUser?: boolean;
  story?: 1 | 2 | 3 | 4 | 5;
  givenRate: number;
  meds: Medication[];
  changes: MedicationChange[];
  template: CheckinQuestion[];
}

export function generateSeed(opts: { now?: Date | string; seed?: number } = {}): SeedData {
  const now = new Date(opts.now ?? new Date());
  const nowMs = now.getTime();
  const today = localDate(now, TZ);
  const day = (offset: number) => addDays(today, offset);
  const historyStart = day(-(HISTORY_DAYS - 1));
  const rng = new Prng(opts.seed ?? 20261006);
  const rules = getBundledRules();
  const settings = resolveOrgSettings({});
  const iso = (ms: number) => new Date(ms).toISOString();

  // ---------------------------------------------------------------- org + staff
  const orgId = rng.uuid();
  const organizations: Row[] = [{ id: orgId, name: DEMO_ORG_NAME, timezone: TZ, settings }];

  const users: SeedUser[] = [];
  const userIds: Record<string, string> = {};
  const profiles: Row[] = [];
  for (const [key, s] of Object.entries(STAFF)) {
    const id = rng.uuid();
    userIds[key] = id;
    users.push({
      id,
      email: s.email,
      password: DEMO_PASSWORD,
      role: s.role,
      full_name: s.full_name,
    });
    profiles.push({
      id,
      organization_id: orgId,
      role: s.role,
      full_name: s.full_name,
      email: s.email,
      phone: key.startsWith('caregiver')
        ? `555-01${String(10 + users.length).padStart(2, '0')}`
        : null,
      sms_opt_in: key === 'caregiver1',
      sms_opt_in_at: key === 'caregiver1' ? iso(nowMs - 30 * 24 * HOUR) : null,
      mfa_required: false, // demo accounts only — see README
      is_active: true,
    });
  }

  // ---------------------------------------------------------------- patients
  const firstNames = rng.shuffle(FIRST_NAMES);
  const lastNames = rng.shuffle(LAST_NAMES);
  const plans: PatientPlan[] = [];
  for (let i = 0; i < PATIENT_COUNT; i++) {
    const age = rng.int(68, 94);
    // Exactly `age` years old today: (today − age years) minus 1–364 days.
    const anniversary = `${Number(today.slice(0, 4)) - age}-${today.slice(5) === '02-29' ? '02-28' : today.slice(5)}`;
    const dob = addDays(anniversary, -rng.int(1, 364));
    const nurseKey = i < 8 ? 'nurse1' : i < 16 ? 'nurse2' : 'nurse3';
    plans.push({
      id: rng.uuid(),
      index: i,
      first_name: firstNames[i % firstNames.length]!,
      last_name: lastNames[i % lastNames.length]!,
      date_of_birth: dob,
      nurseKey,
      givenRate: 0.985,
      meds: [],
      changes: [],
      template: [],
    });
  }
  // Story assignment and links (demo accounts see the stories).
  const P = (n: number) => plans[n - 1]!;
  P(1).story = 1;
  P(1).selfUser = true;
  P(1).caregiverKey = 'caregiver1';
  P(2).story = 2;
  P(2).caregiverKey = 'caregiver1';
  P(9).story = 3;
  P(9).caregiverKey = 'caregiver2';
  P(10).story = 4;
  P(10).caregiverKey = 'caregiver2';
  P(17).story = 5;
  // a couple of background patients with weaker reported adherence
  P(6).givenRate = 0.9;
  P(20).givenRate = 0.92;

  // patient1 app user = patient 1 themself
  {
    const id = rng.uuid();
    userIds.patient1 = id;
    const email = `patient1@${DEMO_EMAIL_DOMAIN}`;
    const name = `${P(1).first_name} ${P(1).last_name}`;
    users.push({ id, email, password: DEMO_PASSWORD, role: 'patient', full_name: name });
    profiles.push({
      id,
      organization_id: orgId,
      role: 'patient',
      full_name: name,
      email,
      phone: null,
      sms_opt_in: false,
      mfa_required: false,
      is_active: true,
    });
  }

  // ---------------------------------------------------------------- medications
  const addMed = (plan: PatientPlan, key: string, start: string, o: Partial<Medication> = {}) => {
    const f = FORMULARY[key]!;
    const m: Medication = {
      id: rng.uuid(),
      organization_id: orgId,
      patient_id: plan.id,
      name: f.name,
      generic_name: f.generic_name,
      drug_class: f.drug_class,
      dose_amount: f.dose_amount,
      dose_unit: f.dose_unit,
      route: f.route,
      frequency_label: f.frequency_label,
      schedule_times: f.schedule_times,
      prn: Boolean(f.prn),
      start_date: start,
      end_date: null,
      status: 'active',
      purpose: f.purpose,
      ...o,
    };
    plan.meds.push(m);
    plan.changes.push({
      id: rng.uuid(),
      patient_id: plan.id,
      medication_id: m.id,
      change_type: 'started',
      previous: null,
      current: {
        dose_amount: m.dose_amount,
        dose_unit: m.dose_unit,
        schedule_times: m.schedule_times,
      },
      effective_date: start,
    });
    return m;
  };

  for (const plan of plans) {
    const target = rng.int(4, 12);
    const storyKeys: Record<number, string[]> = {
      1: ['atorvastatin', 'lisinopril', 'levothyroxine', 'vitamin_d'],
      2: ['metformin', 'atorvastatin', 'vitamin_d', 'docusate'],
      3: ['apixaban', 'atorvastatin', 'metoprolol', 'calcium'],
      4: ['atorvastatin', 'levothyroxine', 'vitamin_d', 'docusate', 'multivitamin'],
      5: ['lisinopril', 'calcium', 'vitamin_d', 'oxybutynin'],
    };
    const chosen: string[] = [...(plan.story ? storyKeys[plan.story]! : [])];
    const classes = new Set(chosen.map((k) => FORMULARY[k]!.drug_class));
    // Story patients keep a short, focused list; others get 4–12 medicines.
    const want = plan.story ? Math.max(chosen.length, Math.min(target, 7)) : target;
    // Story patients avoid risk/interaction classes that would muddy their story.
    const pool = plan.story
      ? BACKGROUND_POOL.filter(
          (k) =>
            ![
              'diphenhydramine',
              'sertraline',
              'aspirin',
              'tamsulosin',
              'gabapentin',
              'omeprazole',
              'amlodipine',
              'hydrochlorothiazide',
              'furosemide',
            ].includes(k),
        )
      : BACKGROUND_POOL;
    for (const key of rng.shuffle(pool)) {
      if (chosen.length >= want) break;
      const cls = FORMULARY[key]!.drug_class;
      if (chosen.includes(key) || (ONE_PER_CLASS.has(cls) && classes.has(cls))) continue;
      chosen.push(key);
      classes.add(cls);
    }
    for (const key of chosen) {
      // Background medicines started long before the history window.
      const start = day(-rng.int(70, 900));
      if (plan.story === 5 && key === 'oxybutynin') {
        addMed(plan, key, day(-120), { status: 'stopped', end_date: day(-14) });
      } else if (plan.story === 3 && key === 'apixaban') {
        addMed(plan, key, day(-400));
      } else {
        addMed(plan, key, start);
      }
    }
    // Story medicines that start inside the history window
    if (plan.story === 1) addMed(plan, 'zolpidem', day(-5));
    if (plan.story === 2) addMed(plan, 'amlodipine', day(-6));
    if (plan.story === 3) addMed(plan, 'ibuprofen', day(-40));
    if (plan.story === 5) {
      const oxy = plan.meds.find((m) => m.name === 'Oxybutynin')!;
      plan.changes.push({
        id: rng.uuid(),
        patient_id: plan.id,
        medication_id: oxy.id,
        change_type: 'stopped',
        previous: { status: 'active' },
        current: { status: 'stopped' },
        effective_date: day(-13),
      });
    }
    plan.template = buildRulesCheckin(plan.meds, SYMPTOM_CATALOG, rules, today);
  }

  // ---------------------------------------------------------------- doses
  const doseEvents: (DoseEvent & Row)[] = [];
  const doseRows: Row[] = [];
  const linkedCaregiver = (plan: PatientPlan) =>
    plan.caregiverKey ? userIds[plan.caregiverKey]! : null;
  for (const plan of plans) {
    for (let d = historyStart; d <= day(1); d = addDays(d, 1)) {
      for (const draft of generateExpectedDoses(plan.meds, d, TZ)) {
        const t = Date.parse(draft.scheduled_for);
        const med = plan.meds.find((m) => m.id === draft.medication_id)!;
        const offset = Math.round(
          (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (24 * HOUR),
        );
        const evening = t - zonedTimeToUtc(d, '00:00', TZ).getTime() >= 17 * HOUR;
        let status: DoseEvent['status'];
        let note: string | null = null;
        const r = rng.next();
        const r2 = rng.next();
        if (t > nowMs - settings.missed_dose_grace_minutes * MINUTE) {
          // Not yet due, or inside the grace period: still pending.
          status = 'pending';
        } else if (plan.story === 2 && med.name === 'Amlodipine') {
          status = d === day(-6) ? 'given' : 'missed';
        } else if (
          plan.story === 4 &&
          med.name === 'Atorvastatin' &&
          offset >= -4 &&
          offset <= -1
        ) {
          status = 'missed';
        } else {
          const p = evening ? plan.givenRate - (1 - plan.givenRate) * 0.5 : plan.givenRate;
          if (r < p) status = 'given';
          else if (r2 < 0.75) status = 'missed';
          else if (r2 < 0.88) status = 'refused';
          else {
            status = 'skipped';
            note = 'Not available at dose time';
          }
        }
        const confirmer =
          plan.selfUser && r2 < 0.6
            ? { by: userIds.patient1!, method: 'patient_tap' }
            : { by: linkedCaregiver(plan), method: 'caregiver_tap' };
        const ev = {
          id: rng.uuid(),
          organization_id: orgId,
          patient_id: plan.id,
          medication_id: draft.medication_id,
          scheduled_for: draft.scheduled_for,
          status,
          note,
          confirmed_at:
            status === 'given' || status === 'refused' || status === 'skipped'
              ? iso(t + rng.int(0, 50) * MINUTE)
              : null,
          confirmed_by: status === 'pending' || status === 'missed' ? null : confirmer.by,
          confirmation_method:
            status === 'pending' || status === 'missed' ? null : confirmer.method,
          verification: 'reported',
        };
        doseEvents.push(ev as DoseEvent & Row);
        doseRows.push(ev);
      }
    }
  }

  // ---------------------------------------------------------------- symptom logs
  const logs: (SymptomLog & Row)[] = [];
  const storySymptoms = (plan: PatientPlan, offset: number): Record<string, number> => {
    switch (plan.story) {
      case 1:
        if (offset === -2) return { dizziness: 2, fall_or_near_fall: 2 };
        if (offset === -1) return { dizziness: 2 };
        return {};
      case 2:
        if (offset === -2) return { dizziness: 2 };
        if (offset === -1) return { dizziness: 1 };
        return {};
      case 5:
        if (offset >= -30 && offset <= -14)
          return { dry_mouth: 2, constipation: offset % 3 === 0 ? 3 : 2 };
        if (offset >= -12 && offset <= -8)
          return { dry_mouth: 1, constipation: offset % 2 === 0 ? 1 : 0 };
        return {};
      default:
        return {};
    }
  };
  for (const plan of plans) {
    const codes = plan.template.map((q) => q.symptom_code);
    for (let offset = -(HISTORY_DAYS - 1); offset <= 0; offset++) {
      const d = day(offset);
      const story = storySymptoms(plan, offset);
      const forced = Object.keys(story).length > 0;
      const r = rng.next();
      const symptomRoll = rng.next();
      const symptomPick = rng.next();
      // ~80% completion; today only some patients have checked in (never patient 1, so the
      // patient E2E flow has a check-in to complete).
      const completes = forced || (offset === 0 ? r < 0.45 && plan.index !== 0 : r < 0.8);
      if (!completes) continue;
      const values: Record<string, number> = Object.fromEntries(codes.map((c) => [c, 0]));
      if (!plan.story && symptomRoll < 0.1) {
        const nonCore = plan.template.filter((q) => !q.is_core).map((q) => q.symptom_code);
        const pickFrom = nonCore.length ? nonCore : codes;
        values[pickFrom[Math.floor(symptomPick * pickFrom.length)]!] = 1;
      }
      Object.assign(values, story);
      const entries: SymptomEntry[] = Object.entries(values).map(([symptom_code, severity]) => ({
        symptom_code,
        severity,
      }));
      const anySymptom = entries.some((e) => e.severity > 0);
      const loggedBy = plan.selfUser ? userIds.patient1! : linkedCaregiver(plan);
      const log = {
        id: rng.uuid(),
        organization_id: orgId,
        patient_id: plan.id,
        logged_for_date: d,
        logged_by: loggedBy,
        entries,
        overall_feeling: anySymptom ? rng.int(2, 3) : rng.int(3, 5),
        free_text: null,
      };
      logs.push(log as SymptomLog & Row);
    }
  }

  // ---------------------------------------------------------------- flag replay
  const flags: Row[] = [];
  const alerts: Row[] = [];
  const alertKeys = new Set<string>();
  const adminIds = [userIds.admin!];
  const pushAlert = (a: Row) => {
    const key = `${a.recipient_profile_id}:${a.alert_type}:${a.related_id}:${a.channel}`;
    if (alertKeys.has(key)) return;
    alertKeys.add(key);
    alerts.push({ id: rng.uuid(), organization_id: orgId, delivery_status: 'delivered', ...a });
  };

  for (const plan of plans) {
    const nurseId = userIds[plan.nurseKey]!;
    const pDoses = doseEvents.filter((d) => d.patient_id === plan.id);
    const pLogs = logs.filter((l) => l.patient_id === plan.id);
    const existing: (ExistingFlag & { row: Row })[] = [];
    const runs: number[] = [];
    for (let offset = -(HISTORY_DAYS - 1); offset <= 0; offset++) {
      const t = zonedTimeToUtc(day(offset), '12:00', TZ).getTime();
      if (t < nowMs) runs.push(t);
    }
    runs.push(nowMs);
    for (const runAt of runs) {
      const runDay = localDate(runAt, TZ);
      // Simulated nurse review of older flags (story patients 1–4 stay open for the demo).
      for (const f of existing) {
        if (f.status !== 'open' || (plan.story && plan.story <= 4)) continue;
        const delay = (f.row.__reviewDelayHours as number) * HOUR;
        const reviewAt = Date.parse(f.created_at) + delay;
        if (reviewAt <= runAt) {
          const roll = f.row.__reviewRoll as number;
          f.status = roll < 0.7 ? 'acknowledged' : roll < 0.9 ? 'dismissed' : 'escalated';
          f.row.status = f.status;
          f.row.reviewed_by = nurseId;
          f.row.reviewed_at = iso(reviewAt);
          f.row.review_note =
            f.status === 'dismissed'
              ? 'Reviewed; known and monitored by the care team.'
              : f.status === 'escalated'
                ? 'Shared with the ordering clinician for review.'
                : null;
        }
      }
      const drafts: FlagDraft[] = runFlagEngine({
        patient: { id: plan.id, organization_id: orgId },
        medications: plan.meds,
        medicationChanges: plan.changes,
        doseEvents: pDoses.filter(
          (d) => Date.parse(d.scheduled_for) <= runAt || d.status === 'pending',
        ),
        symptomLogs: pLogs.filter((l) => l.logged_for_date <= runDay),
        existingFlags: existing,
        rules,
        settings,
        now: new Date(runAt),
        timezone: TZ,
      });
      for (const draft of drafts) {
        if (draft.upgrades_flag_id) {
          const target = existing.find((f) => f.id === draft.upgrades_flag_id)!;
          target.severity = draft.severity;
          Object.assign(target.row, {
            severity: draft.severity,
            explanation: draft.explanation,
            evidence: draft.evidence,
          });
          continue;
        }
        const id = rng.uuid();
        const row: Row = {
          id,
          ...draft,
          status: 'open',
          created_at: iso(runAt),
          reviewed_by: null,
          reviewed_at: null,
          review_note: null,
          __reviewDelayHours: rng.int(4, 40),
          __reviewRoll: rng.next(),
        };
        delete row.upgrades_flag_id;
        flags.push(row);
        existing.push({
          id,
          dedupe_key: draft.dedupe_key,
          status: 'open',
          severity: draft.severity,
          created_at: iso(runAt),
          row,
        });
        if (SEVERITY_RANK[draft.severity] >= SEVERITY_RANK[settings.flag_min_severity_for_alert]) {
          pushAlert({
            patient_id: plan.id,
            recipient_profile_id: nurseId,
            channel: 'in_app',
            alert_type: 'flag',
            related_id: id,
            sent_at: iso(runAt),
            read_at: null,
          });
        }
      }
    }
    // Alerts for flags reviewed are read at review time.
    for (const a of alerts) {
      if (a.alert_type !== 'flag') continue;
      const f = existing.find((x) => x.id === a.related_id);
      if (f?.row.reviewed_at) a.read_at = f.row.reviewed_at;
    }

    // Missed-dose alerts for the last 7 days, as check-missed-doses would have produced.
    const recent = pDoses.filter((d) => Date.parse(d.scheduled_for) >= nowMs - 7 * 24 * HOUR);
    const evaluation = evaluateMissedDoses(recent, now, settings, { alertLookbackHours: 7 * 24 });
    const caregivers = plan.caregiverKey ? [userIds[plan.caregiverKey]!] : [];
    for (const doseId of evaluation.caregiverAlerts) {
      const d = recent.find((x) => x.id === doseId)!;
      const sent = Date.parse(d.scheduled_for) + settings.missed_dose_grace_minutes * MINUTE;
      for (const c of caregivers) {
        pushAlert({
          patient_id: plan.id,
          recipient_profile_id: c,
          channel: 'in_app',
          alert_type: 'missed_dose',
          related_id: doseId,
          sent_at: iso(sent),
          read_at: sent < nowMs - 24 * HOUR ? iso(sent + HOUR) : null,
        });
      }
    }
    for (const doseId of evaluation.escalations) {
      const d = recent.find((x) => x.id === doseId)!;
      const sent = Date.parse(d.scheduled_for) + settings.agency_escalation_minutes * MINUTE;
      for (const r of [nurseId, ...adminIds]) {
        pushAlert({
          patient_id: plan.id,
          recipient_profile_id: r,
          channel: 'in_app',
          alert_type: 'escalation',
          related_id: doseId,
          sent_at: iso(sent),
          read_at: sent < nowMs - 24 * HOUR ? iso(sent + 2 * HOUR) : null,
        });
      }
    }
  }
  for (const f of flags) {
    delete f.__reviewDelayHours;
    delete f.__reviewRoll;
  }

  // ---------------------------------------------------------------- remaining rows
  const patients: Row[] = plans.map((p) => ({
    id: p.id,
    organization_id: orgId,
    first_name: p.first_name,
    last_name: p.last_name,
    date_of_birth: p.date_of_birth,
    primary_nurse_id: userIds[p.nurseKey],
    notes: p.story ? `Demo story ${p.story} (synthetic).` : null,
    status: 'active',
    last_visit_at: zonedTimeToUtc(day(-(3 + ((p.index * 7) % 18))), '10:00', TZ).toISOString(),
  }));
  const caseload_assignments: Row[] = plans.map((p) => ({
    id: rng.uuid(),
    organization_id: orgId,
    nurse_id: userIds[p.nurseKey],
    patient_id: p.id,
  }));
  const patient_links: Row[] = [];
  const consents: Row[] = [];
  for (const p of plans) {
    consents.push({
      id: rng.uuid(),
      organization_id: orgId,
      patient_id: p.id,
      consent_type: 'data_use',
      granted_by_name: `${p.first_name} ${p.last_name}`,
      granted_by_relationship: 'self',
      granted_at: iso(Date.parse(`${historyStart}T15:00:00Z`) - 10 * 24 * HOUR),
      document_version: 'v1-draft',
    });
    if (p.selfUser) {
      patient_links.push({
        id: rng.uuid(),
        organization_id: orgId,
        patient_id: p.id,
        profile_id: userIds.patient1,
        relationship: 'self',
      });
    }
    if (p.caregiverKey) {
      patient_links.push({
        id: rng.uuid(),
        organization_id: orgId,
        patient_id: p.id,
        profile_id: userIds[p.caregiverKey],
        relationship: 'caregiver',
      });
      consents.push({
        id: rng.uuid(),
        organization_id: orgId,
        patient_id: p.id,
        consent_type: 'caregiver_access',
        granted_by_name: `${p.first_name} ${p.last_name}`,
        granted_by_relationship: 'self',
        granted_at: iso(Date.parse(`${historyStart}T15:00:00Z`) - 9 * 24 * HOUR),
        document_version: 'v1-draft',
      });
      if (p.caregiverKey === 'caregiver1') {
        consents.push({
          id: rng.uuid(),
          organization_id: orgId,
          patient_id: p.id,
          consent_type: 'sms',
          granted_by_name: STAFF.caregiver1.full_name,
          granted_by_relationship: 'caregiver',
          granted_at: iso(Date.parse(`${historyStart}T15:00:00Z`) - 9 * 24 * HOUR),
          document_version: 'v1-draft',
        });
      }
    }
  }
  const medications: Row[] = plans.flatMap((p) => p.meds.map((m) => ({ ...m })));
  const medication_changes: Row[] = plans.flatMap((p) =>
    p.changes.map((c) => ({ ...c, organization_id: orgId, recorded_by: userIds[p.nurseKey] })),
  );
  const checkin_templates: Row[] = plans.map((p) => ({
    id: rng.uuid(),
    organization_id: orgId,
    patient_id: p.id,
    medication_fingerprint: medicationFingerprint(p.meds, today),
    source: 'rules',
    questions: p.template,
    model: null,
    prompt_version: null,
    status: 'active',
  }));

  // ---------------------------------------------------------------- expectations
  const storyDescriptions: Record<number, string> = {
    1: 'Sleep medicine started; dizziness and a near-fall on day 3; doses all taken → high temporal-correlation flags.',
    2: 'New blood pressure medicine mostly missed; dizziness appears → lowered-score flag noting missed doses.',
    3: 'Blood thinner plus long-term NSAID → interaction flag.',
    4: 'Four evening doses missed in a row → adherence flag and escalated alerts.',
    5: 'Symptoms improve after a medicine is stopped → no temporal flag; timeline shows improvement.',
  };
  const stories = plans
    .filter((p) => p.story)
    .map((p) => ({
      key: `story${p.story}`,
      patient_id: p.id,
      description: storyDescriptions[p.story!]!,
    }));
  const expected: ExpectedFlag[] = flags
    .filter((f) => plans.find((p) => p.id === f.patient_id)?.story)
    .map((f) => ({
      story: `story${plans.find((p) => p.id === f.patient_id)!.story}`,
      patient_id: f.patient_id as string,
      flag_type: f.flag_type as string,
      severity: f.severity as string,
      title: f.title as string,
    }));

  return {
    now: now.toISOString(),
    today,
    users,
    tables: {
      organizations,
      profiles,
      patients,
      caseload_assignments,
      patient_links,
      consents,
      medications,
      medication_changes,
      dose_events: doseRows,
      symptom_logs: logs,
      checkin_templates,
      flags,
      alerts,
    },
    expected,
    stories,
  };
}

/** Counts per table plus expected story flags, for the end-of-seed summary (no PHI). */
export function summarize(data: SeedData): string {
  const lines = [`Seed summary (now=${data.now}, today=${data.today}, tz=${TZ})`, ''];
  lines.push(`  auth users            ${data.users.length}`);
  for (const t of TABLE_ORDER) lines.push(`  ${t.padEnd(22)}${data.tables[t].length}`);
  const open = data.tables.flags.filter((f) => f.status === 'open');
  lines.push(
    '',
    `  open flags: ${open.length} (high ${open.filter((f) => f.severity === 'high').length}, medium ${open.filter((f) => f.severity === 'medium').length}, low ${open.filter((f) => f.severity === 'low').length})`,
  );
  lines.push('', 'Expected story flags (patient ids only):');
  for (const s of data.stories) {
    const fs = data.expected.filter((e) => e.patient_id === s.patient_id);
    lines.push(`  ${s.key} patient=${s.patient_id}`);
    lines.push(`    ${s.description}`);
    for (const f of fs) lines.push(`    - ${f.flag_type} / ${f.severity}`);
    if (!fs.length) lines.push('    - (no flags)');
  }
  return lines.join('\n');
}
