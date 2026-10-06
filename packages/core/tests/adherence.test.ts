import { describe, expect, it } from 'vitest';
import {
  adherenceRate,
  evaluateMissedDoses,
  generateExpectedDoses,
  isCountedDose,
  longestMissedRun,
} from '../src/adherence.ts';
import type { DoseEvent } from '../src/types.ts';
import { TZ, med } from './fixtures.ts';

const settings = { missed_dose_grace_minutes: 60, agency_escalation_minutes: 120 };

function dose(
  id: string,
  scheduled_for: string,
  status: DoseEvent['status'],
  note?: string,
): DoseEvent {
  return { id, patient_id: 'p', medication_id: 'm', scheduled_for, status, note: note ?? null };
}

describe('generateExpectedDoses', () => {
  it('creates one draft per schedule time, sorted, in UTC', () => {
    const drafts = generateExpectedDoses(
      [med('a', { schedule_times: ['20:00', '08:00'] })],
      '2026-01-10',
      TZ,
    );
    expect(drafts.map((d) => d.scheduled_for)).toEqual([
      '2026-01-10T13:00:00.000Z',
      '2026-01-11T01:00:00.000Z',
    ]);
    expect(drafts[0]).toMatchObject({
      medication_id: 'a',
      patient_id: 'pat-1',
      organization_id: 'org-1',
      status: 'pending',
    });
  });

  it('skips PRN medicines', () => {
    expect(generateExpectedDoses([med('a', { prn: true })], '2026-01-10', TZ)).toEqual([]);
  });

  it('respects start_date and end_date (inclusive)', () => {
    const m = med('a', { start_date: '2026-01-10', end_date: '2026-01-12' });
    expect(generateExpectedDoses([m], '2026-01-09', TZ)).toHaveLength(0);
    expect(generateExpectedDoses([m], '2026-01-10', TZ)).toHaveLength(1);
    expect(generateExpectedDoses([m], '2026-01-12', TZ)).toHaveLength(1);
    expect(generateExpectedDoses([m], '2026-01-13', TZ)).toHaveLength(0);
  });

  it('skips stopped medicines without an end date', () => {
    expect(generateExpectedDoses([med('a', { status: 'stopped' })], '2026-01-10', TZ)).toEqual([]);
  });

  it('dedupes repeated schedule times', () => {
    expect(
      generateExpectedDoses([med('a', { schedule_times: ['08:00', '08:00'] })], '2026-01-10', TZ),
    ).toHaveLength(1);
  });

  it('keeps local wall-clock times across the spring DST boundary', () => {
    const m = med('a', { schedule_times: ['08:00', '02:30'] });
    const before = generateExpectedDoses([m], '2026-03-07', TZ).map((d) => d.scheduled_for);
    const on = generateExpectedDoses([m], '2026-03-08', TZ).map((d) => d.scheduled_for);
    const after = generateExpectedDoses([m], '2026-03-09', TZ).map((d) => d.scheduled_for);
    expect(before).toEqual(['2026-03-07T07:30:00.000Z', '2026-03-07T13:00:00.000Z']);
    // 02:30 does not exist on Mar 8 → 03:30 EDT; 08:00 is now UTC-4
    expect(on).toEqual(['2026-03-08T07:30:00.000Z', '2026-03-08T12:00:00.000Z']);
    expect(after).toEqual(['2026-03-09T06:30:00.000Z', '2026-03-09T12:00:00.000Z']);
  });

  it('keeps local wall-clock times across the fall DST boundary', () => {
    const m = med('a', { schedule_times: ['01:30', '20:00'] });
    expect(generateExpectedDoses([m], '2026-11-01', TZ).map((d) => d.scheduled_for)).toEqual([
      '2026-11-01T05:30:00.000Z',
      '2026-11-02T01:00:00.000Z',
    ]);
    expect(generateExpectedDoses([m], '2026-10-31', TZ).map((d) => d.scheduled_for)).toEqual([
      '2026-10-31T05:30:00.000Z',
      '2026-11-01T00:00:00.000Z',
    ]);
  });
});

