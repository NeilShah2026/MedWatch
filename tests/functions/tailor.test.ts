import { describe, expect, it } from 'vitest';
import {
  SYMPTOM_CATALOG,
  getBundledRules,
  type Medication,
} from '../../packages/core/src/index.ts';
import { MockAiProvider, type MockMode } from '../../supabase/functions/_shared/ai/mock.ts';
import { AnthropicGatewayProvider } from '../../supabase/functions/_shared/ai/anthropic.ts';
import { createAiProvider } from '../../supabase/functions/_shared/ai/index.ts';
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/prompts/checkin_v1.ts';
import {
  AI_CALLS_PER_HOUR,
  tailorCheckin,
  type ActiveTemplate,
  type AiRequestMeta,
  type NewTemplate,
  type PatientContext,
  type TailorStore,
} from '../../supabase/functions/_shared/tailor/tailor.ts';
import {
  stripCodeFences,
  validateAiCheckin,
} from '../../supabase/functions/_shared/tailor/validate.ts';

const rules = getBundledRules();
const NOW = new Date('2026-03-20T16:00:00Z');
const PID = 'patient-1';

// Synthetic PHI that must never reach the model.
const SECRET_NAME = 'Zebulon Quartermaine';
const SECRET_DOB = '1941-07-04';
const SECRET_PHONE = '555-0199';
const SECRET_EMAIL = 'zebulon@example.invalid';
const SECRET_NOTE = 'Lives with daughter; gate code 4417';

function med(id: string, o: Partial<Medication>): Medication {
  return {
    id,
    organization_id: 'org-1',
    patient_id: PID,
    name: `Med ${id}`,
    drug_class: 'other',
    schedule_times: ['08:00'],
    prn: false,
    start_date: '2025-01-01',
    status: 'active',
    dose_amount: 5,
    dose_unit: 'mg',
    ...o,
  };
}

class MemoryStore implements TailorStore {
  templates: (NewTemplate & { id: string; status: 'active' | 'superseded' })[] = [];
  aiRequests: (AiRequestMeta & { created_at: string })[] = [];
  ctx: PatientContext & { _secret?: unknown } = {
    patientId: PID,
    organizationId: 'org-1',
    dateOfBirth: SECRET_DOB,
    timezone: 'America/New_York',
    medications: [
      med('m-zol', {
        name: 'Zolpidem',
        generic_name: 'zolpidem',
        drug_class: 'sedative_hypnotic',
        start_date: '2026-03-17',
      }),
      med('m-stat', { name: 'Atorvastatin', generic_name: 'atorvastatin', drug_class: 'statin' }),
      med('m-met', { name: 'Metformin', generic_name: 'metformin', drug_class: 'biguanide' }),
    ],
    changes: [
      {
        id: 'c1',
        patient_id: PID,
        medication_id: 'm-zol',
        change_type: 'started',
        effective_date: '2026-03-17',
      },
    ],
    // Extra fields a careless implementation might forward:
    _secret: { name: SECRET_NAME, phone: SECRET_PHONE, email: SECRET_EMAIL, notes: SECRET_NOTE },
  };
  async loadContext(id: string) {
    return id === PID ? this.ctx : null;
  }
  async getActiveTemplate(id: string): Promise<ActiveTemplate | null> {
    const t = this.templates.find((x) => x.patient_id === id && x.status === 'active');
    return t
      ? { id: t.id, medication_fingerprint: t.medication_fingerprint, source: t.source }
      : null;
  }
  async countAiRequestsSince(id: string, since: string) {
    return this.aiRequests.filter((r) => r.patient_id === id && r.created_at >= since).length;
  }
  async recordAiRequest(meta: AiRequestMeta) {
    this.aiRequests.push({ ...meta, created_at: NOW.toISOString() });
  }
  async saveTemplate(t: NewTemplate) {
    for (const x of this.templates) if (x.patient_id === t.patient_id) x.status = 'superseded';
    const id = `tpl-${this.templates.length + 1}`;
    this.templates.push({ ...t, id, status: 'active' });
    return { id };
  }
  get active() {
    return this.templates.find((t) => t.status === 'active')!;
  }
}

function run(
  mode: MockMode | MockMode[] | null,
  store = new MemoryStore(),
  opts: { force?: boolean } = {},
) {
  const provider = mode === null ? null : new MockAiProvider(mode);
  const p = tailorCheckin(
    PID,
    { store, provider, catalog: SYMPTOM_CATALOG, rules, now: () => NOW },
    opts,
  );
  return { store, provider, p };
}

