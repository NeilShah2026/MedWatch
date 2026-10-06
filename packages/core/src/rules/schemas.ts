import { z } from 'zod';

export const RULE_STATUS = ['PLACEHOLDER_REQUIRES_CLINICAL_REVIEW', 'CLINICIAN_APPROVED'] as const;

const status = z.enum(RULE_STATUS);
const severity = z.enum(['low', 'medium', 'high']);
const version = z.string().regex(/^\d+\.\d+\.\d+$/, 'must look like 1.0.0');
const code = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be lower_snake_case');
const plainText = z.string().min(3).max(400);

/** Fields every rule carries (spec §7.1). */
const baseRule = z.object({
  id: z.string().regex(/^[a-z]+\.[a-z0-9_]+$/, 'must look like "risk.some_name"'),
  version,
  status,
  description: plainText,
  source_note: plainText,
  severity,
});

export const drugClassesFileSchema = z.object({
  status,
  version,
  description: plainText,
  classes: z.array(z.object({ code, label: z.string().min(2).max(80) }).strict()).min(1),
});

export const medicationRiskRuleSchema = baseRule
  .extend({
    drug_class: code,
    title: z.string().min(3).max(80),
    risk_summary: plainText,
    min_days_active: z.number().int().positive().optional(),
  })
  .strict();

export const medicationRisksFileSchema = z.object({
  status,
  version,
  description: plainText,
  rules: z.array(medicationRiskRuleSchema).min(1),
});

export const interactionRuleSchema = baseRule
  .extend({
    group_a: z.array(code).min(1),
    group_b: z.array(code).min(1),
    title: z.string().min(3).max(80),
    risk_summary: plainText,
  })
  .strict();

export const interactionsFileSchema = z.object({
  status,
  version,
  description: plainText,
  rules: z.array(interactionRuleSchema).min(1),
});

export const sideEffectRuleSchema = baseRule
  .extend({
    drug_class: code,
    symptoms: z
      .array(
        z
          .object({
            symptom_code: code,
            typical_onset_days_min: z.number().int().min(0).max(365),
            typical_onset_days_max: z.number().int().min(0).max(365),
          })
          .strict()
          .refine((s) => s.typical_onset_days_min <= s.typical_onset_days_max, {
            message: 'typical_onset_days_min must be <= typical_onset_days_max',
          }),
      )
      .min(1),
  })
  .strict();

export const sideEffectsFileSchema = z.object({
  status,
  version,
  description: plainText,
  rules: z.array(sideEffectRuleSchema).min(1),
});

export type DrugClassesFile = z.infer<typeof drugClassesFileSchema>;
export type MedicationRiskRule = z.infer<typeof medicationRiskRuleSchema>;
export type InteractionRule = z.infer<typeof interactionRuleSchema>;
export type SideEffectRule = z.infer<typeof sideEffectRuleSchema>;
