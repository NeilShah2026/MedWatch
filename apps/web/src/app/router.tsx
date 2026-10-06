import { createBrowserRouter, Outlet } from 'react-router-dom';
import { AppLayout, PublicLayout } from './AppLayout';
import { RequireAuth, RequireRole, RoleHome } from './guards';
import { NotFoundPage } from './ErrorPages';
import { SignInPage } from '@/features/auth/SignInPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/PasswordPages';
import { MfaChallengePage, MfaSetupPage } from '@/features/auth/MfaPages';
import { AcceptInvitePage, NoProfilePage } from '@/features/auth/AcceptInvitePage';
import { AboutFlagsPage, PrivacyPage, TermsPage } from '@/features/static/StaticPages';
import { MeCheckinPage, MeMedicinesPage, MeTodayPage } from '@/features/patient/MePages';
import { CarePatientPage, PeoplePage } from '@/features/caregiver/CaregiverPages';
import { CaseloadPage } from '@/features/clinic/CaseloadPage';
import { FlagInboxPage } from '@/features/clinic/FlagInboxPage';
import { PatientDetailPage } from '@/features/clinic/PatientDetailPage';
import { DashboardPage } from '@/features/admin/DashboardPage';
import { PatientsPage } from '@/features/admin/PatientsPage';
import { TeamPage } from '@/features/admin/TeamPage';
import { SettingsPage } from '@/features/admin/SettingsPage';
import { AuditPage } from '@/features/admin/AuditPage';
import { PilotMetricsPage, PilotReportPage } from '@/features/admin/PilotPages';

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
            <Outlet />
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
            <Outlet />
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
            <Outlet />
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
