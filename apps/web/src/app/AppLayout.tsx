import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import type { Role } from '@medwatch/core';
import { DemoBanner } from '@/components/ui/DemoBanner';
import { IconLogOut, IconMenu, IconX } from '@/components/ui/icons';
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

export function Footer() {
  return (
    <footer className="no-print mt-12 border-t border-line py-6 text-sm text-ink-muted">
      <nav aria-label="Legal" className="mx-auto flex max-w-6xl flex-wrap gap-4 px-4">
        <Link className="underline" to="/privacy">
          {navCopy.footer.privacy}
        </Link>
        <Link className="underline" to="/terms">
          {navCopy.footer.terms}
        </Link>
        <Link className="underline" to="/about-flags">
          {navCopy.footer.about}
        </Link>
      </nav>
    </footer>
  );
}

export function AppLayout() {
  const { profile } = useMe();
  const { signOut } = useAuth();
  const [menu, setMenu] = useState(false);
  const family = profile.role === 'patient' || profile.role === 'caregiver';

  // Spec §9: 18px base for patient/caregiver views, 16px for staff.
  useEffect(() => {
    document.documentElement.style.fontSize = family ? '18px' : '16px';
    return () => {
      document.documentElement.style.fontSize = '';
    };
  }, [family]);

  const links = NAV[profile.role];
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only-focusable absolute left-2 top-2 z-50 rounded bg-surface p-2 font-semibold"
      >
        {common.skipToContent}
      </a>
      <DemoBanner />
      <header className="no-print bg-primary text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
          <Link to="/" className="mr-4 text-xl font-bold tracking-tight">
            {common.appName}
          </Link>
          <nav aria-label={navCopy.mainNav} className="hidden flex-1 md:block">
            <ul className="flex flex-wrap gap-1">
              {links.map((l) => (
                <li key={l.to + l.label}>
                  <NavLink
                    to={l.to}
                    end={l.end}
                    className={({ isActive }) =>
                      `inline-flex min-h-touch items-center rounded-xl px-3 font-semibold ${isActive ? 'bg-white text-primary' : 'hover:bg-white/10'}`
                    }
                  >
                    {l.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <span className="hidden text-sm opacity-90 lg:inline">
              {navCopy.signedInAs(profile.full_name)}
            </span>
            <AlertsBell />
            <button
              type="button"
              onClick={() => void signOut('manual')}
              className="hidden min-h-touch items-center gap-2 rounded-xl px-3 font-semibold hover:bg-white/10 md:inline-flex"
            >
              <IconLogOut />
              {authCopy.signOut}
            </button>
            <button
              type="button"
              aria-expanded={menu}
              aria-controls="mobile-nav"
              aria-label={menu ? navCopy.closeMenu : navCopy.openMenu}
              onClick={() => setMenu((m) => !m)}
              className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-xl hover:bg-white/10 md:hidden"
            >
              {menu ? <IconX /> : <IconMenu />}
            </button>
          </div>
        </div>
        {menu ? (
          <nav
            id="mobile-nav"
            aria-label={navCopy.mainNav}
            className="border-t border-white/20 px-4 pb-3 md:hidden"
          >
            <ul className="flex flex-col gap-1 pt-2">
              {links.map((l) => (
                <li key={l.to + l.label}>
                  <NavLink
                    to={l.to}
                    end={l.end}
                    onClick={() => setMenu(false)}
                    className={({ isActive }) =>
                      `flex min-h-touch items-center rounded-xl px-3 font-semibold ${isActive ? 'bg-white text-primary' : 'hover:bg-white/10'}`
                    }
                  >
                    {l.label}
                  </NavLink>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => void signOut('manual')}
                  className="flex min-h-touch w-full items-center gap-2 rounded-xl px-3 font-semibold hover:bg-white/10"
                >
                  <IconLogOut />
                  {authCopy.signOut}
                </button>
              </li>
            </ul>
          </nav>
        ) : null}
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
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
      <header className="bg-primary px-4 py-3 text-white">
        <div className="mx-auto max-w-6xl">
          <Link to="/" className="text-xl font-bold">
            {common.appName}
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
