import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SYMPTOM_CATALOG, addDays, formatShortDate } from '@medwatch/core';
import { fetchLogs } from '@/lib/api/symptoms';
import { qk } from '@/lib/queryKeys';
import { formatDate, todayIn } from '@/lib/format';
import type { PatientRow } from '@/lib/types';
import { nurseCopy } from '@/copy/nurse';
import { checkinCopy } from '@/copy/checkin';
import { useMe } from '@/app/AuthProvider';
import { Card, Table, td, th } from '@/components/ui/Layout';
import { SelectField } from '@/components/ui/Field';
import { EmptyState, QueryState } from '@/components/ui/States';

const label = (c: string) => SYMPTOM_CATALOG.find((s) => s.code === c)?.label ?? c;

export function SymptomsTab({ patient }: { patient: PatientRow }) {
  const { timezone } = useMe();
  const from = addDays(todayIn(timezone), -59);
  const q = useQuery({
    queryKey: qk.symptomLogs(patient.id, from),
    queryFn: () => fetchLogs(patient.id, from),
  });
  const reportedCodes = useMemo(
    () => [
      ...new Set(
        (q.data ?? []).flatMap((l) =>
          l.entries.filter((e) => e.severity > 0).map((e) => e.symptom_code),
        ),
      ),
    ],
    [q.data],
  );
  const [code, setCode] = useState<string>('');
  const selected = code || reportedCodes[0] || '';
  const series = useMemo(
    () =>
      [...(q.data ?? [])]
        .sort((a, b) => a.logged_for_date.localeCompare(b.logged_for_date))
        .map((l) => ({
          date: l.logged_for_date,
          severity: l.entries.find((e) => e.symptom_code === selected)?.severity ?? 0,
        })),
    [q.data, selected],
  );
  return (
    <QueryState
      query={q}
      isEmpty={(d) => d.length === 0}
      empty={<EmptyState title={nurseCopy.noLogs} />}
    >
      {(logs) => (
        <div className="space-y-4">
          {reportedCodes.length ? (
            <Card title={nurseCopy.trendTitle}>
              <div className="max-w-xs">
                <SelectField
                  label={nurseCopy.trendFor}
                  value={selected}
                  onChange={(e) => setCode(e.target.value)}
                  options={reportedCodes.map((c) => ({ value: c, label: label(c) }))}
                />
              </div>
              <div
                className="mt-3 h-48"
                role="img"
                aria-label={`${nurseCopy.trendTitle}: ${label(selected)}`}
              >
                <ResponsiveContainer>
                  <LineChart data={series} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="#E6E1D8" />
                    <XAxis dataKey="date" tickFormatter={formatShortDate} minTickGap={24} />
                    <YAxis domain={[0, 3]} ticks={[0, 1, 2, 3]} width={32} />
                    <Tooltip labelFormatter={(d) => formatShortDate(String(d))} />
                    <Line
                      type="monotone"
                      dataKey="severity"
                      name={label(selected)}
                      stroke="#2F6F73"
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}
          <Card title={nurseCopy.symptomHistory}>
            <Table caption={nurseCopy.symptomHistory}>
              <thead>
                <tr>
                  <th className={th}>{nurseCopy.cols.lastCheckin}</th>
                  <th className={th}>{nurseCopy.feeling}</th>
                  <th className={th}>{nurseCopy.reported}</th>
                  <th className={th}>{nurseCopy.note}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => {
                  const rep = l.entries.filter((e) => e.severity > 0);
                  return (
                    <tr key={l.id} data-testid="symptom-row">
                      <td className={td}>{formatDate(l.logged_for_date)}</td>
                      <td className={td}>
                        {l.overall_feeling ? checkinCopy.feelings[l.overall_feeling - 1] : '—'}
                      </td>
                      <td className={td}>
                        {rep.length
                          ? rep
                              .map(
                                (e) =>
                                  `${label(e.symptom_code)} (${checkinCopy.severity[e.severity - 1]})`,
                              )
                              .join(', ')
                          : checkinCopy.nothingReported}
                      </td>
                      <td className={td}>{l.free_text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </QueryState>
  );
}
