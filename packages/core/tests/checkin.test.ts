import { describe, expect, it } from 'vitest';
import { buildRulesCheckin, mergeCoreQuestions, orderForDisplay } from '../src/checkin.ts';
import { CORE_SYMPTOM_CODES, SYMPTOM_CATALOG } from '../src/catalog.ts';
import { findBannedPhrases } from '../src/wording.ts';
import { med, rules } from './fixtures.ts';

const ON = '2026-03-20';
const codes = (qs: { symptom_code: string }[]) => qs.map((q) => q.symptom_code);

describe('buildRulesCheckin', () => {
  it('always includes the four core symptoms first', () => {
    const qs = buildRulesCheckin([], SYMPTOM_CATALOG, rules, ON);
    expect(codes(qs)).toEqual([
      'fall_or_near_fall',
      'confusion',
      'dizziness',
      'shortness_of_breath',
    ]);
    expect(qs.every((q) => q.is_core)).toBe(true);
  });

  it('adds symptoms linked to each drug class, with the medicines that point to them', () => {
    const qs = buildRulesCheckin(
      [med('s', { drug_class: 'statin' }), med('b', { drug_class: 'biguanide' })],
      SYMPTOM_CATALOG,
      rules,
      ON,
    );
    expect(codes(qs).slice(4)).toEqual(['nausea', 'diarrhea', 'low_appetite', 'muscle_pain']);
    expect(qs.find((q) => q.symptom_code === 'muscle_pain')!.reason_medication_ids).toEqual(['s']);
    expect(qs.find((q) => q.symptom_code === 'nausea')!.is_core).toBe(false);
  });

  it('ranks by number of medicines pointing to a symptom', () => {
    const qs = buildRulesCheckin(
      [
        med('o', { drug_class: 'opioid' }),
        med('t', { drug_class: 'tricyclic_antidepressant' }),
        med('a', { drug_class: 'anticholinergic' }),
      ],
      SYMPTOM_CATALOG,
      rules,
      ON,
    );
    // constipation is linked by all three
    expect(codes(qs)[4]).toBe('constipation');
    expect(qs[4]!.reason_medication_ids).toEqual(['a', 'o', 't']);
    // core dizziness records its reasons too
    expect(qs.find((q) => q.symptom_code === 'dizziness')!.reason_medication_ids).toEqual([
      'o',
      't',
    ]);
  });

  it('caps at 10 questions', () => {
    const many = [
      'opioid',
      'nsaid',
      'ssri',
      'biguanide',
      'statin',
      'calcium_channel_blocker',
      'beta_blocker',
      'anticholinergic',
    ].map((c, i) => med(`m${i}`, { drug_class: c }));
    const qs = buildRulesCheckin(many, SYMPTOM_CATALOG, rules, ON);
    expect(qs).toHaveLength(10);
    for (const c of CORE_SYMPTOM_CODES) expect(codes(qs)).toContain(c);
  });

  it('ignores inactive medicines and unknown classes', () => {
    const qs = buildRulesCheckin(
      [
        med('x', { drug_class: 'statin', status: 'stopped' }),
        med('y', { drug_class: null }),
        med('z', { drug_class: 'not_a_class' }),
      ],
      SYMPTOM_CATALOG,
      rules,
      ON,
    );
    expect(qs).toHaveLength(4);
  });

  it('is deterministic regardless of input order', () => {
    const meds = [
      med('a', { drug_class: 'opioid' }),
      med('b', { drug_class: 'ssri' }),
      med('c', { drug_class: 'statin' }),
    ];
    expect(buildRulesCheckin([...meds].reverse(), SYMPTOM_CATALOG, rules, ON)).toEqual(
      buildRulesCheckin(meds, SYMPTOM_CATALOG, rules, ON),
    );
  });

  it('uses plain, short, allowed wording', () => {
    for (const q of buildRulesCheckin(
      [med('a', { drug_class: 'opioid' })],
      SYMPTOM_CATALOG,
      rules,
      ON,
    )) {
      expect(q.question_text).toMatch(/^Have you .+ today\?$/);
      expect(q.question_text.split(/\s+/).length).toBeLessThan(12);
      expect(findBannedPhrases(`${q.question_text} ${q.help_text}`)).toEqual([]);
    }
  });
});

describe('mergeCoreQuestions / orderForDisplay', () => {
  it('adds missing core questions first and keeps AI order for the rest', () => {
    const merged = mergeCoreQuestions(
      [
        {
          symptom_code: 'nausea',
          question_text: 'Q1',
          help_text: 'h',
          reason_medication_ids: ['m'],
          is_core: false,
        },
        {
          symptom_code: 'dizziness',
          question_text: 'Have you felt wobbly today?',
          help_text: 'h',
          reason_medication_ids: [],
          is_core: false,
        },
      ],
      SYMPTOM_CATALOG,
    );
    expect(codes(merged)).toEqual([
      'fall_or_near_fall',
      'confusion',
      'dizziness',
      'shortness_of_breath',
      'nausea',
    ]);
    expect(merged.find((q) => q.symptom_code === 'dizziness')!.question_text).toBe(
      'Have you felt wobbly today?',
    );
    expect(merged.find((q) => q.symptom_code === 'dizziness')!.is_core).toBe(true);
  });

  it('never drops core questions when capping', () => {
    const extra = SYMPTOM_CATALOG.filter((s) => !s.is_core).map((s) => ({
      symptom_code: s.code,
      question_text: 'q',
      help_text: 'h',
      reason_medication_ids: [],
      is_core: false,
    }));
    const merged = mergeCoreQuestions(extra, SYMPTOM_CATALOG, 6);
    expect(merged).toHaveLength(6);
    expect(merged.slice(0, 4).every((q) => q.is_core)).toBe(true);
  });

  it('orders core first for display', () => {
    const qs = orderForDisplay([
      {
        symptom_code: 'a',
        question_text: '',
        help_text: '',
        reason_medication_ids: [],
        is_core: false,
      },
      {
        symptom_code: 'b',
        question_text: '',
        help_text: '',
        reason_medication_ids: [],
        is_core: true,
      },
    ]);
    expect(codes(qs)).toEqual(['b', 'a']);
  });
});
