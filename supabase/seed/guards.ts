/**
 * Hard Rule 10: destructive scripts (db:reset, seed) refuse to run unless APP_ENV is
 * `local` or `development` AND the target is the dev project; they print the target and
 * require --yes before writing or wiping anything.
 */
export interface GuardInput {
  env: Record<string, string | undefined>;
  args: string[];
  target: 'cloud' | 'local-pg';
}

export interface GuardResult {
  ok: boolean;
  errors: string[];
  targetDescription: string;
}

export function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const m = new URL(url).hostname.match(/^([a-z0-9]{20})\.supabase\.(co|in|net)$/);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

export function checkGuards({ env, args, target }: GuardInput): GuardResult {
  const errors: string[] = [];
  const appEnv = env.APP_ENV;
  if (appEnv === 'production')
    errors.push('APP_ENV is "production": seeding and resetting are never allowed in production.');
  else if (appEnv !== 'local' && appEnv !== 'development') {
    errors.push(
      `APP_ENV must be "local" or "development" (got ${appEnv ? `"${appEnv}"` : 'nothing'}).`,
    );
  }

  let targetDescription: string;
  if (target === 'cloud') {
    const ref = projectRefFromUrl(env.VITE_SUPABASE_URL);
    const dev = env.SUPABASE_DEV_PROJECT_REF;
    targetDescription = `Supabase project ${ref ?? '(unknown)'} — ${env.VITE_SUPABASE_URL ?? '(VITE_SUPABASE_URL not set)'}`;
    if (!dev) errors.push('SUPABASE_DEV_PROJECT_REF is not set.');
    if (!ref) errors.push('VITE_SUPABASE_URL is not a Supabase project URL.');
    if (dev && ref && dev !== ref) {
      errors.push(`Target project ${ref} is not the dev project ${dev}. Refusing to touch it.`);
    }
    if (!env.SUPABASE_SERVICE_ROLE_KEY) errors.push('SUPABASE_SERVICE_ROLE_KEY is not set.');
  } else {
    const url = env.LOCAL_PG_URL;
    targetDescription = `local Postgres ${url ? url.replace(/\/\/[^@]*@/, '//') : '(LOCAL_PG_URL not set)'}`;
    let host = '';
    try {
      host = url ? new URL(url).hostname : '';
    } catch {
      host = '';
    }
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      errors.push('LOCAL_PG_URL must point at localhost.');
    }
  }

  if (!args.includes('--yes'))
    errors.push('Add --yes to confirm (this deletes and rewrites demo data).');
  return { ok: errors.length === 0, errors, targetDescription };
}
