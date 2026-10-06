import { describe, expect, it } from 'vitest';
import { RAW_RULE_FILES, getBundledRules } from '../src/rules/bundled.ts';
import { RuleValidationError, drugClassLabel, loadRules } from '../src/rules/loader.ts';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function withEdit(file: keyof typeof RAW_RULE_FILES, edit: (doc: Any) => void) {
  const raw = clone(RAW_RULE_FILES) as unknown as Record<string, Any>;
  edit(raw[file]!);
  return () => loadRules(raw as unknown as typeof RAW_RULE_FILES);
}

function errorOf(fn: () => unknown): RuleValidationError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RuleValidationError);
    return e as RuleValidationError;
  }
  throw new Error('expected loadRules to throw');
}

describe('rule loader', () => {
  it('loads the repository rule files', () => {
    const r = getBundledRules();
    expect(r.medicationRisks.length).toBeGreaterThanOrEqual(10);
    expect(r.interactions.length).toBeGreaterThanOrEqual(8);
    expect(r.sideEffects.length).toBeGreaterThanOrEqual(15);
    expect(r.sideEffectsByClass.get('sedative_hypnotic')?.symptoms.length).toBeGreaterThan(0);
    expect(getBundledRules()).toBe(r); // cached
  });

  it('every file and rule is still marked as a placeholder', () => {
    const r = getBundledRules();
    expect(r.isPlaceholder).toBe(true);
    for (const doc of Object.values(RAW_RULE_FILES) as Any[]) {
      expect(doc.status).toBe('PLACEHOLDER_REQUIRES_CLINICAL_REVIEW');
      for (const rule of doc.rules ?? [])
        expect(rule.status).toBe('PLACEHOLDER_REQUIRES_CLINICAL_REVIEW');
    }
  });

  it('reports a missing required field with file and path', () => {
    const e = errorOf(withEdit('medicationRisks', (d) => delete d.rules[0].risk_summary));
    expect(e.file).toBe('rules/medication_risks.json');
    expect(e.message).toContain('rules.0.risk_summary');
  });

  it('rejects unknown status values', () => {
    const e = errorOf(withEdit('interactions', (d) => (d.status = 'APPROVED_BY_ME')));
    expect(e.message).toContain('status');
  });

  it('rejects unknown fields (typos)', () => {
    const e = errorOf(withEdit('medicationRisks', (d) => (d.rules[0].severty = 'low')));
    expect(e.message).toMatch(/Unrecognized key/);
  });

  it('rejects unknown drug classes', () => {
    const e = errorOf(withEdit('medicationRisks', (d) => (d.rules[0].drug_class = 'made_up')));
    expect(e.problems[0]).toContain('unknown drug_class "made_up"');
    const e2 = errorOf(withEdit('interactions', (d) => d.rules[0].group_b.push('nope')));
    expect(e2.problems.join()).toContain('"nope"');
    const e3 = errorOf(withEdit('sideEffects', (d) => (d.rules[0].drug_class = 'nope')));
    expect(e3.file).toBe('rules/side_effect_associations.json');
  });

  it('rejects unknown symptom codes', () => {
    const e = errorOf(
      withEdit('sideEffects', (d) => (d.rules[0].symptoms[0].symptom_code = 'hiccups')),
    );
    expect(e.problems.join()).toContain('unknown symptom_code "hiccups"');
  });

  it('rejects inverted onset windows', () => {
    const e = errorOf(
      withEdit('sideEffects', (d) => {
        d.rules[0].symptoms[0].typical_onset_days_min = 10;
        d.rules[0].symptoms[0].typical_onset_days_max = 2;
      }),
    );
    expect(e.message).toContain('typical_onset_days_min must be <=');
  });

  it('rejects duplicate ids and duplicate classes', () => {
    const e = errorOf(withEdit('medicationRisks', (d) => (d.rules[1].id = d.rules[0].id)));
    expect(e.problems.join()).toContain('duplicate rule id');
    const e2 = errorOf(
      withEdit('sideEffects', (d) => (d.rules[1].drug_class = d.rules[0].drug_class)),
    );
    expect(e2.problems.join()).toContain('appears in more than one rule');
    const e3 = errorOf(withEdit('drugClasses', (d) => d.classes.push(d.classes[0])));
    expect(e3.problems.join()).toContain('duplicate class code');
    const e4 = errorOf(withEdit('interactions', (d) => (d.rules[1].id = d.rules[0].id)));
    expect(e4.problems.join()).toContain('duplicate rule id');
    const e5 = errorOf(withEdit('sideEffects', (d) => (d.rules[1].id = d.rules[0].id)));
    expect(e5.problems.join()).toContain('duplicate rule id');
  });

  it('rejects banned clinical wording in rule text', () => {
    const e = errorOf(
      withEdit(
        'medicationRisks',
        (d) => (d.rules[0].risk_summary = 'Patients should stop taking this medicine.'),
      ),
    );
    expect(e.problems.join()).toContain('banned phrase "stop taking"');
    const e2 = errorOf(withEdit('interactions', (d) => (d.rules[0].title = 'Reduce dose now')));
    expect(e2.problems.join()).toContain('banned phrase');
  });

  it('rejects malformed ids and versions', () => {
    expect(
      errorOf(withEdit('medicationRisks', (d) => (d.rules[0].id = 'Bad Id'))).message,
    ).toContain('id');
    expect(errorOf(withEdit('medicationRisks', (d) => (d.version = 'v1'))).message).toContain(
      'version',
    );
  });

  it('isPlaceholder becomes false only when everything is approved', () => {
    const raw = clone(RAW_RULE_FILES) as unknown as Record<string, Any>;
    for (const doc of Object.values(raw)) {
      doc.status = 'CLINICIAN_APPROVED';
      for (const r of doc.rules ?? []) r.status = 'CLINICIAN_APPROVED';
    }
    expect(loadRules(raw as unknown as typeof RAW_RULE_FILES).isPlaceholder).toBe(false);
  });

  it('drugClassLabel', () => {
    const r = getBundledRules();
    expect(drugClassLabel(r, 'statin')).toBe('Statin (cholesterol)');
    expect(drugClassLabel(r, 'mystery_class')).toBe('mystery class');
    expect(drugClassLabel(r, null)).toBe('');
  });
});
