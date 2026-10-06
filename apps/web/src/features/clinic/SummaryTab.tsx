import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SYMPTOM_CATALOG,
  buildVisitSummary,
  localDate,
  type VisitSummaryContent,
} from '@medwatch/core';
import { fetchChanges, fetchMedications } from '@/lib/api/meds';
import { fetchDoses } from '@/lib/api/doses';
import { fetchLogs } from '@/lib/api/symptoms';
import { fetchFlags } from '@/lib/api/flags';
import { fetchStaff } from '@/lib/api/staff';
import { fetchSummaries, saveSummary } from '@/lib/api/summaries';
import { recordVisit } from '@/lib/api/patients';
import { qk } from '@/lib/queryKeys';
import { rules } from '@/lib/rules';
import { formatDate, formatDateTime, todayIn } from '@/lib/format';
import type { PatientRow } from '@/lib/types';
import { summaryCopy } from '@/copy/summary';
import { common } from '@/copy/common';
import { useMe } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Card } from '@/components/ui/Layout';
import { Loading } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { IconDownload } from '@/components/ui/icons';
import { SummaryView } from '@/features/summary/SummaryView';
import { downloadSummaryPdf } from '@/features/summary/download';

export function SummaryTab({ patient }: { patient: PatientRow }) {
  const { profile, timezone } = useMe();
  const today = todayIn(timezone);
  const qc = useQueryClient();
  const toast = useToast();
  const defaultStart = patient.last_visit_at ? localDate(patient.last_visit_at, timezone) : today;
  const [start, setStart] = useState(defaultStart < today ? defaultStart : today);
  const [end, setEnd] = useState(today);
  const [viewing, setViewing] = useState<{ id: string; content: VisitSummaryContent } | null>(null);

  const meds = useQuery({
    queryKey: qk.medications(patient.id),
    queryFn: () => fetchMedications(patient.id),
  });
  const changes = useQuery({
    queryKey: qk.changes(patient.id),
    queryFn: () => fetchChanges(patient.id),
  });
  const doses = useQuery({
    queryKey: ['doses', patient.id, start, end, 'summary'],
    queryFn: () => fetchDoses(patient.id, start, end, timezone),
  });
  const logs = useQuery({
    queryKey: qk.symptomLogs(patient.id, start),
    queryFn: () => fetchLogs(patient.id, start),
  });
  const flags = useQuery({ queryKey: qk.flags(patient.id), queryFn: () => fetchFlags(patient.id) });
  const staff = useQuery({ queryKey: qk.staff(), queryFn: fetchStaff });
  const history = useQuery({
    queryKey: qk.summaries(patient.id),
    queryFn: () => fetchSummaries(patient.id),
  });

  const ready = meds.data && changes.data && doses.data && logs.data && flags.data;
  const content = useMemo(() => {
    if (!ready) return null;
    const name = (id: string | null) =>
      id ? (staff.data?.find((s) => s.id === id)?.full_name ?? null) : null;
    return buildVisitSummary({
      patient,
      period: { start, end },
      generatedAt: new Date(),
      generatedBy: profile.full_name,
      timezone,
      medications: meds.data!,
      medicationChanges: changes.data!,
      doseEvents: doses.data!,
      symptomLogs: logs.data!.filter((l) => l.logged_for_date <= end),
      flags: flags.data!.map((f) => ({ ...f, reviewer_name: name(f.reviewed_by) })),
      rules,
      catalog: SYMPTOM_CATALOG,
    });
  }, [
    ready,
    meds.data,
    changes.data,
    doses.data,
    logs.data,
    flags.data,
    staff.data,
    patient,
    start,
    end,
    profile.full_name,
    timezone,
  ]);

  const generate = useMutation({
    mutationFn: async () => {
      const row = await saveSummary({
        organization_id: patient.organization_id,
        patient_id: patient.id,
        generated_by: profile.id,
        period_start: start,
        period_end: end,
        content: content!,
      });
      await downloadSummaryPdf(row.id, row.content);
      return row;
    },
    onSuccess: () => {
      toast(summaryCopy.saved);
      void qc.invalidateQueries({ queryKey: qk.summaries(patient.id) });
    },
    onError: () => toast(common.genericError, 'error'),
  });
  const visit = useMutation({
    mutationFn: () => recordVisit(patient.id),
    onSuccess: () => {
      toast(summaryCopy.visitRecorded);
      void qc.invalidateQueries({ queryKey: qk.patient(patient.id) });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });

  return (
    <div className="space-y-4">
      <Card
        title={summaryCopy.title}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" busy={visit.isPending} onClick={() => visit.mutate()}>
              {summaryCopy.recordVisit}
            </Button>
            <Button
              disabled={!content}
              busy={generate.isPending}
              onClick={() => generate.mutate()}
              data-testid="generate-summary"
            >
              <IconDownload />
              {generate.isPending ? summaryCopy.generating : summaryCopy.generate}
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-ink-muted">
          {patient.last_visit_at
            ? summaryCopy.lastVisit(formatDate(patient.last_visit_at))
            : summaryCopy.noVisit}
        </p>
        <div className="grid max-w-lg gap-3 sm:grid-cols-2">
          <TextField
            label={summaryCopy.periodStart}
            type="date"
            value={start}
            max={end}
            onChange={(e) => setStart(e.target.value)}
          />
          <TextField
            label={summaryCopy.periodEnd}
            type="date"
            value={end}
            min={start}
            max={today}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </Card>
      <h3 className="text-lg font-bold">{summaryCopy.preview}</h3>
      {content ? <SummaryView content={content} timezone={timezone} /> : <Loading />}
      <Card title={summaryCopy.history}>
        {history.data?.length ? (
          <ul className="divide-y divide-line">
            {history.data.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {formatDate(h.period_start)} – {formatDate(h.period_end)} ·{' '}
                  {formatDateTime(h.created_at, timezone)}
                </span>
                <span className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setViewing({ id: h.id, content: h.content })}
                  >
                    {summaryCopy.preview}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void downloadSummaryPdf(h.id, h.content).catch(() =>
                        toast(common.genericError, 'error'),
                      )
                    }
                  >
                    {summaryCopy.download}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">{summaryCopy.none}</p>
        )}
      </Card>
      {viewing ? (
        <div>
          <SummaryView content={viewing.content} timezone={timezone} />
        </div>
      ) : null}
    </div>
  );
}
