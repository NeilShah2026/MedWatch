#!/usr/bin/env -S npx tsx
/**
 * Manual check that the real AI gateway works (NOT part of CI): sends one synthetic
 * medication list through AnthropicGatewayProvider, validates the answer exactly as
 * tailor-checkin does, and prints the questions plus call metadata.
 *   AI_ENABLED=true AI_PROVIDER=gateway npm run ai:smoke
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SYMPTOM_CATALOG,
  buildRulesCheckin,
  getBundledRules,
  type Medication,
} from '../packages/core/src/index.ts';
import { AnthropicGatewayProvider } from '../supabase/functions/_shared/ai/anthropic.ts';
import { AiError } from '../supabase/functions/_shared/ai/types.ts';
import {
  SYSTEM_PROMPT,
  buildCheckinPrompt,
} from '../supabase/functions/_shared/prompts/checkin_v1.ts';
import { buildPromptInput } from '../supabase/functions/_shared/tailor/tailor.ts';
import { validateAiCheckin } from '../supabase/functions/_shared/tailor/validate.ts';

const out = (s: string) => process.stdout.write(`${s}\n`);
const env: Record<string, string | undefined> = { ...process.env };
const file = resolve(import.meta.dirname, '../.env.functions');
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]!]) env[m[1]!] = m[2];
  }
}
if (!env.AI_GATEWAY_URL || !env.AI_GATEWAY_API_KEY) {
  out(
    'ai:smoke needs AI_GATEWAY_URL and AI_GATEWAY_API_KEY (in the environment or .env.functions).',
  );
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const meds: Medication[] = [
  {
    id: 'smoke-1',
    organization_id: 'o',
    patient_id: 'p',
    name: 'Zolpidem',
    generic_name: 'zolpidem',
    drug_class: 'sedative_hypnotic',
    schedule_times: ['21:00'],
    prn: false,
    start_date: today,
    status: 'active',
  },
  {
    id: 'smoke-2',
    organization_id: 'o',
    patient_id: 'p',
    name: 'Amlodipine',
    generic_name: 'amlodipine',
    drug_class: 'calcium_channel_blocker',
    schedule_times: ['08:00'],
    prn: false,
    start_date: '2024-01-01',
    status: 'active',
  },
  {
    id: 'smoke-3',
    organization_id: 'o',
    patient_id: 'p',
    name: 'Metformin',
    generic_name: 'metformin',
    drug_class: 'biguanide',
    schedule_times: ['08:00', '18:00'],
    prn: false,
    start_date: '2023-01-01',
    status: 'active',
  },
];
const rules = getBundledRules();
const draft = buildRulesCheckin(meds, SYMPTOM_CATALOG, rules, today);
const input = buildPromptInput(
  {
    patientId: 'p',
    organizationId: 'o',
    dateOfBirth: '1944-01-01',
    timezone: 'UTC',
    medications: meds,
    changes: [
      {
        id: 'c',
        patient_id: 'p',
        medication_id: 'smoke-1',
        change_type: 'started',
        effective_date: today,
      },
    ],
  },
  draft,
  { catalog: SYMPTOM_CATALOG, rules },
  today,
);
const provider = new AnthropicGatewayProvider({
  url: env.AI_GATEWAY_URL,
  apiKey: env.AI_GATEWAY_API_KEY,
  authHeader: env.AI_GATEWAY_AUTH_HEADER,
  model: env.AI_MODEL,
});
const started = Date.now();
try {
  const res = await provider.complete({
    system: SYSTEM_PROMPT,
    user: buildCheckinPrompt(input),
    temperature: 0,
    maxTokens: 1500,
    timeoutMs: 15_000,
  });
  out(
    `model=${res.model} latency_ms=${Date.now() - started} input_tokens=${res.inputTokens} output_tokens=${res.outputTokens}`,
  );
  const v = validateAiCheckin(
    res.text,
    SYMPTOM_CATALOG,
    meds.map((m) => m.id),
  );
  if (!v.ok) {
    out(`INVALID OUTPUT: ${v.reason} (the app would fall back to the rules template)`);
    process.exit(2);
  }
  out('VALID. Questions:');
  for (const q of v.questions)
    out(
      `  ${q.is_core ? '[core] ' : '       '}${q.question_text}  (${q.symptom_code}; because of: ${q.reason_medication_ids.join(', ') || '—'})`,
    );
} catch (e) {
  out(`CALL FAILED: ${e instanceof AiError ? e.message : 'unexpected error'}`);
  process.exit(3);
}
