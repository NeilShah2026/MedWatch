import type { ReactNode } from 'react';

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-ink-muted">{subtitle}</p> : null}
        <div className="mt-8 space-y-5">{children}</div>
      </div>
    </div>
  );
}

export function FormAlert({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'info';
}) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl px-3 py-2 font-semibold ${tone === 'error' ? 'bg-sev-highbg text-sevtext-high' : 'bg-primary-light text-primary-dark'}`}
    >
      {children}
    </p>
  );
}

export const passwordOk = (p: string) => p.length >= 10 && /[a-zA-Z]/.test(p) && /\d/.test(p);
