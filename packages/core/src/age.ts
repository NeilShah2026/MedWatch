import type { IsoDate } from './types.ts';

/** Age in whole years on `onDate`. */
export function ageOn(dateOfBirth: IsoDate, onDate: IsoDate): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = onDate.split('-').map(Number) as [number, number, number];
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

/** Decade band such as "80–89" — the only age information ever sent to the AI model. */
export function ageBand(dateOfBirth: IsoDate, onDate: IsoDate): string {
  const age = ageOn(dateOfBirth, onDate);
  if (age >= 100) return '100+';
  if (age < 0) return 'unknown';
  const lo = Math.floor(age / 10) * 10;
  return `${lo}–${lo + 9}`;
}
