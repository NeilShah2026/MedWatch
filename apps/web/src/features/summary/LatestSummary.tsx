import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { fetchSummaries } from '@/lib/api/summaries';
import { qk } from '@/lib/queryKeys';
import { logView } from '@/lib/audit';
import type { PatientRow } from '@/lib/types';
import { summaryCopy } from '@/copy/summary';
import { useMe } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState, QueryState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { common } from '@/copy/common';
import { IconDownload } from '@/components/ui/icons';
import { SummaryView } from './SummaryView';
import { downloadSummaryPdf } from './download';

/** Caregiver/patient view of the most recent visit summary. */
export function LatestSummary({ patient }: { patient: PatientRow }) {
  const { timezone } = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: qk.summaries(patient.id),
    queryFn: () => fetchSummaries(patient.id),
  });
  const latestId = q.data?.[0]?.id;
  useEffect(() => {
    if (latestId) void logView('visit_summary', latestId);
  }, [latestId]);
  return (
    <QueryState
      query={q}
      isEmpty={(d) => d.length === 0}
      empty={<EmptyState title={summaryCopy.none} body={summaryCopy.noneBody} />}
    >
      {(list) => (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await downloadSummaryPdf(list[0]!.id, list[0]!.content);
                } catch {
                  toast(common.genericError, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <IconDownload />
              {busy ? summaryCopy.downloading : summaryCopy.download}
            </Button>
          </div>
          <SummaryView content={list[0]!.content} timezone={timezone} />
        </div>
      )}
    </QueryState>
  );
}
