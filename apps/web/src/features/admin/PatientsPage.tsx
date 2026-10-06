import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPatient,
  deletePatient,
  exportPatientData,
  fetchAllPatients,
  fetchCaseload,
  fetchTeam,
  inviteUser,
  linkCaregiver,
  setCaseload,
  unlink,
  updatePatient,
} from '@/lib/api/admin';
import { fetchLinks } from '@/lib/api/people';
import { logExport } from '@/lib/audit';
import { downloadText } from '@/lib/csv';
import { qk } from '@/lib/queryKeys';
import { age, formatDate, fullName } from '@/lib/format';
import type { PatientRow } from '@/lib/types';
import { adminCopy } from '@/copy/admin';
import { common } from '@/copy/common';
import { useMe } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { PageHeader, Table, td, th } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Badge';
import { QueryState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';

const addSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  primary_nurse_id: z.string(),
  notes: z.string().max(2000).optional(),
  consent_by: z.string().trim().min(2, adminCopy.patientForm.consentRequired),
  consent_rel: z.string().trim().min(2, adminCopy.patientForm.consentRequired),
  consent_version: z.string().trim().min(1),
  consent_confirmed: z.literal(true, {
    errorMap: () => ({ message: adminCopy.patientForm.consentRequired }),
  }),
});
type AddForm = z.infer<typeof addSchema>;

