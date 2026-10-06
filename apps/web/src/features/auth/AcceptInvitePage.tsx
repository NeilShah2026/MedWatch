import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { authCopy } from '@/copy/auth';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Loading } from '@/components/ui/States';
import { useAuth } from '@/app/AuthProvider';
import { AuthCard, FormAlert, passwordOk } from './AuthCard';

const schema = z
  .object({ full_name: z.string().min(2).max(120), password: z.string(), confirm: z.string() })
  .refine((v) => passwordOk(v.password), { path: ['password'], message: authCopy.passwordWeak })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: authCopy.passwordsMismatch,
  });

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { status, session, refresh } = useAuth();
  const nav = useNavigate();
  const [failed, setFailed] = useState(false);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });

  if (!token) {
    return (
      <AuthCard title={authCopy.acceptTitle}>
        <FormAlert>{authCopy.acceptMissingToken}</FormAlert>
      </AuthCard>
    );
  }
  if (status === 'loading') return <Loading />;
  if (!session) {
    return (
      <AuthCard title={authCopy.acceptTitle}>
        <FormAlert tone="info">{authCopy.acceptNeedsSession}</FormAlert>
      </AuthCard>
    );
  }

  const onSubmit = handleSubmit(async (v) => {
    setFailed(false);
    const pw = await supabase.auth.updateUser({ password: v.password });
    if (pw.error) {
      setFailed(true);
      return;
    }
    const { error } = await supabase.rpc('accept_invitation', {
      p_token: token,
      p_full_name: v.full_name.trim(),
    });
    if (error) {
      logger.warn('invite.accept_failed', { code: error.code ?? null });
      setFailed(true);
      return;
    }
    await refresh();
    nav('/', { replace: true });
  });

  return (
    <AuthCard title={authCopy.acceptTitle} subtitle={authCopy.acceptBody}>
      {failed ? <FormAlert>{authCopy.acceptFailed}</FormAlert> : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField
          label={authCopy.fullName}
          autoComplete="name"
          {...register('full_name')}
          error={formState.errors.full_name ? authCopy.fullName : undefined}
        />
        <TextField
          label={authCopy.newPassword}
          hint={authCopy.passwordRule}
          type="password"
          autoComplete="new-password"
          {...register('password')}
          error={formState.errors.password?.message}
        />
        <TextField
          label={authCopy.confirmPassword}
          type="password"
          autoComplete="new-password"
          {...register('confirm')}
          error={formState.errors.confirm?.message}
        />
        <Button type="submit" block busy={formState.isSubmitting}>
          {authCopy.acceptButton}
        </Button>
      </form>
    </AuthCard>
  );
}

export function NoProfilePage() {
  const { signOut, status } = useAuth();
  return (
    <AuthCard title={authCopy.noProfileTitle} subtitle={authCopy.noProfileBody}>
      {status !== 'signedOut' ? (
        <Button variant="secondary" block onClick={() => void signOut('manual')}>
          {authCopy.signOut}
        </Button>
      ) : null}
    </AuthCard>
  );
}
