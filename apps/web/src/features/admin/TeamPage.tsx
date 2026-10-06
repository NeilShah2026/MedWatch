import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role } from '@medwatch/core';
import {
  fetchAllPatients,
  fetchInvitations,
  fetchTeam,
  inviteUser,
  revokeInvitation,
  updateProfile,
} from '@/lib/api/admin';
import { qk } from '@/lib/queryKeys';
import { formatDate, fullName } from '@/lib/format';
import { adminCopy } from '@/copy/admin';
import { navCopy } from '@/copy/nav';
import { common } from '@/copy/common';
import { useMe } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Card, PageHeader, Table, td, th } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Badge';
import { QueryState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';

const ROLES: Role[] = ['nurse', 'agency_admin', 'caregiver', 'patient'];

export function TeamPage() {
  const { profile } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const team = useQuery({ queryKey: qk.team(), queryFn: fetchTeam });
  const invites = useQuery({ queryKey: qk.invitations(), queryFn: fetchInvitations });
  const patients = useQuery({ queryKey: ['adminPatients'], queryFn: fetchAllPatients });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', role: 'nurse', full_name: '', patient_id: '' });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: Parameters<typeof updateProfile>[1] }) =>
      updateProfile(v.id, v.patch),
    onSuccess: () => {
      toast(adminCopy.saved);
      void qc.invalidateQueries({ queryKey: qk.team() });
    },
    onError: () => toast(common.genericError, 'error'),
  });
  const send = useMutation({
    mutationFn: () =>
      inviteUser({
        email: form.email.trim(),
        role: form.role,
        full_name: form.full_name.trim() || undefined,
        patient_id:
          form.role === 'caregiver' || form.role === 'patient' ? form.patient_id : undefined,
      }),
    onSuccess: () => {
      toast(adminCopy.inviteSent);
      setOpen(false);
      setForm({ email: '', role: 'nurse', full_name: '', patient_id: '' });
      void qc.invalidateQueries({ queryKey: qk.invitations() });
    },
    onError: () => toast(adminCopy.inviteFailed, 'error'),
  });
  const needsPatient = form.role === 'caregiver' || form.role === 'patient';
  const valid = /^\S+@\S+\.\S+$/.test(form.email) && (!needsPatient || form.patient_id);

  return (
    <div className="space-y-4">
      <PageHeader
        title={adminCopy.teamTitle}
        actions={<Button onClick={() => setOpen(true)}>{adminCopy.invite}</Button>}
      />
      <QueryState query={team}>
        {(rows) => (
          <Table caption={adminCopy.teamTitle}>
            <thead>
              <tr>
                <th className={th}>{adminCopy.cols.name}</th>
                <th className={th}>{adminCopy.cols.email}</th>
                <th className={th}>{adminCopy.cols.role}</th>
                <th className={th}>{adminCopy.cols.mfa}</th>
                <th className={th}>{adminCopy.cols.active}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const self = p.id === profile.id;
                return (
                  <tr key={p.id} data-testid="team-row">
                    <td className={td}>
                      {p.full_name}{' '}
                      {self ? <span className="text-ink-muted">{adminCopy.you}</span> : null}
                    </td>
                    <td className={td}>{p.email}</td>
                    <td className={td}>
                      <label className="sr-only" htmlFor={`role-${p.id}`}>
                        {adminCopy.role}
                      </label>
                      <select
                        id={`role-${p.id}`}
                        value={p.role}
                        disabled={self}
                        onChange={(e) =>
                          update.mutate({ id: p.id, patch: { role: e.target.value as Role } })
                        }
                        className="min-h-touch rounded-xl border border-line bg-surface px-2"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {navCopy.role[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={td}>
                      {p.role === 'nurse' || p.role === 'agency_admin' ? (
                        <input
                          type="checkbox"
                          aria-label={`${adminCopy.cols.mfa}: ${p.full_name}`}
                          checked={p.mfa_required}
                          onChange={(e) =>
                            update.mutate({ id: p.id, patch: { mfa_required: e.target.checked } })
                          }
                          className="h-6 w-6 accent-primary"
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <Pill tone={p.is_active ? 'good' : 'warn'}>
                          {p.is_active ? adminCopy.activeLabel : adminCopy.inactiveLabel}
                        </Pill>
                        {!self ? (
                          <Button
                            variant="ghost"
                            onClick={() =>
                              update.mutate({ id: p.id, patch: { is_active: !p.is_active } })
                            }
                          >
                            {p.is_active ? adminCopy.deactivate : adminCopy.activate}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </QueryState>
      <Card title={adminCopy.pendingInvites}>
        <QueryState
          query={invites}
          isEmpty={(d) => d.length === 0}
          empty={<p className="text-ink-muted">{adminCopy.noInvites}</p>}
        >
          {(rows) => (
            <ul className="divide-y divide-line" data-testid="invites">
              {rows.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {i.email} · {navCopy.role[i.role]} ·{' '}
                    {adminCopy.expires(formatDate(i.expires_at))}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void revokeInvitation(i.id).then(() =>
                        qc.invalidateQueries({ queryKey: qk.invitations() }),
                      )
                    }
                  >
                    {adminCopy.revokeInvite}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Card>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={adminCopy.inviteTitle}
        footer={
          <Button disabled={!valid} busy={send.isPending} onClick={() => send.mutate()}>
            {adminCopy.sendInvite}
          </Button>
        }
      >
        <TextField
          label={adminCopy.email}
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
        <TextField
          label={adminCopy.fullName}
          value={form.full_name}
          onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
        />
        <SelectField
          label={adminCopy.role}
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          options={ROLES.map((r) => ({ value: r, label: navCopy.role[r] }))}
        />
        {needsPatient ? (
          <SelectField
            label={adminCopy.patientFor}
            value={form.patient_id}
            onChange={(e) => setForm((f) => ({ ...f, patient_id: e.target.value }))}
            options={[
              { value: '', label: '—' },
              ...(patients.data ?? [])
                .filter((p) => p.status === 'active')
                .map((p) => ({ value: p.id, label: fullName(p) })),
            ]}
          />
        ) : null}
      </Modal>
    </div>
  );
}
