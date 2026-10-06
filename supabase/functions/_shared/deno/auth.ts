import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FnEnv } from './env.ts';
import { HttpError } from './http.ts';

export function serviceClient(env: FnEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export interface UserCaller {
  kind: 'user';
  userId: string;
  role: string;
  organizationId: string;
  aal: string;
  mfaRequired: boolean;
  /** Client acting as the user: RLS applies to everything it reads. */
  asUser: SupabaseClient;
}
export type Caller = { kind: 'cron' } | UserCaller;

function decodeClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1] ?? '';
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

/**
 * Accept either the cron secret header (pg_cron / pg_net) or a signed-in user's access
 * token (verified with auth.getUser). Everything else is rejected.
 */
export async function authenticate(
  req: Request,
  env: FnEnv,
  db: SupabaseClient,
  opts: { allowUser: boolean },
): Promise<Caller> {
  const secret = req.headers.get('x-cron-secret');
  if (secret) {
    if (!timingSafeEqual(secret, env.CRON_SECRET)) throw new HttpError(401, 'bad_cron_secret');
    return { kind: 'cron' };
  }
  if (!opts.allowUser) throw new HttpError(401, 'cron_only');
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'missing_token');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'invalid_token');
  const { data: profile } = await db
    .from('profiles')
    .select('role, organization_id, is_active, mfa_required')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile || !profile.is_active) throw new HttpError(403, 'no_profile');
  const aal = String(decodeClaims(token).aal ?? 'aal1');
  const staff = profile.role === 'nurse' || profile.role === 'agency_admin';
  if (staff && profile.mfa_required && aal !== 'aal2') throw new HttpError(403, 'mfa_required');
  const asUser = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return {
    kind: 'user',
    userId: data.user.id,
    role: profile.role,
    organizationId: profile.organization_id,
    aal,
    mfaRequired: profile.mfa_required,
    asUser,
  };
}

export function requireRole(caller: Caller, roles: string[]): asserts caller is UserCaller {
  if (caller.kind !== 'user' || !roles.includes(caller.role)) throw new HttpError(403, 'forbidden');
}