describe('evaluateMissedDoses', () => {
  const d0 = '2026-03-20T12:00:00.000Z';
  it('marks pending doses missed only after the grace period', () => {
    const doses = [dose('a', d0, 'pending')];
    expect(evaluateMissedDoses(doses, '2026-03-20T12:59:00Z', settings).markMissed).toEqual([]);
    const r = evaluateMissedDoses(doses, '2026-03-20T13:00:00Z', settings);
    expect(r.markMissed).toEqual(['a']);
    expect(r.caregiverAlerts).toEqual(['a']);
    expect(r.escalations).toEqual([]);
  });

  it('escalates unconfirmed doses past the agency threshold', () => {
    const r = evaluateMissedDoses([dose('a', d0, 'missed')], '2026-03-20T14:00:00Z', settings);
    expect(r.markMissed).toEqual([]);
    expect(r.caregiverAlerts).toEqual(['a']);
    expect(r.escalations).toEqual(['a']);
  });

  it('ignores confirmed doses', () => {
    for (const s of ['given', 'skipped', 'refused'] as const) {
      const r = evaluateMissedDoses([dose('a', d0, s)], '2026-03-21T00:00:00Z', settings);
      expect(r).toEqual({ markMissed: [], caregiverAlerts: [], escalations: [] });
    }
  });

  it('does not re-alert when alerts already exist', () => {
    const r = evaluateMissedDoses([dose('a', d0, 'missed')], '2026-03-20T15:00:00Z', settings, {
      existingAlerts: [
        { related_id: 'a', alert_type: 'missed_dose' },
        { related_id: 'a', alert_type: 'escalation' },
      ],
    });
    expect(r.caregiverAlerts).toEqual([]);
    expect(r.escalations).toEqual([]);
  });

  it('marks old doses missed but never alerts outside the lookback window', () => {
    const r = evaluateMissedDoses([dose('a', d0, 'pending')], '2026-03-22T12:00:00Z', settings);
    expect(r.markMissed).toEqual(['a']);
    expect(r.caregiverAlerts).toEqual([]);
    expect(r.escalations).toEqual([]);
  });

  it('honours custom thresholds', () => {
    const r = evaluateMissedDoses([dose('a', d0, 'pending')], '2026-03-20T12:20:00Z', {
      missed_dose_grace_minutes: 15,
      agency_escalation_minutes: 20,
    });
    expect(r).toEqual({ markMissed: ['a'], caregiverAlerts: ['a'], escalations: ['a'] });
  });
});

describe('adherenceRate', () => {
  const period = { start: '2026-03-01T00:00:00Z', end: '2026-03-08T00:00:00Z' };
  it('given ÷ (given + missed + refused), labeled reported', () => {
    const doses = [
      dose('1', '2026-03-01T12:00:00Z', 'given'),
      dose('2', '2026-03-02T12:00:00Z', 'given'),
      dose('3', '2026-03-03T12:00:00Z', 'given'),
      dose('4', '2026-03-04T12:00:00Z', 'missed'),
      dose('5', '2026-03-05T12:00:00Z', 'refused'),
    ];
    const r = adherenceRate(doses, period, '2026-03-10T00:00:00Z');
    expect(r).toMatchObject({ given: 3, missed: 1, refused: 1, total: 5, label: 'reported' });
    expect(r.rate).toBeCloseTo(0.6);
  });

  it('excludes skipped-with-note, future and still-pending doses; counts skipped without note', () => {
    const doses = [
      dose('1', '2026-03-01T12:00:00Z', 'given'),
      dose('2', '2026-03-02T12:00:00Z', 'skipped', 'hospital visit'),
      dose('3', '2026-03-03T12:00:00Z', 'skipped'),
      dose('4', '2026-03-04T12:00:00Z', 'pending'),
      dose('5', '2026-03-06T12:00:00Z', 'given'),
      dose('6', '2026-02-28T12:00:00Z', 'missed'),
      dose('7', '2026-03-09T12:00:00Z', 'missed'),
    ];
    const r = adherenceRate(doses, period, '2026-03-05T00:00:00Z');
    expect(r).toMatchObject({ given: 1, skipped: 1, excused: 1, unresolved: 1, total: 2 });
    expect(r.rate).toBe(0.5);
  });

  it('returns null rate when nothing is countable', () => {
    expect(adherenceRate([], period, '2026-03-10T00:00:00Z').rate).toBeNull();
  });

  it('defaults now to the current time', () => {
    expect(adherenceRate([dose('1', '2026-03-01T12:00:00Z', 'given')], period).rate).toBe(1);
  });
});

describe('dose helpers', () => {
  it('longestMissedRun counts consecutive misses, reset by any counted dose', () => {
    const s = [
      'missed',
      'missed',
      'given',
      'missed',
      'missed',
      'missed',
      'pending',
      'missed',
      'given',
    ] as const;
    const doses = s.map((st, i) =>
      dose(String(i), `2026-03-0${1 + Math.floor(i / 2)}T${i % 2 ? '20' : '08'}:00:00Z`, st),
    );
    expect(longestMissedRun(doses)).toBe(4);
    expect(longestMissedRun([])).toBe(0);
  });
  it('isCountedDose', () => {
    expect(isCountedDose(dose('1', 'x', 'skipped', ' '))).toBe(true);
    expect(isCountedDose(dose('1', 'x', 'skipped', 'note'))).toBe(false);
    expect(isCountedDose(dose('1', 'x', 'pending'))).toBe(false);
  });
});