const CORE = ['fall_or_near_fall', 'confusion', 'dizziness', 'shortness_of_breath'];

describe('tailor-checkin: success path', () => {
  it('valid response → template saved with source "ai", core symptoms first', async () => {
    const { store, p } = run('valid');
    expect(await p).toMatchObject({ status: 'saved', source: 'ai', reason: 'ai_ok' });
    const t = store.active;
    expect(t.source).toBe('ai');
    expect(t.prompt_version).toBe(PROMPT_VERSION);
    expect(t.model).toBe('mock-checkin-v1');
    expect(t.questions.slice(0, 4).map((q) => q.symptom_code)).toEqual(CORE);
    expect(t.questions.length).toBeGreaterThanOrEqual(6);
    expect(t.questions.length).toBeLessThanOrEqual(10);
    // tailored to the sleep medicine
    expect(t.questions.find((q) => q.symptom_code === 'drowsiness')?.reason_medication_ids).toEqual(
      ['m-zol'],
    );
    expect(store.aiRequests).toHaveLength(1);
    expect(store.aiRequests[0]!.status).toBe('success');
  });

  it('JSON wrapped in code fences is accepted', async () => {
    const { store, p } = run('valid_fenced');
    expect(await p).toMatchObject({ source: 'ai' });
    expect(store.active.source).toBe('ai');
  });

  it('missing core symptoms are force-merged', async () => {
    const { store, p } = run('missing_core');
    expect(await p).toMatchObject({ source: 'ai' });
    expect(store.active.questions.map((q) => q.symptom_code)).toEqual(expect.arrayContaining(CORE));
  });

  it('a retry that succeeds still yields an AI template', async () => {
    const { store, p } = run(['http_500', 'valid']);
    expect(await p).toMatchObject({ source: 'ai' });
    expect(store.aiRequests.map((r) => r.status)).toEqual(['error', 'success']);
  });
});

describe('tailor-checkin: every failure falls back to rules', () => {
  const cases: [MockMode, AiRequestMeta['status']][] = [
    ['unknown_code', 'invalid_output'],
    ['duplicates', 'invalid_output'],
    ['too_few', 'invalid_output'],
    ['too_many', 'invalid_output'],
    ['banned_words', 'invalid_output'],
    ['malformed_json', 'invalid_output'],
    ['timeout', 'timeout'],
    ['http_500', 'error'],
    ['network', 'error'],
  ];
  for (const [mode, status] of cases) {
    it(`${mode} → retried once, then rules template; form still renders`, async () => {
      const { store, p, provider } = run(mode);
      expect(await p).toMatchObject({ status: 'saved', source: 'rules', reason: 'ai_failed' });
      expect(provider!.requests).toHaveLength(2);
      expect(store.aiRequests.map((r) => r.status)).toEqual([status, status]);
      const qs = store.active.questions;
      expect(qs.length).toBeGreaterThanOrEqual(4);
      expect(qs.map((q) => q.symptom_code)).toEqual(expect.arrayContaining(CORE));
      expect(store.active.source).toBe('rules');
    });
  }

  it('AI disabled → rules template without any call', async () => {
    const { store, p } = run(null);
    expect(await p).toMatchObject({ source: 'rules', reason: 'ai_disabled' });
    expect(store.aiRequests).toEqual([]);
  });
});

