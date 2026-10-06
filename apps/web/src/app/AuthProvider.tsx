import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { resolveOrgSettings, type OrgSettings, type Role } from '@medwatch/core';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import type { OrganizationRow, ProfileRow } from '@/lib/types';

export type AuthStatus =
  | 'loading'
  | 'signedOut'
  | 'noProfile'
  | 'mfaEnroll'
  | 'mfaChallenge'
  | 'ready';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  profile: ProfileRow | null;
  org: OrganizationRow | null;
  settings: OrgSettings;
  timezone: string;
  refresh: () => Promise<void>;
  signOut: (reason?: 'timeout' | 'manual') => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const STAFF_ROLES: Role[] = ['nurse', 'agency_admin'];

export function homePathFor(role: Role): string {
  switch (role) {
    case 'patient':
      return '/me';
    case 'caregiver':
      return '/care';
    case 'nurse':
      return '/clinic';
    case 'agency_admin':
      return '/admin';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [org, setOrg] = useState<OrganizationRow | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      setProfile(null);
      setOrg(null);
      setStatus('signedOut');
      return;
    }
    const { data: p, error } = await supabase
      .from('profiles')
      .select(
        'id, organization_id, role, full_name, email, phone, sms_opt_in, mfa_required, is_active',
      )
      .eq('id', s.user.id)
      .maybeSingle();
    if (error) logger.warn('auth.profile_load_failed', { code: error.code ?? null });
    if (!p || !p.is_active) {
      setProfile(null);
      setStatus('noProfile');
      return;
    }
    const prof = p as ProfileRow;
    setProfile(prof);
    if (prof.mfa_required && STAFF_ROLES.includes(prof.role)) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel !== 'aal2') {
        setStatus(aal?.nextLevel === 'aal2' ? 'mfaChallenge' : 'mfaEnroll');
        return;
      }
    }
    const { data: o } = await supabase
      .from('organizations')
      .select('id, name, timezone, settings')
      .eq('id', prof.organization_id)
      .maybeSingle();
    setOrg((o as OrganizationRow) ?? null);
    setStatus('ready');
  }, []);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) void load(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_IN') void supabase.rpc('log_login').then(() => undefined);
      if (
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        event === 'USER_UPDATED' ||
        event === 'MFA_CHALLENGE_VERIFIED'
      ) {
        // Defer: calling Supabase inside the callback can deadlock the auth lock.
        setTimeout(() => void load(s), 0);
      } else if (event === 'TOKEN_REFRESHED') {
        setSession(s);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      profile,
      org,
      settings: resolveOrgSettings(org?.settings),
      timezone: org?.timezone ?? 'America/New_York',
      refresh: async () => {
        const { data } = await supabase.auth.getSession();
        await load(data.session);
      },
      signOut: async (reason) => {
        await supabase.auth.signOut();
        await load(null);
        if (reason === 'timeout') window.location.assign('/signin?reason=timeout');
      },
    }),
    [status, session, profile, org, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** Profile of a signed-in, fully authenticated user (use inside RequireAuth). */
export function useMe(): {
  profile: ProfileRow;
  timezone: string;
  settings: OrgSettings;
  org: OrganizationRow | null;
} {
  const { profile, timezone, settings, org } = useAuth();
  if (!profile) throw new Error('useMe without profile');
  return { profile, timezone, settings, org };
}
