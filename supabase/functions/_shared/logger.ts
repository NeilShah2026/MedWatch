/**
 * Edge Function logger. Hard Rule 4: log IDs, statuses, counts and timings only — never
 * names, birthdates, medicines, symptoms, notes, or AI prompt/response bodies.
 */
type SafeKey =
  | `${string}Id`
  | `${string}_id`
  | 'status'
  | 'count'
  | 'latencyMs'
  | 'code'
  | 'fn'
  | 'model'
  | 'source'
  | 'inputTokens'
  | 'outputTokens'
  | 'attempt';
export type SafeFields = Partial<Record<SafeKey, string | number | boolean | null>>;

function emit(level: 'info' | 'warn' | 'error', event: string, fields?: SafeFields) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const fnLog = {
  info: (event: string, fields?: SafeFields) => emit('info', event, fields),
  warn: (event: string, fields?: SafeFields) => emit('warn', event, fields),
  error: (event: string, fields?: SafeFields) => emit('error', event, fields),
};

/**
 * Development only (APP_ENV=development|local): print an invitation link so testing does not
 * depend on email delivery. The link carries a one-time token and no patient details.
 */
export function printDevInviteLink(appEnv: string, link: string) {
  if (appEnv === 'development' || appEnv === 'local')
    console.log(JSON.stringify({ level: 'info', event: 'invite.dev_link', link }));
}
