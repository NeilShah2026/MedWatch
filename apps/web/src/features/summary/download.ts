import type { VisitSummaryContent } from '@medwatch/core';
import { logExport } from '@/lib/audit';

/** Log the export first (spec §6.3), then build the PDF and hand it to the browser. */
export async function downloadSummaryPdf(summaryId: string, content: VisitSummaryContent) {
  await logExport('visit_summary', summaryId, { format: 'pdf' });
  const { renderSummaryPdf } = await import('./SummaryPdf');
  const blob = await renderSummaryPdf(content);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // File name uses the summary id and date only — no patient name in file names (Hard Rule 4).
  a.download = `visit-summary-${content.header.period_end}-${summaryId.slice(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
