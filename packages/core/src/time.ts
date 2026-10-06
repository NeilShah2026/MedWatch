/**
 * Timezone helpers built on Intl only (no dependencies), so they run identically in the
 * browser, Node and Deno. All "dates" are calendar days in an IANA timezone (`YYYY-MM-DD`);
 * all instants are UTC.
 */
import type { IsoDate } from './types.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY_MS = 24 * HOUR;

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(instant: number | Date, tz: string): Parts {
  const t = typeof instant === 'number' ? instant : instant.getTime();
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(new Date(t))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return {
    year: p.year!,
    month: p.month!,
    day: p.day!,
    hour: p.hour === 24 ? 0 : p.hour!,
    minute: p.minute!,
    second: p.second!,
  };
}

/** Offset of `tz` from UTC at the given instant, in ms (local − UTC). */
export function tzOffsetMs(instant: number, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

function parseDate(date: IsoDate): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function parseTime(time: string): [number, number] {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) throw new Error(`Invalid time: ${time}`);
  return [Number(m[1]), Number(m[2])];
}

/**
 * Convert a wall-clock time on a calendar day in `tz` to a UTC instant.
 * - Nonexistent times (spring-forward gap) shift forward by the gap (02:30 → 03:30).
 * - Ambiguous times (fall-back overlap) resolve to the earlier instant.
 */
export function zonedTimeToUtc(date: IsoDate, time: string, tz: string): Date {
  const [y, mo, d] = parseDate(date);
  const [h, mi] = parseTime(time);
  const local = Date.UTC(y, mo - 1, d, h, mi);
  const before = tzOffsetMs(local - 12 * HOUR, tz);
  const after = tzOffsetMs(local + 12 * HOUR, tz);
  const valid = [...new Set([before, after])]
    .map((o) => local - o)
    .filter((t) => tzOffsetMs(t, tz) === local - t)
    .sort((a, b) => a - b);
  if (valid.length) return new Date(valid[0]!);
  // In a gap: interpret with the pre-transition offset, which lands after the gap.
  return new Date(local - before);
}

/** The calendar day (in `tz`) that contains the instant. */
export function localDate(instant: number | Date | string, tz: string): IsoDate {
  const t = typeof instant === 'string' ? Date.parse(instant) : instant;
  const p = zonedParts(t, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** UTC instant of local midnight starting `date` in `tz`. */
export function startOfLocalDay(date: IsoDate, tz: string): Date {
  return zonedTimeToUtc(date, '00:00', tz);
}

export function addDays(date: IsoDate, n: number): IsoDate {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole calendar days from `a` to `b` (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const [y1, m1, d1] = parseDate(a);
  const [y2, m2, d2] = parseDate(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}

export function dateRange(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Deterministic short date, e.g. "Mar 3" (no locale/timezone dependence). */
export function formatShortDate(date: IsoDate): string {
  const [, m, d] = parseDate(date);
  return `${MONTHS[m - 1]} ${d}`;
}

/** Deterministic long date, e.g. "Mar 3, 2026". */
export function formatLongDate(date: IsoDate): string {
  const [y] = parseDate(date);
  return `${formatShortDate(date)}, ${y}`;
}

export function toInstant(v: Date | string | number): number {
  return v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : v;
}
