import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { addDays, formatShortDate } from '@medwatch/core';
import {
  fetchAiStats,
  fetchFlagsWeekly,
  fetchKpis,
  fetchNeedsAttention,
  fetchOrgAdherence,
} from '@/lib/api/admin';
import { logView } from '@/lib/audit';
import { qk } from '@/lib/queryKeys';
import { formatDate, formatPercent, fullName, todayIn } from '@/lib/format';
import { adminCopy } from '@/copy/admin';
import { useMe } from '@/app/AuthProvider';
import { Card, PageHeader, StatCard } from '@/components/ui/Layout';
import { SeverityBadge } from '@/components/ui/Badge';
import { EmptyState, QueryState } from '@/components/ui/States';
import { IconChevronRight } from '@/components/ui/icons';

export function DashboardPage() {
  const { timezone } = useMe();
  const today = todayIn(timezone);
  const from30 = addDays(today, -29);
  const from8w = addDays(today, -55);
  const kpis = useQuery({ queryKey: [...qk.dashboard(), 'kpis'], queryFn: fetchKpis });
  const attention = useQuery({
    queryKey: [...qk.dashboard(), 'attention'],
    queryFn: fetchNeedsAttention,
  });
  const trend = useQuery({
    queryKey: [...qk.dashboard(), 'trend', from30],
    queryFn: () => fetchOrgAdherence(from30, today),
  });
  const weekly = useQuery({
    queryKey: [...qk.dashboard(), 'weekly', from8w],
    queryFn: () => fetchFlagsWeekly(from8w, today),
  });
  const ai = useQuery({ queryKey: [...qk.dashboard(), 'ai'], queryFn: fetchAiStats });
  useEffect(() => {
    void logView('dashboard', null);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title={adminCopy.dashboardTitle} subtitle={adminCopy.dashboardSubtitle} />

      <QueryState query={kpis}>
        {(k) => (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="kpis">
            <StatCard label={adminCopy.kpi.active} value={k.active_patients} />
            <StatCard
              label={adminCopy.kpi.adherence}
              value={formatPercent(k.adherence_7d.rate)}
              hint={`${k.adherence_7d.given}/${k.adherence_7d.total}`}
            />
            <StatCard
              label={adminCopy.kpi.openFlags}
              value={k.open_flags.high + k.open_flags.medium + k.open_flags.low}
              hint={adminCopy.kpi.openFlagsHint(
                k.open_flags.high,
                k.open_flags.medium,
                k.open_flags.low,
              )}
            />
            <StatCard
              label={adminCopy.kpi.review}
              value={
                k.median_review_hours_30d === null
                  ? '—'
                  : adminCopy.kpi.hours(k.median_review_hours_30d)
              }
              hint={adminCopy.kpi.reviewHint(k.reviewed_30d)}
            />
            <StatCard
              label={adminCopy.kpi.checkins}
              value={formatPercent(k.checkin_completion_7d.rate)}
              hint={`${k.checkin_completion_7d.done}/${k.checkin_completion_7d.expected}`}
            />
          </div>
        )}
      </QueryState>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={adminCopy.needsAttention} className="lg:col-span-2">
          <QueryState
            query={attention}
            isEmpty={(d) => d.length === 0}
            empty={<EmptyState title={adminCopy.needsAttentionEmpty} />}
          >
            {(rows) => (
              <ul className="divide-y divide-line" data-testid="needs-attention">
                {rows.map((r) => {
                  const reasons = [
                    r.high_flags ? adminCopy.reasons.high(r.high_flags) : '',
                    r.escalations_24h ? adminCopy.reasons.escalation(r.escalations_24h) : '',
                    r.missing_checkin
                      ? adminCopy.reasons.noCheckin(
                          r.last_checkin ? formatDate(r.last_checkin) : null,
                        )
                      : '',
                  ].filter(Boolean);
                  return (
                    <li key={r.patient_id}>
                      <Link
                        to={`/clinic/patients/${r.patient_id}`}
                        className="flex min-h-touch items-center gap-3 py-2 hover:bg-bg"
                      >
                        {r.high_flags ? <SeverityBadge severity="high" /> : null}
                        <span className="font-semibold">{fullName(r)}</span>
                        <span className="flex-1 text-ink-muted">{reasons.join(' · ')}</span>
                        <IconChevronRight />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </QueryState>
        </Card>
        <Card title={adminCopy.aiCard}>
          <QueryState query={ai}>
            {(s) => {
              const total =
                s.active_templates.ai + s.active_templates.rules + s.active_templates.default;
              return (
                <div className="space-y-2" data-testid="ai-card">
                  <p className="text-3xl font-bold">
                    {total ? formatPercent(s.active_templates.ai / total) : '—'}
                  </p>
                  <p>{adminCopy.aiShare(s.active_templates.ai, total)}</p>
                  <p>{adminCopy.aiFailures(s.ai_failures_7d, s.ai_requests_7d)}</p>
                  <p className="text-sm text-ink-muted">{adminCopy.aiOff}</p>
                </div>
              );
            }}
          </QueryState>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={adminCopy.adherenceTrend}>
          <QueryState query={trend}>
            {(rows) => (
              <div className="h-64" role="img" aria-label={adminCopy.adherenceTrend}>
                <ResponsiveContainer>
                  <LineChart
                    data={rows.map((r) => ({
                      day: r.day,
                      rate: r.counted ? Math.round((r.given / r.counted) * 100) : null,
                    }))}
                    margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
                  >
                    <CartesianGrid vertical={false} stroke="#E6E1D8" />
                    <XAxis dataKey="day" tickFormatter={formatShortDate} minTickGap={28} />
                    <YAxis domain={[0, 100]} unit="%" width={44} />
                    <Tooltip
                      labelFormatter={(d) => formatShortDate(String(d))}
                      formatter={(v) => [`${v}%`, adminCopy.kpi.adherence]}
                    />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      stroke="#2F6F73"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </QueryState>
        </Card>
        <Card title={adminCopy.flagsWeekly}>
          <QueryState query={weekly}>
            {(rows) => (
              <div className="h-64" role="img" aria-label={adminCopy.flagsWeekly}>
                <ResponsiveContainer>
                  <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="#E6E1D8" />
                    <XAxis dataKey="week_start" tickFormatter={formatShortDate} />
                    <YAxis allowDecimals={false} width={32} />
                    <Tooltip labelFormatter={(d) => formatShortDate(String(d))} />
                    <Legend />
                    <Bar dataKey="created" name={adminCopy.created} fill="#D9A86C" />
                    <Bar dataKey="reviewed" name={adminCopy.reviewed} fill="#2F6F73" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </QueryState>
        </Card>
      </div>
    </div>
  );
}
