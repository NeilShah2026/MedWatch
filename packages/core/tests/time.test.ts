import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateRange,
  daysBetween,
  formatLongDate,
  formatShortDate,
  localDate,
  startOfLocalDay,
  tzOffsetMs,
  zonedTimeToUtc,
} from '../src/time.ts';

const NY = 'America/New_York';

describe('zonedTimeToUtc', () => {
  it('converts standard and daylight times', () => {
    expect(zonedTimeToUtc('2026-01-15', '08:00', NY).toISOString()).toBe(
      '2026-01-15T13:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-07-15', '08:00', NY).toISOString()).toBe(
      '2026-07-15T12:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-07-15', '08:00', 'UTC').toISOString()).toBe(
      '2026-07-15T08:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-07-15', '20:30', 'Asia/Kolkata').toISOString()).toBe(
      '2026-07-15T15:00:00.000Z',
    );
  });

  it('shifts nonexistent spring-forward times forward by the gap', () => {
    // 2026-03-08 02:30 does not exist in New York; it becomes 03:30 EDT (07:30Z).
    expect(zonedTimeToUtc('2026-03-08', '02:30', NY).toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-03-08', '01:30', NY).toISOString()).toBe(
      '2026-03-08T06:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-03-08', '03:30', NY).toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('resolves ambiguous fall-back times to the earlier instant', () => {
    // 2026-11-01 01:30 happens twice in New York; pick 01:30 EDT (05:30Z).
    expect(zonedTimeToUtc('2026-11-01', '01:30', NY).toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-11-01', '03:00', NY).toISOString()).toBe(
      '2026-11-01T08:00:00.000Z',
    );
  });

  it('rejects malformed input', () => {
    expect(() => zonedTimeToUtc('2026-1-1', '08:00', NY)).toThrow(/Invalid date/);
    expect(() => zonedTimeToUtc('2026-01-01', '8:00', NY)).toThrow(/Invalid time/);
    expect(() => zonedTimeToUtc('2026-01-01', '24:00', NY)).toThrow(/Invalid time/);
  });
});

describe('date helpers', () => {
  it('localDate uses the timezone calendar day', () => {
    expect(localDate('2026-03-20T03:00:00Z', NY)).toBe('2026-03-19');
    expect(localDate(Date.parse('2026-03-20T05:00:00Z'), NY)).toBe('2026-03-20');
    expect(localDate(new Date('2026-03-20T05:00:00Z'), 'UTC')).toBe('2026-03-20');
  });
  it('startOfLocalDay', () => {
    expect(startOfLocalDay('2026-03-08', NY).toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(startOfLocalDay('2026-03-09', NY).toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });
  it('addDays / daysBetween / dateRange across month and DST boundaries', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-03-07', '2026-03-10')).toBe(3);
    expect(daysBetween('2026-03-10', '2026-03-07')).toBe(-3);
    expect(dateRange('2026-03-07', '2026-03-09')).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ]);
    expect(dateRange('2026-03-09', '2026-03-07')).toEqual([]);
  });
  it('formats dates deterministically', () => {
    expect(formatShortDate('2026-03-03')).toBe('Mar 3');
    expect(formatLongDate('2026-12-25')).toBe('Dec 25, 2026');
  });
  it('tzOffsetMs reports the zone offset', () => {
    expect(tzOffsetMs(Date.parse('2026-01-01T12:00:00Z'), NY)).toBe(-5 * 3600_000);
    expect(tzOffsetMs(Date.parse('2026-07-01T12:00:00.500Z'), NY)).toBe(-4 * 3600_000);
  });
});
