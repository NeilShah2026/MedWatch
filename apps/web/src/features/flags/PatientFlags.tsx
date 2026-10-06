import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchFlags } from '@/lib/api/flags';
import { fetchChanges, fetchMedications } from '@/lib/api/meds';
import { fetchStaff } from '@/lib/api/staff';
import { qk } from '@/lib/queryKeys';
import type { FlagRow, PatientRow } from '@/lib/types';
import { flagCopy } from '@/copy/flags';
import { EmptyState, QueryState } from '@/components/ui/States';
import { SelectField } from '@/components/ui/Field';
import { SEVERITY_RANK } from '@medwatch/core';
import { FlagCard } from './FlagCard';

export function usePatientContextMaps(patientId: string) {
  const meds = useQuery({
    queryKey: qk.medications(patientId),
    queryFn: () => fetchMedications(patientId),
  });
  const changes = useQuery({
    queryKey: qk.changes(patientId),
    queryFn: () => fetchChanges(patientId),
  });
  const staff = useQuery({ queryKey: qk.staff(), queryFn: fetchStaff });
  return {
    meds: useMemo(() => new Map((meds.data ?? []).map((m) => [m.id, m])), [meds.data]),
    changes: useMemo(() => new Map((changes.data ?? []).map((c) => [c.id, c])), [changes.data]),
    staffName: (id: string) => staff.data?.find((p) => p.id === id)?.full_name,
  };
}

export function PatientFlags({
  patient,
  readOnly,
  onSelect,
  selectedId,
}: {
  patient: PatientRow;
  readOnly?: boolean;
  onSelect?: (f: FlagRow) => void;
  selectedId?: string | null;
}) {
  const flags = useQuery({ queryKey: qk.flags(patient.id), queryFn: () => fetchFlags(patient.id) });
  const { meds, changes, staffName } = usePatientContextMaps(patient.id);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  return (
    <div className="space-y-3">
      {readOnly ? <p className="text-ink-muted">{flagCopy.readOnlyNote}</p> : null}
      <div className="max-w-xs">
        <SelectField
          label={flagCopy.filterStatus}
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'active' | 'all')}
          options={[
            { value: 'active', label: flagCopy.allOpen },
            { value: 'all', label: flagCopy.all },
          ]}
        />
      </div>
      <QueryState query={flags}>
        {(list) => {
          const shown = list
            .filter((f) => filter === 'all' || f.status === 'open' || f.status === 'acknowledged')
            .sort(
              (a, b) =>
                Number(b.status === 'open') - Number(a.status === 'open') ||
                SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
                b.created_at.localeCompare(a.created_at),
            );
          if (!shown.length)
            return <EmptyState title={flagCopy.noFlags} body={flagCopy.noFlagsBody} />;
          return (
            <ul className="space-y-3">
              {shown.map((f) => (
                <li key={f.id}>
                  <FlagCard
                    flag={f}
                    meds={meds}
                    changes={changes}
                    readOnly={readOnly}
                    reviewerName={staffName}
                    onSelect={onSelect}
                    selected={selectedId === f.id}
                  />
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
    </div>
  );
}
