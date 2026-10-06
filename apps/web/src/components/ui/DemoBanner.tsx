import { isProduction } from '@/lib/env';
import { common } from '@/copy/common';

/** Hard Rule 7: persistent banner in every non-production environment. */
export function DemoBanner() {
  if (isProduction) return null;
  return (
    <div
      role="note"
      className="no-print w-full bg-accent-light px-4 py-1.5 text-center text-sm font-semibold text-ink"
      data-testid="demo-banner"
    >
      {common.demoBanner}
    </div>
  );
}
