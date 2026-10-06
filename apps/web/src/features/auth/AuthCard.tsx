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
      <div className="card p-6">
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle ? <p className="mt-1 text-ink-muted">{subtitle}</p> : null}
        <div className="mt-6 space-y-4">{children}</div>
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
      className={`rounded-xl px-3 py-2 font-semibold ${tone === 'error' ? 'bg-sev-highbg text-severity-high' : 'bg-primary-light text-primary-dark'}`}
    >
      {children}
    </p>
  );
}

export const passwordOk = (p: string) => p.length >= 10 && /[a-zA-Z]/.test(p) && /\d/.test(p);
