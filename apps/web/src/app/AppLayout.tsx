import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import type { Role } from '@medwatch/core';
import { DemoBanner } from '@/components/ui/DemoBanner';
import { IconLogOut, IconMenu, IconPill, IconX } from '@/components/ui/icons';
import { common } from '@/copy/common';
import { navCopy } from '@/copy/nav';
import { authCopy } from '@/copy/auth';
import { useAuth, useMe } from './AuthProvider';
import { AlertsBell } from './AlertsBell';
import { SessionTimeout } from './SessionTimeout';

const NAV: Record<Role, { to: string; label: string; end?: boolean }[]> = {
  patient: [
    { to: '/me', label: navCopy.patient.today, end: true },
    { to: '/me/checkin', label: navCopy.patient.checkin },
    { to: '/me/medicines', label: navCopy.patient.medicines },
  ],
  caregiver: [{ to: '/care', label: navCopy.caregiver.people, end: true }],
  nurse: [
    { to: '/clinic', label: navCopy.nurse.caseload, end: true },
    { to: '/clinic/flags', label: navCopy.nurse.inbox },
  ],
  agency_admin: [
    { to: '/admin', label: navCopy.admin.dashboard, end: true },
    { to: '/clinic', label: navCopy.admin.caseload, end: true },
    { to: '/clinic/flags', label: navCopy.admin.inbox },
    { to: '/admin/patients', label: navCopy.admin.patients },
    { to: '/admin/team', label: navCopy.admin.team },
    { to: '/admin/settings', label: navCopy.admin.settings },
    { to: '/admin/audit', label: navCopy.admin.audit },
    { to: '/admin/pilot', label: navCopy.admin.pilot },
  ],
};

const navLink = (isActive: boolean) =>
  `inline-flex min-h-touch items-center rounded-xl px-3 font-semibold transition-colors ${isActive ? 'bg-primary-light text-primary-dark' : 'text-ink-muted hover:bg-bg hover:text-ink'}`;

function Brand() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2.5 rounded-xl text-primary">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
        <IconPill />
      </span>
      <span className="text-xl font-bold tracking-tight text-ink">{common.appName}</span>
    </Link>
  );
}

function initials(name: string) {
  const parts = name
    .replace(/\(.*?\)|,.*$/g, '')
    .trim()
    .split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

export function Footer() {
  return (
    <footer className="no-print mt-16 border-t border-line py-8 text-sm text-ink-muted">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6">
        <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link className="hover:text-ink hover:underline" to="/privacy">
            {navCopy.footer.privacy}
          </Link>
          <Link className="hover:text-ink hover:underline" to="/terms">
            {navCopy.footer.terms}
          </Link>
          <Link className="hover:text-ink hover:underline" to="/about-flags">
            {navCopy.footer.about}
          </Link>
        </nav>
      </div>
    </footer>
  );
}

export function AppLayout() {
  const { profile } = useMe();
  const { signOut } = useAuth();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const family = profile.role === 'patient' || profile.role === 'caregiver';

  // Spec §9: 18px base for patient/caregiver views, 16px for staff.
  useEffect(() => {
    document.documentElement.style.fontSize = family ? '18px' : '16px';
    return () => {
      document.documentElement.style.fontSize = '';
    };
  }, [family]);

  const links = NAV[profile.role];
  // Roles with many destinations (admin) switch to the full nav only on wider screens.
  const bp =
    links.length > 4
      ? { show: 'xl:block', flex: 'xl:inline-flex', hide: 'xl:hidden', name: '2xl:inline' }
      : { show: 'lg:block', flex: 'lg:inline-flex', hide: 'lg:hidden', name: 'xl:inline' };
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only-focusable absolute left-2 top-2 z-50 rounded bg-surface p-2 font-semibold"
      >
        {common.skipToContent}
      </a>
      <DemoBanner />
      <header className="no-print sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Brand />
          <nav aria-label={navCopy.mainNav} className={`hidden min-w-0 flex-1 ${bp.show}`}>
            <ul className="flex gap-1">
              {links.map((l) => (
                <li key={l.to + l.label}>
                  <NavLink
                    to={l.to}
                    end={l.end}
                    className={({ isActive }) =>
                      `${navLink(isActive)} whitespace-nowrap text-[0.9375rem]`
                    }
                  >
                    {l.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <AlertsBell />
            <span
              className={`hidden items-center gap-2 px-1 ${bp.flex}`}
              title={navCopy.signedInAs(profile.full_name)}
            >
              <span
                aria-hidden="true"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-light text-sm font-bold text-ink"
              >
                {initials(profile.full_name)}
              </span>
              <span className="sr-only">{navCopy.signedInAs(profile.full_name)}</span>
              <span
                aria-hidden="true"
                className={`hidden max-w-[15rem] truncate text-sm font-semibold ${bp.name}`}
              >
                {profile.full_name}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void signOut('manual')}
              title={authCopy.signOut}
              className={`hidden min-h-touch min-w-touch items-center justify-center gap-2 rounded-xl px-3 font-semibold text-ink-muted transition-colors hover:bg-bg hover:text-ink ${bp.flex}`}
            >
              <IconLogOut />
              <span className="sr-only 2xl:not-sr-only">{authCopy.signOut}</span>
            </button>
            <button
              type="button"
              aria-expanded={menu}
              aria-controls="mobile-nav"
              aria-label={menu ? navCopy.closeMenu : navCopy.openMenu}
              onClick={() => setMenu((m) => !m)}
              className={`inline-flex min-h-touch min-w-touch items-center justify-center rounded-xl text-ink hover:bg-bg ${bp.hide}`}
            >
              {menu ? <IconX /> : <IconMenu />}
            </button>
          </div>
        </div>
        {menu ? (
          <nav
            id="mobile-nav"
            aria-label={navCopy.mainNav}
            className={`border-t border-line px-4 pb-4 sm:px-6 ${bp.hide}`}
          >
            <p className="px-3 pb-1 pt-3 text-sm text-ink-muted">
              {navCopy.signedInAs(profile.full_name)}
            </p>
            <ul className="flex flex-col gap-1 pt-1">
              {links.map((l) => (
                <li key={l.to + l.label}>
                  <NavLink
                    to={l.to}
                    end={l.end}
                    onClick={() => setMenu(false)}
                    className={({ isActive }) => `${navLink(isActive)} flex w-full`}
                  >
                    {l.label}
                  </NavLink>
                </li>
              ))}
              <li className="mt-1 border-t border-line pt-2">
                <button
                  type="button"
                  onClick={() => void signOut('manual')}
                  className="flex min-h-touch w-full items-center gap-2 rounded-xl px-3 font-semibold text-ink-muted hover:bg-bg hover:text-ink"
                >
                  <IconLogOut />
                  {authCopy.signOut}
                </button>
              </li>
            </ul>
          </nav>
        ) : null}
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 md:py-10">
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <Footer />
      <SessionTimeout />
    </div>
  );
}

/** Minimal layout for signed-out pages (sign in, static pages). */
export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-7xl items-center px-4 sm:px-6">
          <Brand />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 md:py-16">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <Footer />
    </div>
  );
}
