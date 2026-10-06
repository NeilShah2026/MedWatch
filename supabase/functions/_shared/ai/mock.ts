import { AiError, type AiProvider, type AiRequest, type AiResponse } from './types.ts';

export type MockMode =
  | 'valid'
  | 'valid_fenced'
  | 'unknown_code'
  | 'duplicates'
  | 'too_few'
  | 'too_many'
  | 'banned_words'
  | 'malformed_json'
  | 'missing_core'
  | 'timeout'
  | 'http_500'
  | 'network';

interface DraftItem {
  symptom_code: string;
  reason_medication_ids?: string[];
}

/** Friendly rewording used by the mock so tailored output is visibly different from rules. */
const FRIENDLY: Record<string, [string, string]> = {
  fall_or_near_fall: [
    'Have you slipped, tripped, or fallen today?',
    'Even a stumble that did not hurt counts.',
  ],
  confusion: [
    'Have you felt mixed up or foggy today?',
    'Like losing track of the day or where you are.',
  ],
  dizziness: [
    'Have you felt dizzy or unsteady today?',
    'Light-headed or wobbly, especially when standing up.',
  ],
  shortness_of_breath: [
    'Has it been hard to catch your breath today?',
    'At rest, or when walking or climbing stairs.',
  ],
};

/**
 * Deterministic test double. In `valid` mode it echoes the rules draft from the prompt
 * (so output is tailored to the patient's medicines) with warmer wording. Other modes
 * reproduce each failure the validator must catch. Records every request it receives.
 */
export class MockAiProvider implements AiProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock-checkin-v1';
  readonly requests: AiRequest[] = [];
  private queue: MockMode[];

  constructor(modes: MockMode | MockMode[] = 'valid') {
    this.queue = Array.isArray(modes) ? [...modes] : [modes];
  }

  async complete(req: AiRequest): Promise<AiResponse> {
    this.requests.push(req);
    const mode = this.queue.length > 1 ? this.queue.shift()! : this.queue[0]!;
    if (mode === 'timeout') throw new AiError('timeout');
    if (mode === 'http_500') throw new AiError('http', 500);
    if (mode === 'network') throw new AiError('network');

    const input = JSON.parse(req.user) as {
      rules_draft: DraftItem[];
      symptom_catalog: { code: string; label: string }[];
    };
    const label = (code: string) =>
      input.symptom_catalog.find((s) => s.code === code)?.label.toLowerCase() ?? code;
    let items = input.rules_draft.map((d) => {
      const [q, h] = FRIENDLY[d.symptom_code] ?? [
        `Have you noticed any ${label(d.symptom_code)} today?`,
        `Tell us if you noticed ${label(d.symptom_code)}.`,
      ];
      return {
        symptom_code: d.symptom_code,
        question_text: q,
        help_text: h,
        reason_medication_ids: d.reason_medication_ids ?? [],
      };
    });
    // pad to at least 6 with other catalog symptoms
    for (const s of input.symptom_catalog) {
      if (items.length >= 6) break;
      if (!items.some((i) => i.symptom_code === s.code)) {
        items.push({
          symptom_code: s.code,
          question_text: `Have you noticed any ${s.label.toLowerCase()} today?`,
          help_text: `Anything that felt like ${s.label.toLowerCase()}.`,
          reason_medication_ids: [],
        });
      }
    }
    items = items.slice(0, 10);

    switch (mode) {
      case 'unknown_code':
        items[items.length - 1] = { ...items[items.length - 1]!, symptom_code: 'hiccups' };
        break;
      case 'duplicates':
        items[items.length - 1] = { ...items[0]! };
        break;
      case 'too_few':
        items = items.slice(0, 3);
        break;
      case 'too_many':
        items = [
          ...items,
          ...input.symptom_catalog
            .filter((s) => !items.some((i) => i.symptom_code === s.code))
            .map((s) => ({
              symptom_code: s.code,
              question_text: 'Have you had this today?',
              help_text: 'Any amount.',
              reason_medication_ids: [],
            })),
        ].slice(0, 12);
        break;
      case 'banned_words':
        items[items.length - 1] = {
          ...items[items.length - 1]!,
          help_text: 'If so, stop taking your medicine.',
        };
        break;
      case 'missing_core':
        items = items.filter((i) => i.symptom_code !== 'shortness_of_breath');
        while (items.length < 6)
          items.push({
            symptom_code: input.symptom_catalog.find(
              (s) => !items.some((i) => i.symptom_code === s.code),
            )!.code,
            question_text: 'Have you felt off today?',
            help_text: 'Any change.',
            reason_medication_ids: [],
          });
        break;
      default:
        break;
    }
    const json = JSON.stringify({ questions: items });
    const text =
      mode === 'malformed_json'
        ? json.slice(0, -5)
        : mode === 'valid_fenced'
          ? '```json\n' + json + '\n```'
          : json;
    return {
      text,
      model: this.model,
      inputTokens: Math.ceil(req.user.length / 4),
      outputTokens: Math.ceil(text.length / 4),
    };
  }
}
