import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addConsent, fetchConsents, fetchLinks, revokeConsent } from '@/lib/api/people';
import { qk } from '@/lib/queryKeys';
import { formatDate } from '@/lib/format';
import type { ConsentRow, PatientRow } from '@/lib/types';
import { nurseCopy } from '@/copy/nurse';
import { common } from '@/copy/common';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Card } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Badge';
import { QueryState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';

export function PeopleTab({ patient }: { patient: PatientRow }) {
  const qc = useQueryClient();
  const toast = useToast();
  const links = useQuery({ queryKey: qk.links(patient.id), queryFn: () => fetchLinks(patient.id) });
  const consents = useQuery({
    queryKey: qk.consents(patient.id),
    queryFn: () => fetchConsents(patient.id),
  });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    consent_type: 'data_use' as ConsentRow['consent_type'],
    granted_by_name: '',
    granted_by_relationship: 'self',
    document_version: 'v1-draft',
  });
  const add = useMutation({
    mutationFn: () =>
      addConsent({ ...form, organization_id: patient.organization_id, patient_id: patient.id }),
    onSuccess: () => {
      toast(nurseCopy.consentSaved);
      setAdding(false);
      void qc.invalidateQueries({ queryKey: qk.consents(patient.id) });
    },
    onError: () => toast(common.genericError, 'error'),
  });
  const revoke = useMutation({
    mutationFn: revokeConsent,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.consents(patient.id) }),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={nurseCopy.caregivers}>
        <QueryState
          query={links}
          isEmpty={(d) => d.length === 0}
          empty={<p className="text-ink-muted">{nurseCopy.noCaregivers}</p>}
        >
          {(rows) => (
            <ul className="divide-y divide-line">
              {rows.map((l) => (
                <li key={l.id} className="py-2">
                  <p className="font-semibold">{l.profiles?.full_name}</p>
                  <p className="text-sm text-ink-muted">
                    {l.relationship === 'self'
                      ? nurseCopy.relationshipSelf
                      : nurseCopy.relationshipCaregiver}
                    {l.profiles?.phone ? ` · ${l.profiles.phone}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Card>
      <Card
        title={nurseCopy.consents}
        actions={<Button onClick={() => setAdding(true)}>{nurseCopy.addConsent}</Button>}
      >
        <QueryState
          query={consents}
          isEmpty={(d) => d.length === 0}
          empty={<p className="text-ink-muted">{nurseCopy.noConsents}</p>}
        >
          {(rows) => (
            <ul className="divide-y divide-line">
              {rows.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                  data-testid="consent-row"
                >
                  <div>
                    <p className="font-semibold">{nurseCopy.consentTypes[c.consent_type]}</p>
                    <p className="text-sm text-ink-muted">
                      {`${c.granted_by_name} (${c.granted_by_relationship}) · ${formatDate(c.granted_at)} · ${c.document_version}`}
                    </p>
                  </div>
                  {c.revoked_at ? (
                    <Pill tone="warn">{nurseCopy.revoked(formatDate(c.revoked_at))}</Pill>
                  ) : (
                    <Button variant="ghost" onClick={() => revoke.mutate(c.id)}>
                      {nurseCopy.revoke}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Card>
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title={nurseCopy.addConsent}
        footer={
          <Button
            busy={add.isPending}
            disabled={!form.granted_by_name.trim()}
            onClick={() => add.mutate()}
          >
            {common.save}
          </Button>
        }
      >
        <SelectField
          label={nurseCopy.consentForm.type}
          value={form.consent_type}
          onChange={(e) =>
            setForm((f) => ({ ...f, consent_type: e.target.value as ConsentRow['consent_type'] }))
          }
          options={(Object.keys(nurseCopy.consentTypes) as ConsentRow['consent_type'][]).map(
            (k) => ({ value: k, label: nurseCopy.consentTypes[k] }),
          )}
        />
        <TextField
          label={nurseCopy.consentForm.grantedBy}
          value={form.granted_by_name}
          onChange={(e) => setForm((f) => ({ ...f, granted_by_name: e.target.value }))}
        />
        <TextField
          label={nurseCopy.consentForm.relationship}
          value={form.granted_by_relationship}
          onChange={(e) => setForm((f) => ({ ...f, granted_by_relationship: e.target.value }))}
        />
        <TextField
          label={nurseCopy.consentForm.version}
          value={form.document_version}
          onChange={(e) => setForm((f) => ({ ...f, document_version: e.target.value }))}
        />
      </Modal>
    </div>
  );
}
