import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchOverview } from '@/lib/api/patients';
import { fetchStaff } from '@/lib/api/staff';
import { qk } from '@/lib/queryKeys';
import { age, formatDate, formatPercent, fullName, todayIn } from '@/lib/format';
import type { PatientOverviewRow } from '@/lib/types';
import { nurseCopy } from '@/copy/nurse';
import { useMe } from '@/app/AuthProvider';
import { PageHeader, Table, td, th } from '@/components/ui/Layout';
import { SeverityBadge } from '@/components/ui/Badge';
import { EmptyState, QueryState } from '@/components/ui/States';

type SortKey = 'flags' | 'adherence' | 'lastCheckin' | 'lastVisit' | 'name';

const flagScore = (r: PatientOverviewRow) => r.open_high * 10000 + r.open_medium * 100 + r.open_low;

function sortRows(rows: PatientOverviewRow[], key: SortKey, dir: 1 | -1) {
  const v = (r: PatientOverviewRow): number | string => {
    switch (key) {
      case 'flags':
        return flagScore(r);
      case 'adherence':
        return r.adherence_7d ?? 2;
      case 'lastCheckin':
        return r.last_checkin ?? '';
      case 'lastVisit':
        return r.last_visit_at ?? '';
      case 'name':
        return `${r.last_name} ${r.first_name}`;
    }
  };
  return [...rows].sort((a, b) => {
    const x = v(a);
    const y = v(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.last_name.localeCompare(b.last_name);
  });
}

export function CaseloadPage() {
  const { profile, timezone } = useMe();
  const today = todayIn(timezone);
  const isAdmin = profile.role === 'agency_admin';
  const q = useQuery({ queryKey: qk.overview('caseload'), queryFn: fetchOverview });
  const staff = useQuery({ queryKey: qk.staff(), queryFn: fetchStaff, enabled: isAdmin });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'flags', dir: -1 });
  const nurseName = useMemo(
    () => new Map((staff.data ?? []).map((s) => [s.id, s.full_name])),
    [staff.data],
  );

  const header = (key: SortKey, label: string) => {
    const active = sort.key === key;
    return (
      <th
        className={th}
        aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      >
        <button
          type="button"
          className="min-h-touch font-semibold underline-offset-2 hover:underline"
          aria-label={nurseCopy.sortBy(label)}
          onClick={() =>
            setSort((s) => ({
              key,
              dir: s.key === key ? ((s.dir * -1) as 1 | -1) : key === 'name' ? 1 : -1,
            }))
          }
        >
          {label} {active ? (sort.dir === 1 ? '▲' : '▼') : ''}
        </button>
      </th>
    );
  };

  return (
    <div>
      <PageHeader
        title={isAdmin ? nurseCopy.allClientsTitle : nurseCopy.caseloadTitle}
        subtitle={nurseCopy.caseloadSubtitle}
      />
      <QueryState
        query={q}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={nurseCopy.noPatients} />}
      >
        {(rows) => (
          <Table caption={nurseCopy.caseloadTitle}>
            <thead>
              <tr>
                {header('name', nurseCopy.cols.name)}
                <th className={th}>{nurseCopy.cols.age}</th>
                {header('flags', nurseCopy.cols.flags)}
                {header('adherence', nurseCopy.cols.adherence)}
                {header('lastCheckin', nurseCopy.cols.lastCheckin)}
                {header('lastVisit', nurseCopy.cols.lastVisit)}
                {isAdmin ? <th className={th}>{nurseCopy.cols.nurse}</th> : null}
              </tr>
            </thead>
            <tbody>
              {sortRows(rows, sort.key, sort.dir).map((r) => {
                const high = r.open_high > 0;
                return (
                  <tr
                    key={r.patient_id}
                    className={high ? 'bg-[#FCF3F1]' : ''}
                    data-testid="caseload-row"
                    data-high={high || undefined}
                  >
                    <td className={`${td} ${high ? 'border-l-4 border-l-severity-high' : ''}`}>
                      <Link
                        to={`/clinic/patients/${r.patient_id}`}
                        className="font-semibold text-primary underline"
                      >
                        {fullName(r)}
                      </Link>
                      {high ? <span className="sr-only"> — {nurseCopy.highFlagRow}</span> : null}
                    </td>
                    <td className={td}>{age(r.date_of_birth, timezone)}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {r.open_high ? (
                          <SeverityBadge severity="high" />
                        ) : r.open_medium ? (
                          <SeverityBadge severity="medium" />
                        ) : r.open_low ? (
                          <SeverityBadge severity="low" />
                        ) : null}
                        <span className="text-sm">
                          {nurseCopy.flagCounts(r.open_high, r.open_medium, r.open_low) ||
                            nurseCopy.noFlags}
                        </span>
                      </div>
                    </td>
                    <td className={td}>
                      {formatPercent(r.adherence_7d)}{' '}
                      <span className="text-sm text-ink-muted">
                        ({r.given_7d}/{r.total_7d})
                      </span>
                    </td>
                    <td className={td}>
                      {r.last_checkin
                        ? r.last_checkin === today
                          ? nurseCopy.today
                          : formatDate(r.last_checkin)
                        : nurseCopy.never}
                    </td>
                    <td className={td}>
                      {r.last_visit_at ? formatDate(r.last_visit_at) : nurseCopy.never}
                    </td>
                    {isAdmin ? (
                      <td className={td}>
                        {(r.primary_nurse_id && nurseName.get(r.primary_nurse_id)) || '—'}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </QueryState>
    </div>
  );
}
