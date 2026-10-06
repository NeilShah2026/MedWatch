import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { orgSettingsSchema, type OrgSettings } from '@medwatch/core';
import { saveOrgSettings } from '@/lib/api/admin';
import { adminCopy } from '@/copy/admin';
import { flagCopy } from '@/copy/flags';
import { common } from '@/copy/common';
import { useAuth, useMe } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Card, PageHeader } from '@/components/ui/Layout';
import { useToast } from '@/components/ui/Toast';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];
const NUMERIC = [
  'missed_dose_grace_minutes',
  'agency_escalation_minutes',
  'flag_dedupe_hours',
  'session_timeout_minutes',
] as const;

export function SettingsPage() {
  const { settings, timezone, org } = useMe();
  const { refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<Record<string, string>>({
    ...Object.fromEntries(NUMERIC.map((k) => [k, String(settings[k])])),
    flag_min_severity_for_alert: settings.flag_min_severity_for_alert,
    timezone,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async () => {
      const parsed = orgSettingsSchema.safeParse({
        ...Object.fromEntries(NUMERIC.map((k) => [k, Number(form[k])])),
        flag_min_severity_for_alert: form.flag_min_severity_for_alert,
      });
      if (!parsed.success) {
        setErrors(
          Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
        );
        throw new Error('invalid');
      }
      setErrors({});
      await saveOrgSettings(org!.id, parsed.data as OrgSettings, form.timezone!);
      await refresh();
    },
    onSuccess: () => toast(adminCopy.settingsSaved),
    onError: () => toast(common.genericError, 'error'),
  });
  const f = adminCopy.settingsFields;
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title={adminCopy.settingsTitle} />
      <Card>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          data-testid="settings-form"
        >
          <SelectField
            label={adminCopy.timezone}
            value={form.timezone}
            onChange={(e) => setForm((x) => ({ ...x, timezone: e.target.value }))}
            options={TIMEZONES.map((t) => ({ value: t, label: t }))}
          />
          {NUMERIC.map((k) => (
            <TextField
              key={k}
              type="number"
              inputMode="numeric"
              label={f[k].label}
              hint={f[k].help}
              value={form[k]}
              error={errors[k]}
              onChange={(e) => setForm((x) => ({ ...x, [k]: e.target.value }))}
            />
          ))}
          <SelectField
            label={f.flag_min_severity_for_alert.label}
            hint={f.flag_min_severity_for_alert.help}
            value={form.flag_min_severity_for_alert}
            onChange={(e) =>
              setForm((x) => ({ ...x, flag_min_severity_for_alert: e.target.value }))
            }
            options={(['low', 'medium', 'high'] as const).map((s) => ({
              value: s,
              label: flagCopy.severity[s],
            }))}
          />
          <Button type="submit" busy={save.isPending}>
            {common.save}
          </Button>
        </form>
      </Card>
    </div>
  );
}
