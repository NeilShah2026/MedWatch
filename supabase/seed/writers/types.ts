import type { SeedUser } from '../generate.ts';

export interface SeedWriter {
  /** Create auth users; returns generated id → real id (they differ when the backend assigns ids). */
  createUsers(users: SeedUser[]): Promise<Map<string, string>>;
  insert(table: string, rows: Record<string, unknown>[]): Promise<void>;
  /** True when the demo organization already exists. */
  demoExists(orgName: string): Promise<boolean>;
  /** Remove the demo organization (cascades) and every demo auth user. */
  wipeDemo(orgName: string, emailDomain: string): Promise<void>;
  close(): Promise<void>;
}

/** Replace generated ids with real ids throughout a value. */
export function remapIds<T>(value: T, map: Map<string, string>): T {
  if (!map.size || [...map].every(([a, b]) => a === b)) return value;
  let json = JSON.stringify(value);
  for (const [from, to] of map) if (from !== to) json = json.split(from).join(to);
  return JSON.parse(json) as T;
}