function AddPatientForm({ onDone }: { onDone: () => void }) {
  const { profile } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const team = useQuery({ queryKey: qk.team(), queryFn: fetchTeam });
  const nurses = (team.data ?? []).filter(
    (p) => (p.role === 'nurse' || p.role === 'agency_admin') && p.is_active,
  );
  const { register, handleSubmit, formState } = useForm<AddForm>({
    resolver: zodResolver(addSchema),
    defaultValues: { primary_nurse_id: '', consent_rel: 'self', consent_version: 'v1-draft' },
  });
  const save = useMutation({
    mutationFn: (v: AddForm) =>
      createPatient({
        organization_id: profile.organization_id,
        first_name: v.first_name,
        last_name: v.last_name,
        date_of_birth: v.date_of_birth,
        primary_nurse_id: v.primary_nurse_id || null,
        notes: v.notes?.trim() || null,
        consent: {
          granted_by_name: v.consent_by,
          granted_by_relationship: v.consent_rel,
          document_version: v.consent_version,
        },
      }),
    onSuccess: () => {
      toast(adminCopy.patientAdded);
      void qc.invalidateQueries({ queryKey: ['adminPatients'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
      onDone();
    },
    onError: () => toast(common.genericError, 'error'),
  });
  const e = formState.errors;
  const f = adminCopy.patientForm;
  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((v) => save.mutate(v))}
      noValidate
      data-testid="add-patient-form"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={f.first}
          {...register('first_name')}
          error={e.first_name ? f.first : undefined}
        />
        <TextField
          label={f.last}
          {...register('last_name')}
          error={e.last_name ? f.last : undefined}
        />
        <TextField
          label={f.dob}
          type="date"
          {...register('date_of_birth')}
          error={e.date_of_birth ? f.dob : undefined}
        />
        <SelectField
          label={f.nurse}
          options={[
            { value: '', label: f.noNurse },
            ...nurses.map((n) => ({ value: n.id, label: n.full_name })),
          ]}
          {...register('primary_nurse_id')}
        />
      </div>
      <TextAreaField label={f.notes} {...register('notes')} />
      <fieldset className="space-y-3 rounded-xl border border-line p-3">
        <legend className="px-1 font-semibold">{f.consentTitle}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={f.consentBy}
            {...register('consent_by')}
            error={e.consent_by?.message}
          />
          <TextField
            label={f.consentRel}
            {...register('consent_rel')}
            error={e.consent_rel?.message}
          />
          <TextField label={f.consentVersion} {...register('consent_version')} />
        </div>
        <CheckboxField label={f.consentConfirm} {...register('consent_confirmed')} />
        {e.consent_confirmed ? (
          <p role="alert" className="text-sm font-semibold text-sevtext-high">
            {e.consent_confirmed.message}
          </p>
        ) : null}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {common.cancel}
        </Button>
        <Button type="submit" busy={save.isPending}>
          {f.save}
        </Button>
      </div>
    </form>
  );
}

function ManagePatient({ patient, onDone }: { patient: PatientRow; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const team = useQuery({ queryKey: qk.team(), queryFn: fetchTeam });
  const caseload = useQuery({
    queryKey: ['caseload', patient.id],
    queryFn: () => fetchCaseload(patient.id),
  });
  const links = useQuery({ queryKey: qk.links(patient.id), queryFn: () => fetchLinks(patient.id) });
  const [selected, setSelected] = useState<string[] | null>(null);
  const [linkId, setLinkId] = useState('');
  const [invite, setInvite] = useState({ email: '', role: 'caregiver' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');
  const nurses = (team.data ?? []).filter((p) => p.role === 'nurse' && p.is_active);
  const caregivers = (team.data ?? []).filter(
    (p) =>
      p.role === 'caregiver' &&
      p.is_active &&
      !(links.data ?? []).some((l) => l.profile_id === p.id),
  );
  const chosen = selected ?? (caseload.data ?? []).map((c) => c.nurse_id);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['adminPatients'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
    void qc.invalidateQueries({ queryKey: ['caseload', patient.id] });
    void qc.invalidateQueries({ queryKey: qk.links(patient.id) });
  };
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      toast(adminCopy.saved);
      refresh();
    },
    onError: () => toast(common.genericError, 'error'),
  });

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="font-bold">{adminCopy.caseload}</h3>
        <p className="text-sm text-ink-muted">{adminCopy.caseloadHint}</p>
        <SelectField
          label={adminCopy.primaryNurse}
          value={patient.primary_nurse_id ?? ''}
          onChange={(e) =>
            run.mutate(() =>
              updatePatient(patient.id, { primary_nurse_id: e.target.value || null }),
            )
          }
          options={[
            { value: '', label: adminCopy.patientForm.noNurse },
            ...nurses.map((n) => ({ value: n.id, label: n.full_name })),
          ]}
        />
        <ul className="grid gap-1 sm:grid-cols-2">
          {nurses.map((n) => (
            <li key={n.id}>
              <CheckboxField
                label={n.full_name}
                checked={chosen.includes(n.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...chosen, n.id] : chosen.filter((x) => x !== n.id),
                  )
                }
              />
            </li>
          ))}
        </ul>
        <Button variant="secondary" onClick={() => run.mutate(() => setCaseload(patient, chosen))}>
          {adminCopy.saveCaseload}
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="font-bold">{adminCopy.caregivers}</h3>
        <ul className="divide-y divide-line">
          {(links.data ?? []).map((l) => (
            <li key={l.id} className="flex items-center justify-between py-1">
              <span>{l.profiles?.full_name}</span>
              <Button variant="ghost" onClick={() => run.mutate(() => unlink(l.id))}>
                {adminCopy.unlink}
              </Button>
            </li>
          ))}
        </ul>
        {caregivers.length ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1">
              <SelectField
                label={adminCopy.linkCaregiver}
                value={linkId}
                onChange={(e) => setLinkId(e.target.value)}
                options={[
                  { value: '', label: '—' },
                  ...caregivers.map((c) => ({ value: c.id, label: c.full_name })),
                ]}
              />
            </div>
            <Button
              variant="secondary"
              disabled={!linkId}
              onClick={() => run.mutate(() => linkCaregiver(patient, linkId))}
            >
              {adminCopy.link}
            </Button>
          </div>
        ) : null}
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_auto]">
          <TextField
            label={adminCopy.inviteCaregiver}
            type="email"
            value={invite.email}
            onChange={(e) => setInvite((i) => ({ ...i, email: e.target.value }))}
          />
          <SelectField
            label={adminCopy.role}
            value={invite.role}
            onChange={(e) => setInvite((i) => ({ ...i, role: e.target.value }))}
            options={[
              { value: 'caregiver', label: adminCopy.inviteRoles.caregiver },
              { value: 'patient', label: adminCopy.inviteRoles.patient },
            ]}
          />
          <Button
            variant="secondary"
            disabled={!/^\S+@\S+\.\S+$/.test(invite.email)}
            onClick={() =>
              void inviteUser({ email: invite.email, role: invite.role, patient_id: patient.id })
                .then(() => {
                  toast(adminCopy.inviteSent);
                  setInvite({ email: '', role: 'caregiver' });
                })
                .catch(() => toast(adminCopy.inviteFailed, 'error'))
            }
          >
            {adminCopy.sendInvite}
          </Button>
        </div>
      </section>

      <section className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await logExport('patient', patient.id, { format: 'json' });
              const data = await exportPatientData(patient.id);
              downloadText(
                `client-export-${patient.id.slice(0, 8)}.json`,
                JSON.stringify(data, null, 2),
                'application/json',
              );
              toast(adminCopy.exported);
            } catch {
              toast(common.genericError, 'error');
            }
          }}
        >
          {adminCopy.exportJson}
        </Button>
        {patient.status === 'active' ? (
          <Button
            variant="secondary"
            onClick={() => run.mutate(() => updatePatient(patient.id, { status: 'discharged' }))}
          >
            {adminCopy.discharge}
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => run.mutate(() => updatePatient(patient.id, { status: 'active' }))}
          >
            {adminCopy.reactivate}
          </Button>
        )}
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          {adminCopy.deleteTitle}
        </Button>
      </section>
      {confirmDelete ? (
        <section
          className="space-y-2 rounded-xl border-2 border-severity-high p-3"
          data-testid="delete-confirm"
        >
          <p className="font-semibold">{adminCopy.deleteBody}</p>
          <TextField
            label={adminCopy.deleteConfirmLabel(adminCopy.deleteWord)}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <Button
            variant="danger"
            disabled={typed !== adminCopy.deleteWord}
            onClick={() =>
              run.mutate(async () => {
                await deletePatient(patient.id);
                onDone();
              })
            }
          >
            {adminCopy.deleteButton}
          </Button>
        </section>
      ) : null}
    </div>
  );
}

