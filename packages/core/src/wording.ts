/**
 * Hard Rule 2: MedWatch never diagnoses or recommends treatment.
 * These patterns must never appear in user-facing text. Matching is case-insensitive
 * and on word boundaries, so identifiers such as a "prescriber" field are not caught,
 * while the verbs themselves are.
 */
export const BANNED_PHRASES: readonly { phrase: string; pattern: RegExp }[] = [
  { phrase: 'diagnose', pattern: /\bdiagnos(e|es|ed|ing)\b/i },
  { phrase: 'diagnosis', pattern: /\bdiagnos(is|es)\b/i },
  { phrase: 'stop taking', pattern: /\bstop\s+taking\b/i },
  { phrase: 'reduce dose', pattern: /\breduce\s+(the\s+|your\s+|this\s+)?dose\b/i },
  { phrase: 'increase dose', pattern: /\bincrease\s+(the\s+|your\s+|this\s+)?dose\b/i },
  { phrase: 'you have', pattern: /\byou\s+have\b/i },
  { phrase: 'you should take', pattern: /\byou\s+should\s+take\b/i },
  { phrase: 'prescribe', pattern: /\bprescribes?\b/i },
];

/**
 * Exact disclaimers required by the spec that negate a banned word.
 * Removed before matching; nothing else is exempt.
 */
export const ALLOWED_DISCLAIMERS: readonly string[] = ['Not a diagnosis.'];

export function findBannedPhrases(text: string): string[] {
  let t = text;
  for (const d of ALLOWED_DISCLAIMERS) t = t.split(d).join(' ');
  return BANNED_PHRASES.filter((b) => b.pattern.test(t)).map((b) => b.phrase);
}

export function passesWordingCheck(text: string): boolean {
  return findBannedPhrases(text).length === 0;
}

export const CLINICIAN_REVIEW_SUFFIX = 'For clinician review.';
