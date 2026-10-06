import { ageOn, localDate } from '@medwatch/core';

export function fullName(p: { first_name: string; last_name: string }): string {
  return `${p.first_name} ${p.last_name}`;
}

/** "Margaret A." — used where space is tight (alerts). */
export function shortName(p: { first_name: string; last_name: string }): string {
  return `${p.first_name} ${p.last_name.slice(0, 1)}.`;
}

export function age(dob: string, tz = 'America/New_York'): number {
  return ageOn(dob, localDate(new Date(), tz));
}

export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatPercent(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`;
}

/** "08:00" → "8:00 AM" */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function todayIn(tz: string): string {
  return localDate(new Date(), tz);
}
