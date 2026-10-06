import type { SymptomCatalogEntry } from './types.ts';

/**
 * Symptom catalog (reference data, not PHI). Mirrors
 * supabase/migrations/20261006000005_symptom_catalog.sql — a test keeps them in sync.
 * `plain_label` completes the sentence "Have you … today?".
 */
export const SYMPTOM_CATALOG: readonly SymptomCatalogEntry[] = [
  {
    code: 'fall_or_near_fall',
    label: 'Fall or near-fall',
    plain_label: 'fallen or almost fallen',
    help_text: 'A slip, trip, or fall, even if no one was hurt.',
    category: 'safety',
    is_core: true,
    sort_order: 1,
  },
  {
    code: 'confusion',
    label: 'Confusion',
    plain_label: 'felt confused or foggy',
    help_text: 'Mixed up about time or place, or hard to think clearly.',
    category: 'thinking',
    is_core: true,
    sort_order: 2,
  },
  {
    code: 'dizziness',
    label: 'Dizziness',
    plain_label: 'felt dizzy or unsteady',
    help_text: 'Light-headed, spinning, or wobbly when standing or walking.',
    category: 'balance',
    is_core: true,
    sort_order: 3,
  },
  {
    code: 'shortness_of_breath',
    label: 'Shortness of breath',
    plain_label: 'felt short of breath',
    help_text: 'Hard to catch your breath, at rest or when moving.',
    category: 'breathing',
    is_core: true,
    sort_order: 4,
  },
  {
    code: 'drowsiness',
    label: 'Drowsiness',
    plain_label: 'felt very sleepy in the daytime',
    help_text: 'Nodding off or hard to stay awake during the day.',
    category: 'thinking',
    is_core: false,
    sort_order: 5,
  },
  {
    code: 'nausea',
    label: 'Nausea',
    plain_label: 'felt sick to your stomach',
    help_text: 'Queasy, or feeling like you might throw up.',
    category: 'stomach',
    is_core: false,
    sort_order: 6,
  },
  {
    code: 'constipation',
    label: 'Constipation',
    plain_label: 'had trouble with bowel movements',
    help_text: 'Hard stools, or fewer bowel movements than usual.',
    category: 'stomach',
    is_core: false,
    sort_order: 7,
  },
  {
    code: 'diarrhea',
    label: 'Diarrhea',
    plain_label: 'had loose or watery stools',
    help_text: 'Loose stools more than once in a day.',
    category: 'stomach',
    is_core: false,
    sort_order: 8,
  },
  {
    code: 'dry_mouth',
    label: 'Dry mouth',
    plain_label: 'had a very dry mouth',
    help_text: 'Mouth feels dry or sticky, or it is hard to swallow.',
    category: 'mouth',
    is_core: false,
    sort_order: 9,
  },
  {
    code: 'headache',
    label: 'Headache',
    plain_label: 'had a headache',
    help_text: 'Any ache or pressure in the head.',
    category: 'pain',
    is_core: false,
    sort_order: 10,
  },
  {
    code: 'fatigue',
    label: 'Fatigue',
    plain_label: 'felt very tired or weak',
    help_text: 'Less energy than usual for everyday tasks.',
    category: 'energy',
    is_core: false,
    sort_order: 11,
  },
  {
    code: 'low_appetite',
    label: 'Low appetite',
    plain_label: 'felt less hungry than usual',
    help_text: 'Skipping meals or eating much less.',
    category: 'stomach',
    is_core: false,
    sort_order: 12,
  },
  {
    code: 'leg_swelling',
    label: 'Swelling in legs',
    plain_label: 'had swelling in your legs or feet',
    help_text: 'Puffy ankles, feet, or legs, or tight socks or shoes.',
    category: 'heart',
    is_core: false,
    sort_order: 13,
  },
  {
    code: 'cough',
    label: 'Cough',
    plain_label: 'had a cough',
    help_text: 'A new cough or one that is worse than usual.',
    category: 'breathing',
    is_core: false,
    sort_order: 14,
  },
  {
    code: 'rash',
    label: 'Rash',
    plain_label: 'had a new rash or itchy skin',
    help_text: 'Red spots, bumps, or itching that is new.',
    category: 'skin',
    is_core: false,
    sort_order: 15,
  },
  {
    code: 'bruising_or_bleeding',
    label: 'Bruising or bleeding',
    plain_label: 'had new bruises or bleeding',
    help_text: 'Bruises you cannot explain, nosebleeds, or bleeding gums.',
    category: 'skin',
    is_core: false,
    sort_order: 16,
  },
  {
    code: 'muscle_pain',
    label: 'Muscle pain',
    plain_label: 'had muscle aches or pain',
    help_text: 'Sore, achy, or weak muscles.',
    category: 'pain',
    is_core: false,
    sort_order: 17,
  },
  {
    code: 'trouble_sleeping',
    label: 'Trouble sleeping',
    plain_label: 'had trouble sleeping',
    help_text: 'Hard to fall asleep or stay asleep last night.',
    category: 'sleep',
    is_core: false,
    sort_order: 18,
  },
  {
    code: 'low_mood',
    label: 'Low mood',
    plain_label: 'felt sad or down',
    help_text: 'Feeling blue, worried, or not like yourself.',
    category: 'mood',
    is_core: false,
    sort_order: 19,
  },
  {
    code: 'urinary_problems',
    label: 'Urinary problems',
    plain_label: 'had trouble passing urine',
    help_text: 'Hard to start, going often, leaking, or burning.',
    category: 'bladder',
    is_core: false,
    sort_order: 20,
  },
];

export const CORE_SYMPTOM_CODES = SYMPTOM_CATALOG.filter((s) => s.is_core).map((s) => s.code);

export function catalogByCode(
  catalog: readonly SymptomCatalogEntry[] = SYMPTOM_CATALOG,
): Map<string, SymptomCatalogEntry> {
  return new Map(catalog.map((s) => [s.code, s]));
}

export function symptomLabel(
  code: string,
  catalog: readonly SymptomCatalogEntry[] = SYMPTOM_CATALOG,
): string {
  return catalog.find((s) => s.code === code)?.label ?? code.replace(/_/g, ' ');
}

/** The standard wording for a catalog symptom as a yes/no check-in question. */
export function questionFor(entry: SymptomCatalogEntry): string {
  return `Have you ${entry.plain_label} today?`;
}
