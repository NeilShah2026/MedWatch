import { z } from 'zod';

export const orgSettingsSchema = z.object({
  missed_dose_grace_minutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(60),
  agency_escalation_minutes: z
    .number()
    .int()
    .min(10)
    .max(48 * 60)
    .default(120),
  flag_min_severity_for_alert: z.enum(['low', 'medium', 'high']).default('medium'),
  flag_dedupe_hours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(72),
  session_timeout_minutes: z.number().int().min(2).max(240).default(15),
});

export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export const ORG_SETTINGS_DEFAULTS: OrgSettings = orgSettingsSchema.parse({});

/** Parse stored settings, filling defaults for anything missing or invalid. */
export function resolveOrgSettings(raw: unknown): OrgSettings {
  const base = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...ORG_SETTINGS_DEFAULTS };
  for (const key of Object.keys(ORG_SETTINGS_DEFAULTS) as (keyof OrgSettings)[]) {
    const field = orgSettingsSchema.shape[key];
    const r = field.safeParse(base[key]);
    if (r.success && base[key] !== undefined) out[key] = r.data;
  }
  return out as OrgSettings;
}

export const SEVERITY_RANK = { low: 1, medium: 2, high: 3 } as const;
