import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { SEVERITY_RANK } from '@medwatch/core';
import { fetchInbox } from '@/lib/api/flags';
import { fetchStaff } from '@/lib/api/staff';
import { qk } from '@/lib/queryKeys';
import { fullName } from '@/lib/format';
import { flagCopy } from '@/copy/flags';
import { nurseCopy } from '@/copy/nurse';
import { PageHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState } from '@/components/ui/States';
import { FlagCard } from '@/features/flags/FlagCard';

/** All open flags across the caseload, most severe first, then oldest first. */
export function FlagInboxPage() {
  const q = useQuery({ queryKey: qk.inbox(), queryFn: fetchInbox });
  const staff = useQuery({ queryKey: qk.staff(), queryFn: fetchStaff });
  const staffName = (id: string) => staff.data?.find((s) => s.id === id)?.full_name;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={flagCopy.inboxTitle} subtitle={flagCopy.inboxSubtitle} />
      <QueryState
        query={q}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={nurseCopy.inboxEmpty} />}
      >
        {(rows) => (
          <ul className="space-y-3">
            {[...rows]
              .sort(
                (a, b) =>
                  SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
                  a.created_at.localeCompare(b.created_at),
              )
              .map((f) => (
                <li key={f.id}>
                  <FlagCard
                    flag={f}
                    reviewerName={staffName}
                    patientLabel={
                      f.patients ? (
                        <Link
                          to={`/clinic/patients/${f.patient_id}?tab=flags`}
                          className="ml-auto font-semibold text-primary underline"
                        >
                          {fullName(f.patients)}
                        </Link>
                      ) : null
                    }
                  />
                </li>
              ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
