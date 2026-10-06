import { beforeAll, describe, expect, it } from 'vitest';
import { generateSeed, summarize, type SeedData } from '../../supabase/seed/generate.ts';
import { ageOn } from '../../packages/core/src/age.ts';
import { findBannedPhrases } from '../../packages/core/src/wording.ts';

const NOW = '2026-03-20T16:00:00Z';
let data: SeedData;

beforeAll(() => {
  data = generateSeed({ now: NOW });
});

const storyPatient = (key: string) => data.stories.find((s) => s.key === key)!.patient_id;
const flagsOf = (patientId: string) => data.tables.flags.filter((f) => f.patient_id === patientId);

describe('seed generator', () => {
  it('is deterministic for a fixed seed and clock', () => {
    expect(generateSeed({ now: NOW })).toEqual(data);
    expect(generateSeed({ now: NOW, seed: 7 }).tables.patients[0]!.id).not.toBe(
      data.tables.patients[0]!.id,
    );
  });

  it('creates the demo organization and the 7 demo users', () => {
    expect(data.tables.organizations).toHaveLength(1);
    expect(data.tables.organizations[0]!.name).toBe('Riverbend Home Health (Demo)');
    expect(data.users.map((u) => u.email).sort()).toEqual(
      ['admin', 'caregiver1', 'caregiver2', 'nurse1', 'nurse2', 'nurse3', 'patient1'].map(
        (u) => `${u}@demo.medwatch`,
      ),
    );
    expect(new Set(data.users.map((u) => u.password))).toEqual(new Set(['Demo!2345']));
    expect(data.tables.profiles.every((p) => p.mfa_required === false)).toBe(true);
  });

  it('creates 25 patients aged 68–94 on 4–12 medicines each', () => {
    expect(data.tables.patients).toHaveLength(25);
    for (const p of data.tables.patients) {
      const age = ageOn(p.date_of_birth as string, data.today);
      expect(age).toBeGreaterThanOrEqual(68);
      expect(age).toBeLessThanOrEqual(94);
      const meds = data.tables.medications.filter((m) => m.patient_id === p.id);
      expect(meds.length).toBeGreaterThanOrEqual(4);
      expect(meds.length).toBeLessThanOrEqual(12);
    }
  });

  it('assigns ~8 patients per nurse and links caregivers to 2 patients each', () => {
    const per = new Map<string, number>();
    for (const c of data.tables.caseload_assignments)
      per.set(c.nurse_id as string, (per.get(c.nurse_id as string) ?? 0) + 1);
    expect([...per.values()].sort()).toEqual([8, 8, 9]);
    const links = data.tables.patient_links;
    const byProfile = new Map<string, number>();
    for (const l of links)
      byProfile.set(l.profile_id as string, (byProfile.get(l.profile_id as string) ?? 0) + 1);
    const cg = data.users.filter((u) => u.role === 'caregiver').map((u) => byProfile.get(u.id));
    expect(cg).toEqual([2, 2]);
    expect(links.filter((l) => l.relationship === 'self')).toHaveLength(1);
  });

  it('covers 45 days of doses and ~80% check-in completion', () => {
    const days = new Set(
      data.tables.dose_events.map((d) => (d.scheduled_for as string).slice(0, 10)),
    );
    expect(days.size).toBeGreaterThanOrEqual(45);
    const past = data.tables.symptom_logs.filter(
      (l) => (l.logged_for_date as string) < data.today,
    ).length;
    const rate = past / (25 * 44);
    expect(rate).toBeGreaterThan(0.72);
    expect(rate).toBeLessThan(0.9);
    const given = data.tables.dose_events.filter((d) => d.status === 'given').length;
    const counted = data.tables.dose_events.filter((d) => d.status !== 'pending').length;
    expect(given / counted).toBeGreaterThan(0.9);
  });

  it('sets last visits 3–20 days ago and a rules-based check-in template for everyone', () => {
    for (const p of data.tables.patients) {
      const days = (Date.parse(NOW) - Date.parse(p.last_visit_at as string)) / 86_400_000;
      expect(days).toBeGreaterThan(2);
      expect(days).toBeLessThan(21);
    }
    expect(data.tables.checkin_templates).toHaveLength(25);
    expect(
      data.tables.checkin_templates.every((t) => t.source === 'rules' && t.status === 'active'),
    ).toBe(true);
  });

  it('story 1: sleep medicine → high temporal flags for dizziness and the near-fall', () => {
    const fs = flagsOf(storyPatient('story1')).filter(
      (f) => f.flag_type === 'temporal_correlation',
    );
    expect(
      fs.map((f) => [(f.evidence as { symptom_code: string }).symptom_code, f.severity]).sort(),
    ).toEqual([
      ['dizziness', 'high'],
      ['fall_or_near_fall', 'high'],
    ]);
    expect(fs.every((f) => f.status === 'open')).toBe(true);
    expect(String(fs[0]!.explanation)).toMatch(/Zolpidem was started/);
  });

  it('story 2: mostly-missed medicine → lowered-score flag that mentions missed doses', () => {
    const f = flagsOf(storyPatient('story2')).find((x) => x.flag_type === 'temporal_correlation')!;
    expect(f.severity).toBe('low');
    expect(f.explanation).toContain('Most doses were reported missed');
    expect((f.evidence as { score: number }).score).toBe(2);
  });

  it('story 3: blood thinner + long-term NSAID → interaction flag', () => {
    const fs = flagsOf(storyPatient('story3'));
    expect(
      fs.some(
        (f) =>
          f.flag_type === 'interaction' &&
          f.rule_id === 'ix.anticoagulant_nsaid' &&
          f.severity === 'high',
      ),
    ).toBe(true);
    expect(fs.some((f) => f.rule_id === 'risk.nsaid_long_term')).toBe(true);
  });

  it('story 4: 4 evening doses missed in a row → adherence flag and escalation alerts', () => {
    const pid = storyPatient('story4');
    const f = flagsOf(pid).find((x) => x.flag_type === 'adherence')!;
    expect(f).toBeDefined();
    expect(
      (f.evidence as { adherence: { longest_missed_run: number } }).adherence.longest_missed_run,
    ).toBeGreaterThanOrEqual(4);
    const esc = data.tables.alerts.filter(
      (a) => a.patient_id === pid && a.alert_type === 'escalation',
    );
    const cg = data.tables.alerts.filter(
      (a) => a.patient_id === pid && a.alert_type === 'missed_dose',
    );
    expect(esc.length).toBeGreaterThanOrEqual(4);
    expect(cg.length).toBeGreaterThanOrEqual(4);
  });

  it('story 5: symptoms improve after a stop → no temporal flag', () => {
    const fs = flagsOf(storyPatient('story5'));
    expect(fs.filter((f) => f.flag_type === 'temporal_correlation')).toEqual([]);
    const logs = data.tables.symptom_logs.filter((l) => l.patient_id === storyPatient('story5'));
    expect(logs.length).toBeGreaterThan(20);
  });

  it('every flag text passes the wording check and has an evidence trail', () => {
    for (const f of data.tables.flags) {
      expect(findBannedPhrases(`${f.title} ${f.explanation}`)).toEqual([]);
      expect(String(f.explanation).endsWith('For clinician review.')).toBe(true);
      expect(f.evidence).toBeTypeOf('object');
    }
    // history includes reviewed flags for dashboards
    expect(data.tables.flags.some((f) => f.status === 'acknowledged')).toBe(true);
  });

  it('alerts are unique per recipient/type/subject/channel', () => {
    const keys = data.tables.alerts.map(
      (a) => `${a.recipient_profile_id}:${a.alert_type}:${a.related_id}:${a.channel}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('summary lists counts and expected flags without patient names', () => {
    const s = summarize(data);
    expect(s).toContain('patients              25');
    expect(s).toContain('story1');
    for (const p of data.tables.patients) expect(s).not.toContain(p.last_name as string);
  });
});
