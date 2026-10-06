import type { ReactNode } from 'react';
import type { Severity } from '@medwatch/core';
import { flagCopy } from '@/copy/flags';
import { IconAlert, IconCircle, IconInfo } from './icons';

const SEV: Record<Severity, { cls: string; icon: ReactNode }> = {
  high: { cls: 'bg-sev-highbg text-severity-high border-severity-high', icon: <IconAlert /> },
  medium: { cls: 'bg-sev-mediumbg text-[#8a5a14] border-severity-medium', icon: <IconCircle /> },
  low: { cls: 'bg-sev-lowbg text-[#3d5f86] border-severity-low', icon: <IconInfo /> },
};

/** Severity is always color + icon + text (never color alone). */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEV[severity];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-semibold ${s.cls}`}
      data-severity={severity}
    >
      {s.icon}
      {flagCopy.severity[severity]}
    </span>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
}) {
  const tones = {
    neutral: 'bg-bg text-ink border-line',
    good: 'bg-primary-light text-primary-dark border-primary/30',
    warn: 'bg-sev-mediumbg text-[#8a5a14] border-severity-medium/40',
    bad: 'bg-sev-highbg text-severity-high border-severity-high/40',
    info: 'bg-sev-lowbg text-[#3d5f86] border-severity-low/40',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
