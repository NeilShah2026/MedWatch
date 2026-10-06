import { useCallback, useEffect, useRef, useState } from 'react';
import { isProduction } from '@/lib/env';
import { authCopy } from '@/copy/auth';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useAuth } from './AuthProvider';

const WARN_MS = 60_000;
const STORAGE_KEY = 'medwatch.lastActivity';
/** Test hook (non-production only): shorten the timeout for the session-timeout E2E. */
export const E2E_TIMEOUT_KEY = 'medwatch.e2e.sessionTimeoutSeconds';

function readNumber(key: string): number | null {
  try {
    const v = window.localStorage.getItem(key);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

function writeActivity(t: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(t));
  } catch {
    /* storage unavailable: per-tab timer still works */
  }
}

/** Idle sign-out from org settings: warn 1 minute before, then sign out (spec §6.4). */
export function SessionTimeout() {
  const { settings, signOut } = useAuth();
  const override = isProduction ? null : readNumber(E2E_TIMEOUT_KEY);
  const timeoutMs = override ? override * 1000 : settings.session_timeout_minutes * 60_000;
  const warnMs = Math.min(WARN_MS, timeoutMs / 2);
  const last = useRef(Date.now());
  const [remaining, setRemaining] = useState<number | null>(null);
  const warning = remaining !== null;

  const touch = useCallback(() => {
    last.current = Date.now();
    writeActivity(last.current);
    setRemaining(null);
  }, []);

  useEffect(() => {
    const onActivity = () => {
      if (!warning) touch();
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onActivity));
  }, [touch, warning]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const shared = readNumber(STORAGE_KEY);
      const lastSeen = Math.max(last.current, shared ?? 0);
      const left = timeoutMs - (Date.now() - lastSeen);
      if (left <= 0) {
        window.clearInterval(id);
        void signOut('timeout');
      } else if (left <= warnMs) {
        setRemaining(Math.ceil(left / 1000));
      } else if (warning) {
        setRemaining(null);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [timeoutMs, warnMs, signOut, warning]);

  return (
    <Modal
      open={warning}
      onClose={touch}
      title={authCopy.timeoutTitle}
      testId="session-timeout-modal"
      footer={
        <>
          <Button variant="secondary" onClick={() => void signOut('manual')}>
            {authCopy.signOut}
          </Button>
          <Button onClick={touch}>{authCopy.staySignedIn}</Button>
        </>
      }
    >
      <p aria-live="assertive">{authCopy.timeoutBody(remaining ?? 0)}</p>
    </Modal>
  );
}
