import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { authCopy } from '@/copy/auth';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { homePathFor, useAuth } from '@/app/AuthProvider';
import { AuthCard, FormAlert } from './AuthCard';

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
type Form = z.infer<typeof schema>;

export function SignInPage() {
  const { status, profile } = useAuth();
  const [params] = useSearchParams();
  const [failed, setFailed] = useState(false);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema) });

  if (status === 'ready' && profile) {
    const next = params.get('next');
    return (
      <Navigate to={next && next.startsWith('/') ? next : homePathFor(profile.role)} replace />
    );
  }
  if (status === 'mfaChallenge') return <Navigate to="/mfa" replace />;
  if (status === 'mfaEnroll') return <Navigate to="/mfa/setup" replace />;
  if (status === 'noProfile') return <Navigate to="/no-profile" replace />;

  const onSubmit = handleSubmit(async (v) => {
    setFailed(false);
    const { error } = await supabase.auth.signInWithPassword({
      email: v.email.trim(),
      password: v.password,
    });
    if (error) setFailed(true);
  });

  return (
    <AuthCard title={authCopy.signInTitle} subtitle={authCopy.signInSubtitle}>
      {params.get('reason') === 'timeout' ? (
        <FormAlert tone="info">{authCopy.timedOut}</FormAlert>
      ) : null}
      {failed ? <FormAlert>{authCopy.signInFailed}</FormAlert> : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField
          label={authCopy.email}
          type="email"
          autoComplete="username"
          {...register('email')}
          error={formState.errors.email ? authCopy.email : undefined}
        />
        <TextField
          label={authCopy.password}
          type="password"
          autoComplete="current-password"
          {...register('password')}
        />
        <Button type="submit" block size="lg" busy={formState.isSubmitting}>
          {formState.isSubmitting ? authCopy.signingIn : authCopy.signIn}
        </Button>
      </form>
      <Link to="/forgot-password" className="inline-block font-semibold text-primary underline">
        {authCopy.forgot}
      </Link>
    </AuthCard>
  );
}
