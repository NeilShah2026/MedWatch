/**
 * The only logging entry point in the web app (ESLint bans direct console use).
 * Hard Rule 4: never log PHI. Fields are restricted to IDs and coarse status codes
 * at the type level: keys must end in `Id` or be one of the allowed metadata keys,
 * and values must be primitives.
 */
type SafeKey = `${string}Id` | 'code' | 'status' | 'count' | 'durationMs' | 'route';
export type SafeFields = Partial<Record<SafeKey, string | number | boolean | null>>;

const UUIDISH = /^[0-9a-f-]{8,}$|^[A-Za-z0-9_.:-]{1,64}$/;

function sanitize(fields: SafeFields | undefined): SafeFields | undefined {
  if (!fields) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    // Defense in depth: drop strings that don't look like identifiers/codes.
    if (typeof v === 'string' && !UUIDISH.test(v)) continue;
    out[k] = v;
  }
  return out as SafeFields;
}

export const logger = {
  info(event: string, fields?: SafeFields) {
    if (import.meta.env.DEV) console.info(`[medwatch] ${event}`, sanitize(fields) ?? '');
  },
  warn(event: string, fields?: SafeFields) {
    console.warn(`[medwatch] ${event}`, sanitize(fields) ?? '');
  },
  error(event: string, fields?: SafeFields) {
    console.error(`[medwatch] ${event}`, sanitize(fields) ?? '');
  },
};
