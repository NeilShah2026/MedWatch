/**
 * Tailored check-in orchestration (spec §7.5, §8 `tailor-checkin`). Pure apart from the
 * injected store and provider, so every path is unit-tested with MockAiProvider.
 *
 * Guarantees:
 * - The patient always ends up with a valid template: any AI failure falls back to rules.
 * - Same medication fingerprint → no new AI call (unless a nurse forces regeneration).
 * - At most AI_CALLS_PER_HOUR AI calls per patient per hour.
 * - Only medicine names/classes/recent changes, an age band, the catalog and the rules
 *   draft are sent to the model. ai_requests stores metadata only.
 */
import {
  ageBand,
  buildRulesCheckin,
  daysBetween,
  drugClassLabel,
  isMedicationActiveOn,
  localDate,
  medicationFingerprint,
  type CheckinQuestion,
  type Medication,
  type MedicationChange,
  type RuleSet,
  type SymptomCatalogEntry,
} from '../../../../packages/core/src/index.ts';
import { AiError, type AiProvider } from '../ai/types.ts';
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildCheckinPrompt,
  type CheckinPromptInput,
} from '../prompts/checkin_v1.ts';
import { validateAiCheckin } from './validate.ts';

export const AI_CALLS_PER_HOUR = 3;
export const AI_TIMEOUT_MS = 15_000;
export const AI_MAX_ATTEMPTS = 2; // one retry

export interface PatientContext {
  patientId: string;
  organizationId: string;
  dateOfBirth: string;
  timezone: string;
  medications: Medication[];
  changes: MedicationChange[];
}

export interface ActiveTemplate {
  id: string;
  medication_fingerprint: string;
  source: 'ai' | 'rules' | 'default';
}

export interface AiRequestMeta {
  organization_id: string;
  patient_id: string;
  purpose: 'checkin_template';
  model: string;
  status: 'success' | 'invalid_output' | 'error' | 'timeout';
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface NewTemplate {
  organization_id: string;
  patient_id: string;
  medication_fingerprint: string;
  source: 'ai' | 'rules';
  questions: CheckinQuestion[];
  model: string | null;
  prompt_version: string | null;
}

export interface TailorStore {
  loadContext(patientId: string): Promise<PatientContext | null>;
  getActiveTemplate(patientId: string): Promise<ActiveTemplate | null>;
  countAiRequestsSince(patientId: string, sinceIso: string): Promise<number>;
  recordAiRequest(meta: AiRequestMeta): Promise<void>;
  /** Atomically supersede the active template and insert this one. */
  saveTemplate(t: NewTemplate): Promise<{ id: string }>;
}

export interface TailorDeps {
  store: TailorStore;
  provider: AiProvider | null;
  catalog: readonly SymptomCatalogEntry[];
  rules: RuleSet;
  now?: () => Date;
  clock?: () => number;
}

export type TailorOutcome =
  | { status: 'unchanged'; templateId: string }
  | {
      status: 'saved';
      templateId: string;
      source: 'ai' | 'rules';
      reason: 'ai_ok' | 'ai_disabled' | 'ai_failed' | 'rate_limited';
    }
  | { status: 'not_found' };

export function buildPromptInput(
  ctx: PatientContext,
  draft: CheckinQuestion[],
  deps: Pick<TailorDeps, 'catalog' | 'rules'>,
  today: string,
): CheckinPromptInput {
  const recent = new Map<string, { change_type: string; days_ago: number }>();
  for (const c of [...ctx.changes].sort((a, b) =>
    a.effective_date.localeCompare(b.effective_date),
  )) {
    const days = daysBetween(c.effective_date, today);
    if (days >= 0 && days <= 14)
      recent.set(c.medication_id, { change_type: c.change_type, days_ago: days });
  }
  return {
    medications: ctx.medications
      .filter((m) => isMedicationActiveOn(m, today))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        generic_name: m.generic_name ?? null,
        drug_class: m.drug_class ?? null,
        drug_class_label: drugClassLabel(deps.rules, m.drug_class),
        recent_change: recent.get(m.id) ?? null,
      })),
    age_band: ageBand(ctx.dateOfBirth, today),
    symptom_catalog: deps.catalog.map((c) => ({ code: c.code, label: c.label })),
    rules_draft: draft.map((q) => ({
      symptom_code: q.symptom_code,
      reason_medication_ids: q.reason_medication_ids,
    })),
  };
}

