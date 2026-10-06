import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { authCopy } from '@/copy/auth';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Loading } from '@/components/ui/States';
import { useAuth } from '@/app/AuthProvider';
import { AuthCard, FormAlert } from './AuthCard';

function CodeForm({ onVerify }: { onVerify: (code: string) => Promise<boolean> }) {
  const [code, setCode] = useState('');
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setBad(!(await onVerify(code.trim())));
        setBusy(false);
      }}
    >
      {bad ? <FormAlert>{authCopy.mfaInvalid}</FormAlert> : null}
      <TextField
        label={authCopy.mfaCode}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      />
      <Button type="submit" block busy={busy} disabled={code.length !== 6}>
        {authCopy.mfaVerify}
      </Button>
    </form>
  );
}

export function MfaSetupPage() {
  const { status, refresh } = useAuth();
  const nav = useNavigate();
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(
    null,
  );

  useEffect(() => {
    if (status !== 'mfaEnroll') return;
    let cancelled = false;
    void (async () => {
      // Clear abandoned, unverified factors from earlier attempts.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.all ?? []) {
        if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `MedWatch ${Date.now()}`,
      });
      if (!cancelled && data)
        setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === 'signedOut') return <Navigate to="/signin" replace />;
  if (status === 'ready') return <Navigate to="/" replace />;
  if (!enrollment) return <Loading />;

  return (
    <AuthCard title={authCopy.mfaEnrollTitle} subtitle={authCopy.mfaEnrollBody}>
      <img
        src={enrollment.qr}
        alt={authCopy.mfaQrAlt}
        className="mx-auto h-48 w-48 rounded-xl border border-line bg-white p-2"
      />
      <p className="text-sm">
        {authCopy.mfaSecretLabel} <code className="break-all font-mono">{enrollment.secret}</code>
      </p>
      <CodeForm
        onVerify={async (code) => {
          const { error } = await supabase.auth.mfa.challengeAndVerify({
            factorId: enrollment.id,
            code,
          });
          if (error) return false;
          await refresh();
          nav('/', { replace: true });
          return true;
        }}
      />
    </AuthCard>
  );
}

export function MfaChallengePage() {
  const { status, refresh } = useAuth();
  const nav = useNavigate();
  if (status === 'signedOut') return <Navigate to="/signin" replace />;
  if (status === 'ready') return <Navigate to="/" replace />;
  if (status === 'mfaEnroll') return <Navigate to="/mfa/setup" replace />;
  return (
    <AuthCard title={authCopy.mfaChallengeTitle} subtitle={authCopy.mfaChallengeBody}>
      <CodeForm
        onVerify={async (code) => {
          const { data } = await supabase.auth.mfa.listFactors();
          const factor = data?.totp.find((f) => f.status === 'verified');
          if (!factor) return false;
          const { error } = await supabase.auth.mfa.challengeAndVerify({
            factorId: factor.id,
            code,
          });
          if (error) return false;
          await refresh();
          nav('/', { replace: true });
          return true;
        }}
      />
    </AuthCard>
  );
}
