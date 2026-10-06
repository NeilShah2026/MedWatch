import { createBrowserRouter, Outlet } from 'react-router-dom';
import { navCopy } from '@/copy/nav';
import { AppLayout, PublicLayout } from './AppLayout';
import { RequireAuth, RequireRole, RoleHome } from './guards';
import { NotFoundPage } from './ErrorPages';
import { Placeholder } from './Placeholder';
import { SignInPage } from '@/features/auth/SignInPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/PasswordPages';
import { MfaChallengePage, MfaSetupPage } from '@/features/auth/MfaPages';
import { AcceptInvitePage, NoProfilePage } from '@/features/auth/AcceptInvitePage';
import { AboutFlagsPage, PrivacyPage, TermsPage } from '@/features/static/StaticPages';

const STAFF = ['nurse', 'agency_admin'] as const;

export const router = createBrowserRouter([
  { path: '/', element: <RoleHome /> },
  {
    element: <PublicLayout />,
    children: [
      { path: '/signin', element: <SignInPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/mfa', element: <MfaChallengePage /> },
      { path: '/mfa/setup', element: <MfaSetupPage /> },
      { path: '/accept-invite', element: <AcceptInvitePage /> },
      { path: '/no-profile', element: <NoProfilePage /> },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/terms', element: <TermsPage /> },
      { path: '/about-flags', element: <AboutFlagsPage /> },
    ],
  },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      {
        path: '/me',
        element: (
          <RequireRole roles={['patient']}>
            <Outlet />
          </RequireRole>
        ),
        children: [{ index: true, element: <Placeholder title={navCopy.patient.today} /> }],
      },
      {
        path: '/care',
        element: (
          <RequireRole roles={['caregiver']}>
            <Outlet />
          </RequireRole>
        ),
        children: [{ index: true, element: <Placeholder title={navCopy.caregiver.people} /> }],
      },
      {
        path: '/clinic',
        element: (
          <RequireRole roles={[...STAFF]}>
            <Outlet />
          </RequireRole>
        ),
        children: [{ index: true, element: <Placeholder title={navCopy.nurse.caseload} /> }],
      },
      {
        path: '/admin',
        element: (
          <RequireRole roles={['agency_admin']}>
            <Outlet />
          </RequireRole>
        ),
        children: [{ index: true, element: <Placeholder title={navCopy.admin.dashboard} /> }],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
