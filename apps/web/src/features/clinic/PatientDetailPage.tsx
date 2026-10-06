import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isMedicationActiveOn } from '@medwatch/core';
import { fetchOverview } from '@/lib/api/patients';
import { fetchMedications } from '@/lib/api/meds';
import { fetchStaff } from '@/lib/api/staff';
import { qk } from '@/lib/queryKeys';
import { age, formatDate, formatPercent, fullName, todayIn } from '@/lib/format';
import type { FlagRow } from '@/lib/types';
import { nurseCopy } from '@/copy/nurse';
import { useMe } from '@/app/AuthProvider';
import { ForbiddenPage } from '@/app/ErrorPages';
import { PageHeader, StatCard } from '@/components/ui/Layout';
import { Pill } from '@/components/ui/Badge';
import { ErrorState, Loading } from '@/components/ui/States';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { usePatient } from '@/features/patients/hooks';
import { PatientFlags } from '@/features/flags/PatientFlags';
import { TimelineChart } from './TimelineChart';
import { MedicationsTab } from './MedicationsTab';
import { DosesTab } from './DosesTab';
import { SymptomsTab } from './SymptomsTab';
import { SummaryTab } from './SummaryTab';
import { PeopleTab } from './PeopleTab';

type TabKey = keyof typeof nurseCopy.tabs;

export function PatientDetailPage() {
  const { patientId } = useParams();
  const [params, setParams] = useSearchParams();
  const { timezone } = useMe();
  const today = todayIn(timezone);
  const q = usePatient(patientId);
  const overview = useQuery({ queryKey: qk.overview('caseload'), queryFn: fetchOverview });
  const meds = useQuery({
    queryKey: qk.medications(patientId ?? ''),
    queryFn: () => fetchMedications(patientId!),
    enabled: Boolean(q.data),
  });
  const staff = useQuery({ queryKey: qk.staff(), queryFn: fetchStaff });
  const [tab, setTabState] = useState<TabKey>(
    (params.get('tab') as TabKey) in nurseCopy.tabs ? (params.get('tab') as TabKey) : 'overview',
  );
  const [highlight, setHighlight] = useState<string | null>(null);
  const setTab = (t: TabKey) => {
    setTabState(t);
    setParams({ tab: t }, { replace: true });
  };

  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data) return <ForbiddenPage />;
  const p = q.data;
  const row = overview.data?.find((r) => r.patient_id === p.id);
  const nurse = staff.data?.find((s) => s.id === p.primary_nurse_id);
  const activeMeds = (meds.data ?? []).filter((m) => isMedicationActiveOn(m, today)).length;
  const openFlags = row ? row.open_high + row.open_medium + row.open_low : 0;
  const tabs = (Object.keys(nurseCopy.tabs) as TabKey[]).map((k) => ({
    key: k,
    label: nurseCopy.tabs[k],
  }));

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {fullName(p)}
            {p.status === 'discharged' ? (
              <Pill tone="warn">{nurseCopy.header.discharged}</Pill>
            ) : null}
          </span>
        }
        subtitle={`${nurseCopy.header.age(age(p.date_of_birth, timezone))} · ${nurse ? nurseCopy.header.primaryNurse(nurse.full_name) : nurseCopy.header.noNurse}`}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={nurseCopy.header.activeMeds} value={activeMeds} />
        <StatCard
          label={nurseCopy.header.openFlags}
          value={openFlags}
          hint={
            row ? nurseCopy.flagCounts(row.open_high, row.open_medium, row.open_low) : undefined
          }
        />
        <StatCard
          label={nurseCopy.header.adherence}
          value={formatPercent(row?.adherence_7d)}
          hint={row ? `${row.given_7d}/${row.total_7d}` : undefined}
        />
        <StatCard
          label={nurseCopy.header.lastCheckin}
          value={row?.last_checkin ? formatDate(row.last_checkin) : nurseCopy.never}
        />
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} label={fullName(p)} />
      <TabPanel id={tab}>
        {tab === 'overview' ? (
          <TimelineChart patient={p} highlightFlagId={highlight} onHighlight={setHighlight} />
        ) : null}
        {tab === 'medications' ? <MedicationsTab patient={p} /> : null}
        {tab === 'flags' ? (
          <PatientFlags
            patient={p}
            selectedId={highlight}
            onSelect={(f: FlagRow) => {
              setHighlight(f.id);
              setTab('overview');
            }}
          />
        ) : null}
        {tab === 'doses' ? <DosesTab patient={p} /> : null}
        {tab === 'symptoms' ? <SymptomsTab patient={p} /> : null}
        {tab === 'summary' ? <SummaryTab patient={p} /> : null}
        {tab === 'people' ? <PeopleTab patient={p} /> : null}
      </TabPanel>
    </div>
  );
}
