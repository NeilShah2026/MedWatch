import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '@medwatch/core';
import { Loading } from '@/components/ui/States';
import { homePathFor, useAuth } from './AuthProvider';
import { ForbiddenPage } from './ErrorPages';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Loading />;
  if (status === 'signedOut')
    return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (status === 'noProfile') return <Navigate to="/no-profile" replace />;
  if (status === 'mfaEnroll') return <Navigate to="/mfa/setup" replace />;
  if (status === 'mfaChallenge') return <Navigate to="/mfa" replace />;
  return <>{children}</>;
}

/** UI mirror of RLS: hides pages a role cannot use. The database is the real boundary. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile } = useAuth();
  if (!profile) return <Loading />;
  if (!roles.includes(profile.role)) return <ForbiddenPage />;
  return <>{children}</>;
}

export function RoleHome() {
  const { status, profile } = useAuth();
  if (status === 'loading') return <Loading />;
  if (status !== 'ready' || !profile) return <RequireAuth>{null}</RequireAuth>;
  return <Navigate to={homePathFor(profile.role)} replace />;
}
