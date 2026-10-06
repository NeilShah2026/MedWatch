import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { authCopy } from '@/copy/auth';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { AuthCard, FormAlert, passwordOk } from './AuthCard';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, formState } = useForm<{ email: string }>({
    resolver: zodResolver(z.object({ email: z.string().email() })),
  });
  const onSubmit = handleSubmit(async ({ email }) => {
    // Same response whether or not the account exists (no account enumeration).
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSent(true);
  });
  return (
    <AuthCard title={authCopy.forgotTitle} subtitle={authCopy.forgotBody}>
      {sent ? <FormAlert tone="info">{authCopy.linkSent}</FormAlert> : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField
          label={authCopy.email}
          type="email"
          autoComplete="email"
          {...register('email')}
          error={formState.errors.email ? authCopy.email : undefined}
        />
        <Button type="submit" block busy={formState.isSubmitting}>
          {authCopy.sendLink}
        </Button>
      </form>
      <Link to="/signin" className="inline-block font-semibold text-primary underline">
        {authCopy.backToSignIn}
      </Link>
    </AuthCard>
  );
}

const pwSchema = z
  .object({ password: z.string(), confirm: z.string() })
  .refine((v) => passwordOk(v.password), { path: ['password'], message: authCopy.passwordWeak })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: authCopy.passwordsMismatch,
  });

export function ResetPasswordPage() {
  const nav = useNavigate();
  const [ready, setReady] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof pwSchema>>({
    resolver: zodResolver(pwSchema),
  });

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    void supabase.auth.getSession().then(({ data: s }) => setReady((r) => r ?? Boolean(s.session)));
    return () => data.subscription.unsubscribe();
  }, []);

  const onSubmit = handleSubmit(async (v) => {
    const { error } = await supabase.auth.updateUser({ password: v.password });
    if (error) {
      setReady(false);
      return;
    }
    setDone(true);
    setTimeout(() => nav('/'), 1500);
  });

  return (
    <AuthCard title={authCopy.resetTitle} subtitle={authCopy.passwordRule}>
      {ready === false ? <FormAlert>{authCopy.resetLinkInvalid}</FormAlert> : null}
      {done ? <FormAlert tone="info">{authCopy.passwordSaved}</FormAlert> : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField
          label={authCopy.newPassword}
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
        <Button type="submit" block busy={formState.isSubmitting} disabled={!ready}>
          {authCopy.savePassword}
        </Button>
      </form>
    </AuthCard>
  );
}