export function PatientsPage() {
  const { timezone } = useMe();
  const q = useQuery({ queryKey: ['adminPatients'], queryFn: fetchAllPatients });
  const team = useQuery({ queryKey: qk.team(), queryFn: fetchTeam });
  const [adding, setAdding] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);
  const managing = q.data?.find((p) => p.id === managingId) ?? null;
  const [showDischarged, setShowDischarged] = useState(false);
  const nurseName = (id: string | null) =>
    id ? team.data?.find((t) => t.id === id)?.full_name : undefined;
  return (
    <div className="space-y-4">
      <PageHeader
        title={adminCopy.patientsTitle}
        actions={<Button onClick={() => setAdding(true)}>{adminCopy.addPatient}</Button>}
      />
      <CheckboxField
        label={adminCopy.showDischarged}
        checked={showDischarged}
        onChange={(e) => setShowDischarged(e.target.checked)}
      />
      <QueryState query={q}>
        {(rows) => (
          <Table caption={adminCopy.patientsTitle}>
            <thead>
              <tr>
                <th className={th}>{adminCopy.cols.name}</th>
                <th className={th}>{adminCopy.patientForm.dob}</th>
                <th className={th}>{adminCopy.primaryNurse}</th>
                <th className={th}>{adminCopy.statusCol}</th>
                <th className={th}>
                  <span className="sr-only">{adminCopy.cols.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((p) => showDischarged || p.status === 'active')
                .map((p) => (
                  <tr key={p.id} data-testid="admin-patient-row">
                    <td className={td}>
                      <Link
                        to={`/clinic/patients/${p.id}`}
                        className="font-semibold text-primary underline"
                      >
                        {fullName(p)}
                      </Link>
                    </td>
                    <td className={td}>
                      {formatDate(p.date_of_birth)} ({age(p.date_of_birth, timezone)})
                    </td>
                    <td className={td}>{nurseName(p.primary_nurse_id) ?? '—'}</td>
                    <td className={td}>
                      <Pill tone={p.status === 'active' ? 'good' : 'warn'}>
                        {adminCopy.status[p.status]}
                      </Pill>
                    </td>
                    <td className={td}>
                      <Button variant="ghost" onClick={() => setManagingId(p.id)}>
                        {adminCopy.manage}
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </Table>
        )}
      </QueryState>
      <Modal open={adding} onClose={() => setAdding(false)} title={adminCopy.addPatient}>
        {adding ? <AddPatientForm onDone={() => setAdding(false)} /> : null}
      </Modal>
      <Modal
        open={managing !== null}
        onClose={() => setManagingId(null)}
        title={managing ? adminCopy.manageTitle(fullName(managing)) : ''}
      >
        {managing ? <ManagePatient patient={managing} onDone={() => setManagingId(null)} /> : null}
      </Modal>
    </div>
  );
}
