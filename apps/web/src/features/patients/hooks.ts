import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { fetchPatient, fetchSelfPatient } from '@/lib/api/patients';
import { qk } from '@/lib/queryKeys';
import { logView } from '@/lib/audit';

/** Load a patient (null = no access under RLS) and record the view in the audit log. */
export function usePatient(id: string | undefined) {
  const q = useQuery({
    queryKey: qk.patient(id ?? 'none'),
    queryFn: () => fetchPatient(id!),
    enabled: Boolean(id),
  });
  const loadedId = q.data?.id;
  useEffect(() => {
    if (loadedId) void logView('patient', loadedId);
  }, [loadedId]);
  return q;
}

export function useSelfPatient(userId: string) {
  return useQuery({ queryKey: ['selfPatient', userId], queryFn: () => fetchSelfPatient(userId) });
}
