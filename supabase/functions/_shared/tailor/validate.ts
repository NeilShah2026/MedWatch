import { z } from 'zod';
import {
  CHECKIN_MAX_QUESTIONS,
  findBannedPhrases,
  mergeCoreQuestions,
  type CheckinQuestion,
  type SymptomCatalogEntry,
} from '../../../../packages/core/src/index.ts';

export const AI_MIN_QUESTIONS = 6;
export const QUESTION_MAX_WORDS = 15;
export const QUESTION_MAX_CHARS = 120;
export const HELP_MAX_CHARS = 160;

export type ValidationFailure =
  | 'malformed_json'
  | 'bad_shape'
  | 'unknown_code'
  | 'duplicate_code'
  | 'count'
  | 'length'
  | 'banned_words';

export type ValidationResult =
  | { ok: true; questions: CheckinQuestion[] }
  | { ok: false; reason: ValidationFailure };

const itemSchema = z.object({
  symptom_code: z.string(),
  question_text: z.string(),
  help_text: z.string().default(''),
  reason_medication_ids: z.array(z.string()).default([]),
});
const responseSchema = z.object({ questions: z.array(itemSchema) });

/** Remove stray markdown code fences (```json … ```) around a JSON payload. */
export function stripCodeFences(text: string): string {
  const t = text.trim();
  const fenced = t.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?\s*```$/);
  return (fenced ? fenced[1]! : t).trim();
}

/**
 * Validate the model's output (spec §7.5): JSON only, catalog codes only, 6–10 unique
 * items, length limits, banned wording, then force-merge the core symptoms.
 */
export function validateAiCheckin(
  text: string,
  catalog: readonly SymptomCatalogEntry[],
  medicationIds: readonly string[],
): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripCodeFences(text));
  } catch {
    return { ok: false, reason: 'malformed_json' };
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'bad_shape' };
  const items = parsed.data.questions;
  if (items.length < AI_MIN_QUESTIONS || items.length > CHECKIN_MAX_QUESTIONS)
    return { ok: false, reason: 'count' };

  const codes = new Set(catalog.map((c) => c.code));
  const seen = new Set<string>();
  const known = new Set(medicationIds);
  const out: CheckinQuestion[] = [];
  for (const it of items) {
    const q = it.question_text.trim();
    const h = it.help_text.trim();
    if (!codes.has(it.symptom_code)) return { ok: false, reason: 'unknown_code' };
    if (seen.has(it.symptom_code)) return { ok: false, reason: 'duplicate_code' };
    seen.add(it.symptom_code);
    const words = q.split(/\s+/).filter(Boolean).length;
    if (
      !q ||
      q.length > QUESTION_MAX_CHARS ||
      words > QUESTION_MAX_WORDS ||
      !q.endsWith('?') ||
      h.length > HELP_MAX_CHARS
    ) {
      return { ok: false, reason: 'length' };
    }
    if (findBannedPhrases(q).length || findBannedPhrases(h).length)
      return { ok: false, reason: 'banned_words' };
    out.push({
      symptom_code: it.symptom_code,
      question_text: q,
      help_text: h,
      // Unknown ids are dropped (not a safety issue, just noise).
      reason_medication_ids: [
        ...new Set(it.reason_medication_ids.filter((id) => known.has(id))),
      ].sort(),
      is_core: catalog.find((c) => c.code === it.symptom_code)!.is_core,
    });
  }
  return { ok: true, questions: mergeCoreQuestions(out, catalog) };
}
