import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAllPatients, fetchAudit, fetchTeam, type AuditFilters } from '@/lib/api/admin';
import { logExport, logView } from '@/lib/audit';
import { downloadText, toCsv } from '@/lib/csv';
import { qk } from '@/lib/queryKeys';
import { formatDateTime, fullName } from '@/lib/format';
import { adminCopy } from '@/copy/admin';
import { common } from '@/copy/common';
import { useMe } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Card, PageHeader, Table, td, th } from '@/components/ui/Layout';
import { EmptyState, QueryState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { IconDownload } from '@/components/ui/icons';

const ACTIONS = ['view', 'create', 'update', 'delete', 'export', 'login'] as const;

export function AuditPage() {
  const { timezone } = useMe();
  const toast = useToast();
  const [filters, setFilters] = useState<AuditFilters>({});
  const q = useQuery({
    queryKey: qk.audit(JSON.stringify(filters)),
    queryFn: () => fetchAudit(filters),
  });
  const team = useQuery({ queryKey: qk.team(), queryFn: fetchTeam });
  const patients = useQuery({ queryKey: ['adminPatients'], queryFn: fetchAllPatients });
  useEffect(() => {
    void logView('audit_log', null);
  }, []);
  const who = (id: string | null) =>
    id ? (team.data?.find((t) => t.id === id)?.full_name ?? id.slice(0, 8)) : adminCopy.system;
  const set = (k: keyof AuditFilters) => (v: string) =>
    setFilters((f) => ({ ...f, [k]: v || undefined }));
  const detail = (c: Record<string, unknown> | null) => {
    if (!c) return '';
    if (Array.isArray(c.changed)) return (c.changed as string[]).join(', ');
    return Object.entries(c)
      .filter(([k]) => k !== 'patient_id')
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(', ');
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={adminCopy.auditTitle}
        subtitle={adminCopy.auditSubtitle}
        actions={
          <Button
            variant="secondary"
            disabled={!q.data?.length}
            onClick={async () => {
              try {
                const rows = q.data!.map((r) => ({
                  when: r.created_at,
                  user: who(r.actor_id),
                  action: r.action,
                  entity_type: r.entity_type,
                  entity_id: r.entity_id,
                  detail: detail(r.changes),
                }));
                await logExport('audit_log', null, {
                  format: 'csv',
                  rows: rows.length,
                  from: filters.from,
                  to: filters.to,
                });
                downloadText(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
              } catch {
                toast(common.genericError, 'error');
              }
            }}
          >
            <IconDownload />
            {adminCopy.exportCsv}
          </Button>
        }
      />
      <Card>
        <div className="grid gap-3 md:grid-cols-5">
          <SelectField
            label={adminCopy.filters.user}
            value={filters.actor ?? ''}
            onChange={(e) => set('actor')(e.target.value)}
            options={[
              { value: '', label: adminCopy.filters.any },
              ...(team.data ?? []).map((t) => ({ value: t.id, label: t.full_name })),
            ]}
          />
          <SelectField
            label={adminCopy.filters.patient}
            value={filters.patient ?? ''}
            onChange={(e) => set('patient')(e.target.value)}
            options={[
              { value: '', label: adminCopy.filters.any },
              ...(patients.data ?? []).map((p) => ({ value: p.id, label: fullName(p) })),
            ]}
          />
          <SelectField
            label={adminCopy.filters.action}
            value={filters.action ?? ''}
            onChange={(e) => set('action')(e.target.value)}
            options={[
              { value: '', label: adminCopy.filters.any },
              ...ACTIONS.map((a) => ({ value: a, label: adminCopy.actions[a] })),
            ]}
          />
          <TextField
            label={adminCopy.filters.from}
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => set('from')(e.target.value)}
          />
          <TextField
            label={adminCopy.filters.to}
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => set('to')(e.target.value)}
          />
        </div>
      </Card>
      <QueryState
        query={q}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={adminCopy.noAudit} />}
      >
        {(rows) => (
          <>
            <p className="text-sm text-ink-muted">{adminCopy.showing(rows.length)}</p>
            <Table caption={adminCopy.auditTitle}>
              <thead>
                <tr>
                  <th className={th}>{adminCopy.auditCols.when}</th>
                  <th className={th}>{adminCopy.auditCols.user}</th>
                  <th className={th}>{adminCopy.auditCols.action}</th>
                  <th className={th}>{adminCopy.auditCols.entity}</th>
                  <th className={th}>{adminCopy.auditCols.detail}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid="audit-row" data-action={r.action}>
                    <td className={td}>{formatDateTime(r.created_at, timezone)}</td>
                    <td className={td}>{who(r.actor_id)}</td>
                    <td className={td}>{adminCopy.actions[r.action]}</td>
                    <td className={td}>
                      {r.entity_type}{' '}
                      <span className="font-mono text-xs text-ink-muted">
                        {r.entity_id?.slice(0, 8)}
                      </span>
                    </td>
                    <td className={td}>{detail(r.changes)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </QueryState>
    </div>
  );
}
