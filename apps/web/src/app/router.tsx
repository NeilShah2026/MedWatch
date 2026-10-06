import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Outlet } from 'react-router-dom';
import { Loading } from '@/components/ui/States';
import { AppLayout, PublicLayout } from './AppLayout';
import { RequireAuth, RequireRole, RoleHome } from './guards';
import { NotFoundPage } from './ErrorPages';
import { SignInPage } from '@/features/auth/SignInPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/PasswordPages';
import { MfaChallengePage, MfaSetupPage } from '@/features/auth/MfaPages';
import { AcceptInvitePage, NoProfilePage } from '@/features/auth/AcceptInvitePage';
import { AboutFlagsPage, PrivacyPage, TermsPage } from '@/features/static/StaticPages';
// Role areas are code-split so each user only downloads what their role needs.
const lazyNamed = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(async () => ({ default: (await load())[name] }));
const MeTodayPage = lazyNamed(() => import('@/features/patient/MePages'), 'MeTodayPage');
const MeCheckinPage = lazyNamed(() => import('@/features/patient/MePages'), 'MeCheckinPage');
const MeMedicinesPage = lazyNamed(() => import('@/features/patient/MePages'), 'MeMedicinesPage');
const PeoplePage = lazyNamed(() => import('@/features/caregiver/CaregiverPages'), 'PeoplePage');
const CarePatientPage = lazyNamed(
  () => import('@/features/caregiver/CaregiverPages'),
  'CarePatientPage',
);
const CaseloadPage = lazyNamed(() => import('@/features/clinic/CaseloadPage'), 'CaseloadPage');
const FlagInboxPage = lazyNamed(() => import('@/features/clinic/FlagInboxPage'), 'FlagInboxPage');
const PatientDetailPage = lazyNamed(
  () => import('@/features/clinic/PatientDetailPage'),
  'PatientDetailPage',
);
const DashboardPage = lazyNamed(() => import('@/features/admin/DashboardPage'), 'DashboardPage');
const PatientsPage = lazyNamed(() => import('@/features/admin/PatientsPage'), 'PatientsPage');
const TeamPage = lazyNamed(() => import('@/features/admin/TeamPage'), 'TeamPage');
const SettingsPage = lazyNamed(() => import('@/features/admin/SettingsPage'), 'SettingsPage');
const AuditPage = lazyNamed(() => import('@/features/admin/AuditPage'), 'AuditPage');
const PilotMetricsPage = lazyNamed(() => import('@/features/admin/PilotPages'), 'PilotMetricsPage');
const PilotReportPage = lazyNamed(() => import('@/features/admin/PilotPages'), 'PilotReportPage');

function Area({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

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
            <Area>
              <Outlet />
            </Area>
          </RequireRole>
        ),
        children: [
          { index: true, element: <MeTodayPage /> },
          { path: 'checkin', element: <MeCheckinPage /> },
          { path: 'medicines', element: <MeMedicinesPage /> },
        ],
      },
      {
        path: '/care',
        element: (
          <RequireRole roles={['caregiver']}>
            <Area>
              <Outlet />
            </Area>
          </RequireRole>
        ),
        children: [
          { index: true, element: <PeoplePage /> },
          { path: ':patientId', element: <CarePatientPage /> },
        ],
      },
      {
        path: '/clinic',
        element: (
          <RequireRole roles={[...STAFF]}>
            <Area>
              <Outlet />
            </Area>
          </RequireRole>
        ),
        children: [
          { index: true, element: <CaseloadPage /> },
          { path: 'flags', element: <FlagInboxPage /> },
          { path: 'patients/:patientId', element: <PatientDetailPage /> },
        ],
      },
      {
        path: '/admin',
        element: (
          <RequireRole roles={['agency_admin']}>
            <Area>
              <Outlet />
            </Area>
          </RequireRole>
        ),
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'patients', element: <PatientsPage /> },
          { path: 'team', element: <TeamPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'audit', element: <AuditPage /> },
          { path: 'pilot', element: <PilotMetricsPage /> },
          { path: 'pilot/report', element: <PilotReportPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