describe('tailor-checkin: idempotency and cost limits', () => {
  it('same medication fingerprint → no new AI call', async () => {
    const first = run('valid');
    await first.p;
    const again = run('valid', first.store);
    expect(await again.p).toMatchObject({ status: 'unchanged' });
    expect(again.provider!.requests).toHaveLength(0);
    expect(first.store.templates).toHaveLength(1);
  });

  it('a medication change regenerates and supersedes the old template', async () => {
    const first = run('valid');
    await first.p;
    first.store.ctx.medications.push(
      med('m-ibu', { name: 'Ibuprofen', drug_class: 'nsaid', start_date: '2026-03-19' }),
    );
    const second = run('valid', first.store);
    expect(await second.p).toMatchObject({ status: 'saved', source: 'ai' });
    expect(first.store.templates.map((t) => t.status)).toEqual(['superseded', 'active']);
    expect(
      first.store.active.questions.some((q) => q.reason_medication_ids.includes('m-ibu')),
    ).toBe(true);
  });

  it('nurse "force" regenerates even when unchanged', async () => {
    const first = run('valid');
    await first.p;
    const forced = run('valid', first.store, { force: true });
    expect(await forced.p).toMatchObject({ status: 'saved', source: 'ai' });
  });

  it(`at most ${AI_CALLS_PER_HOUR} AI calls per patient per hour, then rules`, async () => {
    const store = new MemoryStore();
    await run(['timeout', 'timeout'], store).p; // 2 calls
    const second = run(['timeout', 'valid'], store, { force: true }); // 1 call allowed
    expect(await second.p).toMatchObject({ source: 'rules', reason: 'ai_failed' });
    expect(second.provider!.requests).toHaveLength(1);
    const third = run('valid', store, { force: true });
    expect(await third.p).toMatchObject({ source: 'rules', reason: 'rate_limited' });
    expect(third.provider!.requests).toHaveLength(0);
    expect(store.aiRequests).toHaveLength(3);
  });

  it('unknown patient → not_found', async () => {
    const store = new MemoryStore();
    const r = await tailorCheckin('nobody', {
      store,
      provider: new MockAiProvider(),
      catalog: SYMPTOM_CATALOG,
      rules,
      now: () => NOW,
    });
    expect(r).toEqual({ status: 'not_found' });
  });
});

describe('Hard Rule 9: minimum necessary data to the model', () => {
  it('the captured request contains no name, birthdate, phone, email or notes', async () => {
    const { provider, p } = run('valid');
    await p;
    const req = provider!.requests[0]!;
    const sent = JSON.stringify(req);
    for (const secret of [
      SECRET_NAME,
      SECRET_DOB,
      '1941',
      SECRET_PHONE,
      SECRET_EMAIL,
      SECRET_NOTE,
      'gate code',
    ]) {
      expect(sent).not.toContain(secret);
    }
    const body = JSON.parse(req.user);
    expect(Object.keys(body).sort()).toEqual([
      'age_band',
      'medications',
      'rules_draft',
      'symptom_catalog',
    ]);
    expect(body.age_band).toBe('80–89');
    expect(Object.keys(body.medications[0]).sort()).toEqual([
      'drug_class',
      'drug_class_label',
      'generic_name',
      'id',
      'name',
      'recent_change',
    ]);
    expect(body.medications.find((m: { id: string }) => m.id === 'm-zol').recent_change).toEqual({
      change_type: 'started',
      days_ago: 3,
    });
    expect(req.temperature).toBe(0);
    expect(req.timeoutMs).toBe(15_000);
    expect(req.system).toBe(SYSTEM_PROMPT);
  });

  it('the gateway HTTP body contains only the prompt fields (captured via fetch)', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured.push({ url, init });
      const valid = await new MockAiProvider('valid').complete({
        system: '',
        user: JSON.parse(String(init.body)).messages[0].content,
        temperature: 0,
        maxTokens: 1,
        timeoutMs: 1,
      });
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: valid.text }],
          model: 'claude-sonnet-5-5',
          usage: { input_tokens: 900, output_tokens: 300 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const store = new MemoryStore();
    const provider = new AnthropicGatewayProvider({
      url: 'https://gateway.example.test/',
      apiKey: 'test-key-123',
      authHeader: 'x-api-key',
      fetchImpl: fakeFetch,
    });
    const r = await tailorCheckin(PID, {
      store,
      provider,
      catalog: SYMPTOM_CATALOG,
      rules,
      now: () => NOW,
    });
    expect(r).toMatchObject({ source: 'ai' });
    expect(captured[0]!.url).toBe('https://gateway.example.test/v1/messages');
    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['x-api-key']).toBe('test-key-123');
    const body = JSON.parse(String(captured[0]!.init.body));
    expect(Object.keys(body).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'system',
      'temperature',
    ]);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.temperature).toBe(0);
    for (const secret of [SECRET_NAME, SECRET_DOB, SECRET_PHONE, SECRET_EMAIL, SECRET_NOTE])
      expect(String(captured[0]!.init.body)).not.toContain(secret);
    expect(store.aiRequests[0]).toMatchObject({
      input_tokens: 900,
      output_tokens: 300,
      status: 'success',
    });
  });

  it('ai_requests rows contain metadata only — no prompt or response text', async () => {
    const { store, p } = run(['malformed_json', 'valid']);
    await p;
    for (const row of store.aiRequests) {
      const { created_at: _c, ...meta } = row;
      expect(Object.keys(meta).sort()).toEqual([
        'input_tokens',
        'latency_ms',
        'model',
        'organization_id',
        'output_tokens',
        'patient_id',
        'purpose',
        'status',
      ]);
      for (const v of Object.values(meta))
        if (typeof v === 'string') expect(v.length).toBeLessThan(64);
      expect(JSON.stringify(row)).not.toMatch(/Have you|question_text|symptom_catalog|Zolpidem/);
    }
  });
});

