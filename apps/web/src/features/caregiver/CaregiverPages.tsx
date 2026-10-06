import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchOverview } from '@/lib/api/patients';
import { qk } from '@/lib/queryKeys';
import { fullName } from '@/lib/format';
import { caregiverCopy } from '@/copy/caregiver';
import { PageHeader } from '@/components/ui/Layout';
import { Pill } from '@/components/ui/Badge';
import { EmptyState, Loading, QueryState, ErrorState } from '@/components/ui/States';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { IconChevronRight } from '@/components/ui/icons';
import { ForbiddenPage } from '@/app/ErrorPages';
import { usePatient } from '@/features/patients/hooks';
import { TodayDoses } from '@/features/doses/TodayDoses';
import { CheckinFlow } from '@/features/symptoms/CheckinFlow';
import { MedicineList } from '@/features/meds/MedicineList';
import { PatientFlags } from '@/features/flags/PatientFlags';
import { LatestSummary } from '@/features/summary/LatestSummary';

export function PeoplePage() {
  const q = useQuery({ queryKey: qk.overview('mine'), queryFn: fetchOverview });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={caregiverCopy.peopleTitle} subtitle={caregiverCopy.peopleSubtitle} />
      <QueryState
        query={q}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={caregiverCopy.none} body={caregiverCopy.noneBody} />}
      >
        {(rows) => (
          <ul className="space-y-3">
            {rows.map((r) => {
              const flags = r.open_high + r.open_medium + r.open_low;
              return (
                <li key={r.patient_id}>
                  <Link
                    to={`/care/${r.patient_id}`}
                    className="card flex items-center gap-4 hover:border-primary"
                    data-testid="person-card"
                  >
                    <div className="flex-1 space-y-1">
                      <p className="text-xl font-bold">{fullName(r)}</p>
                      <p>{caregiverCopy.dosesToday(r.doses_today_done, r.doses_today_total)}</p>
                      <div className="flex flex-wrap gap-2">
                        <Pill tone={r.checkin_today ? 'good' : 'warn'}>
                          {r.checkin_today
                            ? caregiverCopy.checkinDone
                            : caregiverCopy.checkinNotDone}
                        </Pill>
                        <Pill tone={flags ? 'info' : 'neutral'}>
                          {flags ? caregiverCopy.openFlags(flags) : caregiverCopy.noFlags}
                        </Pill>
                      </div>
                    </div>
                    <span className="sr-only">{caregiverCopy.open}</span>
                    <IconChevronRight />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

type TabKey = 'today' | 'checkin' | 'medicines' | 'flags' | 'summary';

export function CarePatientPage() {
  const { patientId } = useParams();
  const [params, setParams] = useSearchParams();
  const q = usePatient(patientId);
  const [tab, setTabState] = useState<TabKey>((params.get('tab') as TabKey) ?? 'today');
  const setTab = (t: TabKey) => {
    setTabState(t);
    setParams({ tab: t }, { replace: true });
  };
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data) return <ForbiddenPage />;
  const p = q.data;
  const tabs = (Object.keys(caregiverCopy.tabs) as TabKey[]).map((k) => ({
    key: k,
    label: caregiverCopy.tabs[k],
  }));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={fullName(p)} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} label={fullName(p)} />
      <TabPanel id={tab}>
        {tab === 'today' ? <TodayDoses patient={p} mode="caregiver" /> : null}
        {tab === 'checkin' ? <CheckinFlow patient={p} mode="caregiver" /> : null}
        {tab === 'medicines' ? <MedicineList patient={p} /> : null}
        {tab === 'flags' ? <PatientFlags patient={p} readOnly /> : null}
        {tab === 'summary' ? <LatestSummary patient={p} /> : null}
      </TabPanel>
    </div>
  );
}
