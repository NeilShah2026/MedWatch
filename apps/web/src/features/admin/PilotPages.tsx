import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { addDays } from '@medwatch/core';
import { fetchPilotMetrics, type PilotMetrics } from '@/lib/api/admin';
import { logExport, logView } from '@/lib/audit';
import { downloadText, toCsv } from '@/lib/csv';
import { qk } from '@/lib/queryKeys';
import { formatDate, formatPercent, todayIn } from '@/lib/format';
import { adminCopy } from '@/copy/admin';
import { flagCopy } from '@/copy/flags';
import { common } from '@/copy/common';
import { useMe } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Card, PageHeader, StatCard, Table, td, th } from '@/components/ui/Layout';
import { QueryState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { IconDownload } from '@/components/ui/icons';

function metricRows(m: PilotMetrics) {
  const c = adminCopy.metrics;
  return [
    { metric: c.flagsCreated, value: m.flags_created },
    { metric: c.flagsReviewed, value: m.flags_reviewed },
    {
      metric: c.medianReview,
      value: m.median_review_hours === null ? '—' : adminCopy.kpi.hours(m.median_review_hours),
    },
    { metric: c.escalated, value: m.flags_escalated },
    {
      metric: c.adherence,
      value: `${formatPercent(m.adherence.rate)} (${m.adherence.given}/${m.adherence.total})`,
    },
    {
      metric: c.checkins,
      value: `${formatPercent(m.checkin_completion.rate)} (${m.checkin_completion.done}/${m.checkin_completion.expected})`,
    },
    { metric: c.missedAlerts, value: m.missed_dose_alerts },
    { metric: c.escalationAlerts, value: m.escalation_alerts },
  ];
}

function ByType({ m }: { m: PilotMetrics }) {
  return (
    <Table caption={adminCopy.metrics.byType}>
      <thead>
        <tr>
          <th className={th}>{adminCopy.type}</th>
          <th className={th}>{adminCopy.severity}</th>
          <th className={th}>{adminCopy.count}</th>
        </tr>
      </thead>
      <tbody>
        {m.flags_by_type_severity.map((r) => (
          <tr key={`${r.flag_type}-${r.severity}`}>
            <td className={td}>
              {flagCopy.type[r.flag_type as keyof typeof flagCopy.type] ?? r.flag_type}
            </td>
            <td className={td}>
              {flagCopy.severity[r.severity as keyof typeof flagCopy.severity] ?? r.severity}
            </td>
            <td className={td}>{r.count}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function PilotMetricsPage() {
  const { timezone } = useMe();
  const toast = useToast();
  const today = todayIn(timezone);
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const q = useQuery({ queryKey: qk.pilot(from, to), queryFn: () => fetchPilotMetrics(from, to) });
  useEffect(() => {
    void logView('pilot_metrics', null);
  }, []);
  return (
    <div className="space-y-4">
      <PageHeader
        title={adminCopy.pilotTitle}
        subtitle={adminCopy.pilotSubtitle}
        actions={
          <>
            <Link
              to={`/admin/pilot/report?from=${from}&to=${to}`}
              className="inline-flex min-h-touch items-center rounded-xl border-2 border-primary px-4 font-semibold text-primary"
            >
              {adminCopy.pilotReport}
            </Link>
            <Button
              disabled={!q.data}
              data-testid="export-pilot"
              onClick={async () => {
                try {
                  const m = q.data!;
                  const rows = [
                    ...metricRows(m).map((r) => ({
                      section: 'summary',
                      metric: r.metric,
                      value: r.value,
                    })),
                    ...m.flags_by_type_severity.map((r) => ({
                      section: 'flags_by_type_severity',
                      metric: `${r.flag_type}/${r.severity}`,
                      value: r.count,
                    })),
                  ];
                  await logExport('pilot_metrics', null, {
                    format: 'csv',
                    rows: rows.length,
                    from,
                    to,
                  });
                  downloadText(
                    `pilot-metrics-${from}-to-${to}.csv`,
                    toCsv(rows, ['section', 'metric', 'value']),
                  );
                } catch {
                  toast(common.genericError, 'error');
                }
              }}
            >
              <IconDownload />
              {adminCopy.exportCsv}
            </Button>
          </>
        }
      />
      <Card>
        <div className="grid max-w-lg gap-3 sm:grid-cols-2">
          <TextField
            label={adminCopy.filters.from}
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField
            label={adminCopy.filters.to}
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </Card>
      <QueryState query={q}>
        {(m) => (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="pilot-metrics">
              {metricRows(m).map((r) => (
                <StatCard key={r.metric} label={r.metric} value={r.value} />
              ))}
            </div>
            <Card title={adminCopy.metrics.byType}>
              <ByType m={m} />
            </Card>
          </>
        )}
      </QueryState>
    </div>
  );
}

export function PilotReportPage() {
  const [params] = useSearchParams();
  const { org } = useMe();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const q = useQuery({
    queryKey: qk.pilot(from, to),
    queryFn: () => fetchPilotMetrics(from, to),
    enabled: Boolean(from && to),
  });
  return (
    <article className="mx-auto max-w-3xl space-y-4 bg-surface p-6" data-testid="pilot-report">
      <div className="no-print flex justify-end">
        <Button onClick={() => window.print()}>{adminCopy.print}</Button>
      </div>
      <h1 className="text-2xl font-bold">{adminCopy.reportTitle}</h1>
      <p>
        {org?.name} · {adminCopy.period(from ? formatDate(from) : '', to ? formatDate(to) : '')}
      </p>
      <QueryState query={q}>
        {(m) => (
          <>
            <Table caption={adminCopy.reportTitle}>
              <tbody>
                {metricRows(m).map((r) => (
                  <tr key={r.metric}>
                    <th scope="row" className={`${td} text-left font-semibold`}>
                      {r.metric}
                    </th>
                    <td className={td}>{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <h2 className="text-lg font-bold">{adminCopy.metrics.byType}</h2>
            <ByType m={m} />
          </>
        )}
      </QueryState>
      <p className="border-t border-line pt-2 text-sm text-ink-muted">{adminCopy.reportFooter}</p>
    </article>
  );
}
