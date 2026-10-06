import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-ink md:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-ink-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = '',
  title,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="card" data-testid={testId}>
      <p className="text-sm font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold text-ink">{value}</p>
      {hint ? <p className="mt-1 text-sm text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const th = 'border-b border-line bg-bg px-3 py-2 text-sm font-semibold text-ink-muted';
export const td = 'border-b border-line px-3 py-2 align-top';