describe('gateway provider error mapping', () => {
  const req = { system: 's', user: 'u', temperature: 0, maxTokens: 10, timeoutMs: 50 };
  it('HTTP errors, empty content and network errors', async () => {
    const mk = (f: () => Promise<Response>) =>
      new AnthropicGatewayProvider({
        url: 'https://g.test',
        apiKey: 'k',
        fetchImpl: f as unknown as typeof fetch,
      });
    await expect(
      mk(async () => new Response('nope', { status: 500 })).complete(req),
    ).rejects.toMatchObject({ kind: 'http', httpStatus: 500 });
    await expect(
      mk(async () => new Response(JSON.stringify({ content: [] }), { status: 200 })).complete(req),
    ).rejects.toMatchObject({ kind: 'bad_response' });
    await expect(
      mk(async () => new Response('not json', { status: 200 })).complete(req),
    ).rejects.toMatchObject({ kind: 'bad_response' });
    await expect(
      mk(async () => Promise.reject(new TypeError('fetch failed'))).complete(req),
    ).rejects.toMatchObject({ kind: 'network' });
  });
  it('times out with AbortController', async () => {
    const slow = ((_: string, init: RequestInit) =>
      new Promise((_r, reject) =>
        init.signal!.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        ),
      )) as unknown as typeof fetch;
    const p = new AnthropicGatewayProvider({ url: 'https://g.test', apiKey: 'k', fetchImpl: slow });
    await expect(p.complete(req)).rejects.toMatchObject({ kind: 'timeout' });
  });
  it('createAiProvider honours AI_ENABLED and AI_PROVIDER', () => {
    expect(createAiProvider({ AI_ENABLED: 'false', AI_PROVIDER: 'mock' })).toBeNull();
    expect(createAiProvider({ AI_ENABLED: 'true', AI_PROVIDER: 'mock' })?.name).toBe('mock');
    expect(createAiProvider({ AI_ENABLED: 'true', AI_PROVIDER: 'gateway' })).toBeNull();
    const g = createAiProvider({
      AI_ENABLED: 'true',
      AI_PROVIDER: 'gateway',
      AI_GATEWAY_URL: 'https://g.test',
      AI_GATEWAY_API_KEY: 'k',
    });
    expect(g?.name).toBe('gateway');
    expect(g?.model).toBe('claude-sonnet-5-5');
  });
});

describe('validator details', () => {
  const ids = ['m1'];
  const q = (code: string, text = 'Have you felt this today?') => ({
    symptom_code: code,
    question_text: text,
    help_text: 'Any amount.',
    reason_medication_ids: ['m1', 'unknown'],
  });
  const six = ['nausea', 'headache', 'rash', 'cough', 'fatigue', 'low_mood'];
  it('drops unknown medication ids and enforces question shape', () => {
    const ok = validateAiCheckin(
      JSON.stringify({ questions: six.map((c) => q(c)) }),
      SYMPTOM_CATALOG,
      ids,
    );
    expect(
      ok.ok && ok.questions.find((x) => x.symptom_code === 'nausea')!.reason_medication_ids,
    ).toEqual(['m1']);
    const notQuestion = validateAiCheckin(
      JSON.stringify({ questions: six.map((c) => q(c, 'Tell us about it.')) }),
      SYMPTOM_CATALOG,
      ids,
    );
    expect(notQuestion).toEqual({ ok: false, reason: 'length' });
    const long = validateAiCheckin(
      JSON.stringify({
        questions: six.map((c) => q(c, `Have you ${'really '.repeat(20)}felt this?`)),
      }),
      SYMPTOM_CATALOG,
      ids,
    );
    expect(long).toEqual({ ok: false, reason: 'length' });
    expect(validateAiCheckin('{"items": []}', SYMPTOM_CATALOG, ids)).toEqual({
      ok: false,
      reason: 'bad_shape',
    });
  });
  it('strips fences', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFences('```\n{"a":1}```')).toBe('{"a":1}');
    expect(stripCodeFences(' {"a":1} ')).toBe('{"a":1}');
  });
});