export async function tailorCheckin(
  patientId: string,
  deps: TailorDeps,
  opts: { force?: boolean } = {},
): Promise<TailorOutcome> {
  const now = deps.now?.() ?? new Date();
  const clock = deps.clock ?? (() => Date.now());
  const ctx = await deps.store.loadContext(patientId);
  if (!ctx) return { status: 'not_found' };

  const today = localDate(now, ctx.timezone);
  const fingerprint = medicationFingerprint(ctx.medications, today);
  const active = await deps.store.getActiveTemplate(patientId);
  if (active && active.medication_fingerprint === fingerprint && !opts.force) {
    return { status: 'unchanged', templateId: active.id };
  }

  const draft = buildRulesCheckin(ctx.medications, deps.catalog, deps.rules, today);
  const saveRules = async (
    reason: 'ai_disabled' | 'ai_failed' | 'rate_limited',
  ): Promise<TailorOutcome> => {
    const t = await deps.store.saveTemplate({
      organization_id: ctx.organizationId,
      patient_id: patientId,
      medication_fingerprint: fingerprint,
      source: 'rules',
      questions: draft,
      model: null,
      prompt_version: null,
    });
    return { status: 'saved', templateId: t.id, source: 'rules', reason };
  };

  if (!deps.provider) return saveRules('ai_disabled');

  const since = new Date(now.getTime() - 60 * 60_000).toISOString();
  let used = await deps.store.countAiRequestsSince(patientId, since);
  if (used >= AI_CALLS_PER_HOUR) return saveRules('rate_limited');

  const promptInput = buildPromptInput(ctx, draft, deps, today);
  const user = buildCheckinPrompt(promptInput);
  const medIds = promptInput.medications.map((m) => m.id);

  for (let attempt = 1; attempt <= AI_MAX_ATTEMPTS && used < AI_CALLS_PER_HOUR; attempt++) {
    used++;
    const started = clock();
    let status: AiRequestMeta['status'];
    let tokens: { in: number | null; out: number | null } = { in: null, out: null };
    let questions: CheckinQuestion[] | null = null;
    let model = deps.provider.model;
    try {
      const res = await deps.provider.complete({
        system: SYSTEM_PROMPT,
        user,
        temperature: 0,
        maxTokens: 1500,
        timeoutMs: AI_TIMEOUT_MS,
      });
      tokens = { in: res.inputTokens, out: res.outputTokens };
      model = res.model;
      const v = validateAiCheckin(res.text, deps.catalog, medIds);
      if (v.ok) {
        status = 'success';
        questions = v.questions;
      } else {
        status = 'invalid_output';
      }
    } catch (e) {
      status = e instanceof AiError && e.kind === 'timeout' ? 'timeout' : 'error';
    }
    await deps.store.recordAiRequest({
      organization_id: ctx.organizationId,
      patient_id: patientId,
      purpose: 'checkin_template',
      model,
      status,
      latency_ms: Math.max(0, Math.round(clock() - started)),
      input_tokens: tokens.in,
      output_tokens: tokens.out,
    });
    if (questions) {
      const t = await deps.store.saveTemplate({
        organization_id: ctx.organizationId,
        patient_id: patientId,
        medication_fingerprint: fingerprint,
        source: 'ai',
        questions,
        model,
        prompt_version: PROMPT_VERSION,
      });
      return { status: 'saved', templateId: t.id, source: 'ai', reason: 'ai_ok' };
    }
  }
  return saveRules('ai_failed');
}
