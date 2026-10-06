import type { CheckinQuestion, Medication, SymptomCatalogEntry } from './types.ts';
import type { RuleSet } from './rules/loader.ts';
import { questionFor } from './catalog.ts';
import { isMedicationActiveOn } from './medications.ts';

export const CHECKIN_MAX_QUESTIONS = 10;

/**
 * Rules-based tailored check-in (spec §7.5, builder 1). Deterministic.
 * Core symptoms first (always present), then symptoms linked to the active medicines'
 * drug classes, ranked by how many medicines point at them; capped at 10 questions.
 */
export function buildRulesCheckin(
  medications: readonly Medication[],
  catalog: readonly SymptomCatalogEntry[],
  rules: RuleSet,
  onDate: string,
  max = CHECKIN_MAX_QUESTIONS,
): CheckinQuestion[] {
  const active = medications
    .filter((m) => isMedicationActiveOn(m, onDate))
    .sort((a, b) => a.id.localeCompare(b.id));
  const reasons = new Map<string, Set<string>>();
  for (const m of active) {
    const rule = m.drug_class ? rules.sideEffectsByClass.get(m.drug_class) : undefined;
    for (const s of rule?.symptoms ?? []) {
      const set = reasons.get(s.symptom_code) ?? new Set<string>();
      set.add(m.id);
      reasons.set(s.symptom_code, set);
    }
  }
  const sorted = [...catalog].sort(
    (a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code),
  );
  const toQuestion = (entry: SymptomCatalogEntry): CheckinQuestion => ({
    symptom_code: entry.code,
    question_text: questionFor(entry),
    help_text: entry.help_text,
    reason_medication_ids: [...(reasons.get(entry.code) ?? [])].sort(),
    is_core: entry.is_core,
  });

  const core = sorted.filter((e) => e.is_core).map(toQuestion);
  const tailored = sorted
    .filter((e) => !e.is_core && (reasons.get(e.code)?.size ?? 0) > 0)
    .sort(
      (a, b) =>
        (reasons.get(b.code)?.size ?? 0) - (reasons.get(a.code)?.size ?? 0) ||
        a.sort_order - b.sort_order,
    )
    .map(toQuestion);
  return [...core, ...tailored].slice(0, Math.max(max, core.length));
}

/**
 * Ensure every core symptom is present (used after AI output), keeping core questions first
 * in catalog order and preserving the order of the rest. Caps at `max` without ever dropping core.
 */
export function mergeCoreQuestions(
  questions: readonly CheckinQuestion[],
  catalog: readonly SymptomCatalogEntry[],
  max = CHECKIN_MAX_QUESTIONS,
): CheckinQuestion[] {
  const byCode = new Map(questions.map((q) => [q.symptom_code, q]));
  const core = [...catalog]
    .filter((e) => e.is_core)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(
      (e): CheckinQuestion => ({
        ...(byCode.get(e.code) ?? {
          symptom_code: e.code,
          question_text: questionFor(e),
          help_text: e.help_text,
          reason_medication_ids: [],
        }),
        is_core: true,
      }),
    );
  const coreCodes = new Set(core.map((q) => q.symptom_code));
  const rest = questions
    .filter((q) => !coreCodes.has(q.symptom_code))
    .map((q) => ({ ...q, is_core: false }));
  return [...core, ...rest].slice(0, Math.max(max, core.length));
}

/** Order for display: core questions first, then tailored ones (spec §7.5 UI). */
export function orderForDisplay(questions: readonly CheckinQuestion[]): CheckinQuestion[] {
  return [...questions.filter((q) => q.is_core), ...questions.filter((q) => !q.is_core)];
}
