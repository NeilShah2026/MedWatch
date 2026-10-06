import { describe, expect, it } from 'vitest';
import {
  SUMMARY_FOOTER,
  buildVisitSummary,
  trajectoryOf,
  type SummaryFlagInput,
  type VisitSummaryInput,
} from '../src/summary.ts';
import { TZ, change, doses, log, med, rules } from './fixtures.ts';

function base(o: Partial<VisitSummaryInput> = {}): VisitSummaryInput {
  return {
    patient: {
      id: 'pat-1',
      organization_id: 'org-1',
      first_name: 'Ada',
      last_name: 'Example',
      date_of_birth: '1942-05-01',
    },
    period: { start: '2026-03-01', end: '2026-03-20' },
    generatedAt: '2026-03-20T16:00:00Z',
    generatedBy: 'Nurse Test',
    timezone: TZ,
    medications: [],
    medicationChanges: [],
    doseEvents: [],
    symptomLogs: [],
    flags: [],
    rules,
    ...o,
  };
}

const flag = (o: Partial<SummaryFlagInput>): SummaryFlagInput => ({
  id: 'f',
  flag_type: 'temporal_correlation',
  severity: 'high',
  status: 'open',
  title: 'Dizziness began after Zolpidem start',
  created_at: '2026-03-18T12:00:00Z',
  ...o,
});

describe('buildVisitSummary', () => {
  it('builds every section with header, footer and reported adherence', () => {
    const zol = med('zol', {
      name: 'Zolpidem',
      drug_class: 'sedative_hypnotic',
      start_date: '2026-03-10',
      schedule_times: ['21:00'],
    });
    const s = buildVisitSummary(
      base({
        medications: [
          zol,
          med('old', { name: 'Old Med', status: 'stopped', end_date: '2026-03-05' }),
        ],
        medicationChanges: [
          change('c1', 'zol', 'started', '2026-03-10', {
            current: { dose_amount: 5, dose_unit: 'mg' },
          }),
          change('c2', 'old', 'stopped', '2026-03-05'),
          change('c0', 'zol', 'started', '2026-02-01'),
        ],
        doseEvents: doses('zol', '2026-03-10', '2026-03-19', ['21:00'], (i) =>
          i < 8 ? 'given' : 'missed',
        ),
        symptomLogs: [
          log('2026-03-17', { dizziness: 1 }),
          log('2026-03-18', { dizziness: 2 }),
          log('2026-03-19', { dizziness: 3 }),
        ],
        flags: [
          flag({}),
          flag({
            id: 'g',
            status: 'dismissed',
            severity: 'low',
            title: 'Old',
            created_at: '2026-01-01T00:00:00Z',
          }),
        ],
      }),
    );
    expect(s.header).toMatchObject({
      patient_name: 'Ada Example',
      age: 83,
      period_start: '2026-03-01',
      period_end: '2026-03-20',
      generated_by: 'Nurse Test',
    });
    expect(s.header.period_label).toBe('Mar 1, 2026 – Mar 20, 2026');
    expect(s.medication_changes.rows).toEqual([
      { date: '2026-03-10', medication: 'Zolpidem', change: 'Started', detail: '5 mg' },
      { date: '2026-03-05', medication: 'Old Med', change: 'Stopped', detail: '' },
    ]);
    expect(s.current_medications.rows).toEqual([
      {
        name: 'Zolpidem',
        dose: '10 mg',
        schedule: '21:00',
        drug_class: 'Sleep medicine (sedative-hypnotic)',
      },
    ]);
    expect(s.adherence.overall).toEqual({ rate: 0.8, given: 8, total: 10, label: 'reported' });
    expect(s.adherence.by_medication.rows[0]).toMatchObject({
      medication: 'Zolpidem',
      given: 8,
      total: 10,
    });
    expect(s.symptoms.rows[0]).toMatchObject({
      code: 'dizziness',
      symptom: 'Dizziness',
      first_seen: '2026-03-17',
      days_reported: 3,
      max_severity: 3,
      trajectory: 'worse',
    });
    expect(s.flags.rows.map((f) => f.title)).toEqual(['Dizziness began after Zolpidem start']);
    expect(s.questions.rows).toEqual([
      'Dizziness began after Zolpidem start. Is this worth reviewing?',
    ]);
    expect(s.footer).toBe(SUMMARY_FOOTER);
    expect(s.footer).toContain('Not a diagnosis.');
  });

  it('truncates long lists with a "+N more" count', () => {
    const meds = Array.from({ length: 15 }, (_, i) =>
      med(`m${String(i).padStart(2, '0')}`, { name: `Med ${String(i).padStart(2, '0')}` }),
    );
    const s = buildVisitSummary(
      base({
        medications: meds,
        medicationChanges: meds.map((m, i) => change(`c${i}`, m.id, 'started', '2026-03-05')),
        flags: Array.from({ length: 9 }, (_, i) => flag({ id: `f${i}`, title: `Flag ${i}` })),
      }),
    );
    expect(s.current_medications.rows).toHaveLength(12);
    expect(s.current_medications.more).toBe(3);
    expect(s.medication_changes.more).toBe(9);
    expect(s.flags.rows).toHaveLength(6);
    expect(s.flags.more).toBe(3);
    expect(s.questions.rows).toHaveLength(4);
    expect(s.questions.more).toBe(5);
  });

  it('phrases clinician questions by flag type and includes reviewed flags with notes', () => {
    const s = buildVisitSummary(
      base({
        flags: [
          flag({
            id: 'a',
            flag_type: 'medication_risk',
            title: 'Sleep medicine on the list',
            severity: 'medium',
          }),
          flag({ id: 'b', flag_type: 'interaction', title: 'Blood thinner with an NSAID' }),
          flag({
            id: 'c',
            flag_type: 'adherence',
            title: 'Low reported adherence: X',
            status: 'escalated',
            reviewed_at: '2026-03-19T00:00:00Z',
            review_note: 'Called family',
            reviewer_name: 'N. Nurse',
          }),
          flag({
            id: 'd',
            status: 'acknowledged',
            reviewed_at: '2026-03-19T00:00:00Z',
            title: 'Reviewed',
          }),
        ],
      }),
    );
    expect(s.questions.rows).toEqual([
      'Blood thinner with an NSAID: is this combination worth reviewing?',
      'Sleep medicine on the list: is this worth reviewing at this visit?',
      'Low reported adherence: X: are there barriers to taking this medicine as planned?',
    ]);
    const escalated = s.flags.rows.find((f) => f.status === 'escalated')!;
    expect(escalated).toMatchObject({ reviewer_note: 'Called family', reviewer: 'N. Nurse' });
  });

  it('handles an empty period', () => {
    const s = buildVisitSummary(base({ generatedAt: new Date('2026-03-20T16:00:00Z') }));
    expect(s.adherence.overall.rate).toBeNull();
    expect(s.symptoms.rows).toEqual([]);
    expect(s.questions.rows).toEqual([]);
  });

  it('PRN medicines show "As needed"', () => {
    const s = buildVisitSummary(
      base({ medications: [med('p', { prn: true, name: 'Acetaminophen' })] }),
    );
    expect(s.current_medications.rows[0]!.schedule).toBe('As needed');
  });
});

describe('trajectoryOf', () => {
  it('compares first and second half averages', () => {
    expect(trajectoryOf([3, 3, 1, 0])).toBe('better');
    expect(trajectoryOf([0, 1, 2, 3])).toBe('worse');
    expect(trajectoryOf([1, 1, 1, 1])).toBe('same');
    expect(trajectoryOf([2])).toBe('same');
  });
});
