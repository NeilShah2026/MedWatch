/**
 * Prompt for the tailored daily check-in (spec §7.5). The model only chooses and words
 * questions from the existing symptom catalog. It never sees names, birthdates, contact
 * details, notes or symptom answers (Hard Rules 8 and 9).
 *
 * Changing this text requires bumping PROMPT_VERSION and clinician sign-off (see README).
 */
export const PROMPT_VERSION = 'checkin_v1';

export const SYSTEM_PROMPT = `You help build a short daily check-in for an older adult who receives home health care.

You will receive JSON with:
- "medications": the person's active medicines (id, name, generic name, drug class) and whether each was started or changed in the last 14 days,
- "age_band": an age range,
- "symptom_catalog": the ONLY symptom codes you may use, with labels,
- "rules_draft": a baseline list of relevant symptom codes built from rules.

Your task:
1. Choose between 6 and 10 symptoms, using ONLY codes from "symptom_catalog". Never invent a code.
2. Prioritize symptoms linked to medicines that were recently started or changed.
3. For each symptom, write one yes/no question in plain, warm language at about a 5th-grade reading level, under 12 words, for example: "Have you felt dizzy or unsteady today?"
4. Add a short "help_text" with an everyday example of what counts.
5. List in "reason_medication_ids" the ids of the medicines that make the question relevant (may be empty).

Strict rules:
- Never mention a diagnosis or name a condition the person might have.
- Never say or suggest that a medicine causes anything.
- Never give advice or instructions about medicines, doses, or treatment.
- Respond with JSON only. No prose, no markdown, no code fences.

Respond with exactly this shape:
{"questions":[{"symptom_code":"string","question_text":"string","help_text":"string","reason_medication_ids":["string"]}]}`;

export interface PromptMedication {
  id: string;
  name: string;
  generic_name: string | null;
  drug_class: string | null;
  drug_class_label: string;
  recent_change: null | { change_type: string; days_ago: number };
}

export interface CheckinPromptInput {
  medications: PromptMedication[];
  age_band: string;
  symptom_catalog: { code: string; label: string }[];
  rules_draft: { symptom_code: string; reason_medication_ids: string[] }[];
}

/** The complete user message. Only the fields above are ever sent. */
export function buildCheckinPrompt(input: CheckinPromptInput): string {
  const payload: CheckinPromptInput = {
    medications: input.medications.map((m) => ({
      id: m.id,
      name: m.name,
      generic_name: m.generic_name,
      drug_class: m.drug_class,
      drug_class_label: m.drug_class_label,
      recent_change: m.recent_change,
    })),
    age_band: input.age_band,
    symptom_catalog: input.symptom_catalog.map((s) => ({ code: s.code, label: s.label })),
    rules_draft: input.rules_draft.map((d) => ({
      symptom_code: d.symptom_code,
      reason_medication_ids: d.reason_medication_ids,
    })),
  };
  return JSON.stringify(payload);
}
