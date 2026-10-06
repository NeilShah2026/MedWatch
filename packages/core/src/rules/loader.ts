import type { ZodError, ZodTypeAny } from 'zod';
import { SYMPTOM_CATALOG } from '../catalog.ts';
import { findBannedPhrases } from '../wording.ts';
import {
  drugClassesFileSchema,
  interactionsFileSchema,
  medicationRisksFileSchema,
  sideEffectsFileSchema,
  type InteractionRule,
  type MedicationRiskRule,
  type SideEffectRule,
} from './schemas.ts';

export interface RawRuleFiles {
  drugClasses: unknown;
  medicationRisks: unknown;
  interactions: unknown;
  sideEffects: unknown;
}

export interface RuleSet {
  drugClasses: { code: string; label: string }[];
  medicationRisks: MedicationRiskRule[];
  interactions: InteractionRule[];
  sideEffects: SideEffectRule[];
  /** drug_class → side-effect rule */
  sideEffectsByClass: Map<string, SideEffectRule>;
  /** true while any file is still a placeholder awaiting clinician review */
  isPlaceholder: boolean;
}

export class RuleValidationError extends Error {
  constructor(
    public readonly file: string,
    public readonly problems: string[],
  ) {
    super(`Invalid rule file ${file}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'RuleValidationError';
  }
}

const FILES = {
  drugClasses: 'rules/drug_classes.json',
  medicationRisks: 'rules/medication_risks.json',
  interactions: 'rules/interactions.json',
  sideEffects: 'rules/side_effect_associations.json',
} as const;

function formatZod(error: ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
}

function parse<S extends ZodTypeAny>(schema: S, file: string, raw: unknown) {
  const r = schema.safeParse(raw);
  if (!r.success) throw new RuleValidationError(file, formatZod(r.error));
  return r.data as ReturnType<S['parse']>;
}

/**
 * Validate the clinical rule files (already parsed from JSON) and build a RuleSet.
 * Pure: no I/O. Throws RuleValidationError with a readable list of problems.
 */
export function loadRules(raw: RawRuleFiles, catalog = SYMPTOM_CATALOG): RuleSet {
  const dc = parse(drugClassesFileSchema, FILES.drugClasses, raw.drugClasses);
  const mr = parse(medicationRisksFileSchema, FILES.medicationRisks, raw.medicationRisks);
  const ix = parse(interactionsFileSchema, FILES.interactions, raw.interactions);
  const se = parse(sideEffectsFileSchema, FILES.sideEffects, raw.sideEffects);

  const classes = new Set(dc.classes.map((c) => c.code));
  const symptoms = new Set(catalog.map((s) => s.code));

  const check = (file: string, problems: string[]) => {
    if (problems.length) throw new RuleValidationError(file, problems);
  };

  const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);

  check(
    FILES.drugClasses,
    dupes(dc.classes.map((c) => c.code)).map((c) => `duplicate class code "${c}"`),
  );

  check(FILES.medicationRisks, [
    ...dupes(mr.rules.map((r) => r.id)).map((id) => `duplicate rule id "${id}"`),
    ...mr.rules
      .filter((r) => !classes.has(r.drug_class))
      .map((r) => `${r.id}: unknown drug_class "${r.drug_class}"`),
    ...mr.rules.flatMap((r) =>
      findBannedPhrases(`${r.title} ${r.risk_summary}`).map(
        (p) => `${r.id}: contains banned phrase "${p}"`,
      ),
    ),
  ]);

  check(FILES.interactions, [
    ...dupes(ix.rules.map((r) => r.id)).map((id) => `duplicate rule id "${id}"`),
    ...ix.rules.flatMap((r) =>
      [...r.group_a, ...r.group_b]
        .filter((c) => !classes.has(c))
        .map((c) => `${r.id}: unknown drug_class "${c}"`),
    ),
    ...ix.rules.flatMap((r) =>
      findBannedPhrases(`${r.title} ${r.risk_summary}`).map(
        (p) => `${r.id}: contains banned phrase "${p}"`,
      ),
    ),
  ]);

  check(FILES.sideEffects, [
    ...dupes(se.rules.map((r) => r.id)).map((id) => `duplicate rule id "${id}"`),
    ...dupes(se.rules.map((r) => r.drug_class)).map(
      (c) => `drug_class "${c}" appears in more than one rule`,
    ),
    ...se.rules
      .filter((r) => !classes.has(r.drug_class))
      .map((r) => `${r.id}: unknown drug_class "${r.drug_class}"`),
    ...se.rules.flatMap((r) =>
      r.symptoms
        .filter((s) => !symptoms.has(s.symptom_code))
        .map((s) => `${r.id}: unknown symptom_code "${s.symptom_code}"`),
    ),
  ]);

  const statuses = [dc.status, mr.status, ix.status, se.status, ...mr.rules.map((r) => r.status)];
  return {
    drugClasses: dc.classes,
    medicationRisks: mr.rules,
    interactions: ix.rules,
    sideEffects: se.rules,
    sideEffectsByClass: new Map(se.rules.map((r) => [r.drug_class, r])),
    isPlaceholder: statuses.some((s) => s !== 'CLINICIAN_APPROVED'),
  };
}

export function drugClassLabel(rules: RuleSet, code: string | null | undefined): string {
  if (!code) return '';
  return rules.drugClasses.find((c) => c.code === code)?.label ?? code.replace(/_/g, ' ');
}
