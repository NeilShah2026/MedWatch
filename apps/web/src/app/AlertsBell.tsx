import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMyAlerts, markAlertsRead } from '@/lib/api/alerts';
import { qk } from '@/lib/queryKeys';
import { formatDateTime, shortName } from '@/lib/format';
import { navCopy } from '@/copy/nav';
import { IconBell } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { useMe } from './AuthProvider';
import type { AlertRow } from '@/lib/types';

function alertHref(a: AlertRow, role: string): string | null {
  if (!a.patient_id) return null;
  if (role === 'caregiver') return `/care/${a.patient_id}`;
  if (role === 'patient') return '/me';
  return `/clinic/patients/${a.patient_id}${a.alert_type === 'flag' ? '?tab=flags' : '?tab=doses'}`;
}

export function AlertsBell() {
  const { profile, timezone } = useMe();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const alerts = useQuery({
    queryKey: qk.alerts(profile.id),
    queryFn: () => fetchMyAlerts(profile.id),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: markAlertsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.alerts(profile.id) }),
  });
  const unread = (alerts.data ?? []).filter((a) => !a.read_at);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`${navCopy.alerts}: ${navCopy.alertsUnread(unread.length)}`}
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex min-h-touch min-w-touch items-center justify-center rounded-xl text-white hover:bg-white/10"
        data-testid="alerts-bell"
      >
        <IconBell />
        {unread.length ? (
          <span
            className="absolute right-1 top-1 min-w-[1.4rem] rounded-full bg-accent px-1 text-center text-xs font-bold text-ink"
            data-testid="alerts-unread"
          >
            {unread.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,380px)] rounded-2xl border border-line bg-surface p-3 text-ink shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">{navCopy.alerts}</h2>
            {unread.length ? (
              <Button variant="ghost" onClick={() => markRead.mutate(unread.map((a) => a.id))}>
                {navCopy.markAllRead}
              </Button>
            ) : null}
          </div>
          {!alerts.data?.length ? (
            <p className="p-3 text-ink-muted">{navCopy.alertsEmpty}</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {alerts.data.map((a) => {
                const href = alertHref(a, profile.role);
                const label = (
                  <>
                    <span className="block font-semibold">
                      {navCopy.alertType[a.alert_type]}
                      {a.patients ? ` — ${shortName(a.patients)}` : ''}
                    </span>
                    <span className="block text-sm text-ink-muted">
                      {formatDateTime(a.sent_at, timezone)}
                    </span>
                  </>
                );
                return (
                  <li
                    key={a.id}
                    className={`flex items-start gap-2 py-2 ${a.read_at ? 'opacity-70' : ''}`}
                  >
                    <div className="flex-1">
                      {href ? (
                        <Link
                          to={href}
                          className="block rounded-lg p-1 hover:bg-bg"
                          onClick={() => {
                            setOpen(false);
                            if (!a.read_at) markRead.mutate([a.id]);
                          }}
                        >
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                    </div>
                    {!a.read_at ? (
                      <Button variant="ghost" onClick={() => markRead.mutate([a.id])}>
                        {navCopy.markRead}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
