import { describe, expect, it } from 'vitest';
import { sha256Hex, medicationFingerprint } from '../src/fingerprint.ts';
import { ageBand, ageOn } from '../src/age.ts';
import { ORG_SETTINGS_DEFAULTS, resolveOrgSettings } from '../src/settings.ts';
import { findBannedPhrases, passesWordingCheck } from '../src/wording.ts';
import { SYMPTOM_CATALOG, catalogByCode, symptomLabel } from '../src/catalog.ts';
import { formatDose, isMedicationActiveOn } from '../src/medications.ts';
import { med } from './fixtures.ts';

describe('sha256Hex', () => {
  it('matches known test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });
});

describe('medicationFingerprint', () => {
  const meds = [med('a', { drug_class: 'statin' }), med('b', { drug_class: 'opioid' })];
  it('is order independent and ignores inactive medicines', () => {
    const f = medicationFingerprint(meds, '2026-03-20');
    expect(medicationFingerprint([...meds].reverse(), '2026-03-20')).toBe(f);
    expect(medicationFingerprint([...meds, med('c', { status: 'stopped' })], '2026-03-20')).toBe(f);
    expect(f).toMatch(/^[0-9a-f]{64}$/);
  });
  it('changes when a dose, class or medicine changes', () => {
    const f = medicationFingerprint(meds, '2026-03-20');
    expect(
      medicationFingerprint([meds[0]!, { ...meds[1]!, dose_amount: 20 }], '2026-03-20'),
    ).not.toBe(f);
    expect(
      medicationFingerprint([meds[0]!, { ...meds[1]!, drug_class: 'ssri' }], '2026-03-20'),
    ).not.toBe(f);
    expect(medicationFingerprint([meds[0]!], '2026-03-20')).not.toBe(f);
  });
});

describe('age', () => {
  it('computes age and decade bands', () => {
    expect(ageOn('1942-05-01', '2026-04-30')).toBe(83);
    expect(ageOn('1942-05-01', '2026-05-01')).toBe(84);
    expect(ageBand('1942-05-01', '2026-05-01')).toBe('80–89');
    expect(ageBand('1920-01-01', '2026-05-01')).toBe('100+');
    expect(ageBand('2030-01-01', '2026-05-01')).toBe('unknown');
  });
});

describe('org settings', () => {
  it('fills defaults and drops invalid values', () => {
    expect(resolveOrgSettings(null)).toEqual(ORG_SETTINGS_DEFAULTS);
    expect(
      resolveOrgSettings({
        missed_dose_grace_minutes: 30,
        flag_dedupe_hours: -1,
        flag_min_severity_for_alert: 'high',
      }),
    ).toEqual({
      ...ORG_SETTINGS_DEFAULTS,
      missed_dose_grace_minutes: 30,
      flag_min_severity_for_alert: 'high',
    });
  });
});

describe('wording guard', () => {
  it('catches every banned phrase, case-insensitively', () => {
    for (const s of [
      'We diagnose',
      'a Diagnosis',
      'please STOP TAKING it',
      'reduce dose',
      'reduce the dose',
      'Increase your dose',
      'You have dementia',
      'you should take two',
      'we prescribe',
    ]) {
      expect(passesWordingCheck(s), s).toBe(false);
    }
  });
  it('allows identifiers, look-alikes and the required disclaimer', () => {
    for (const s of [
      'Prescriber',
      'prescriber_name',
      'Have you felt dizzy?',
      'Not a diagnosis.',
      'For clinician review.',
    ]) {
      expect(findBannedPhrases(s), s).toEqual([]);
    }
    expect(findBannedPhrases('Not a diagnosis. This is a diagnosis.')).toEqual(['diagnosis']);
  });
});

describe('catalog and medication helpers', () => {
  it('catalog has 20 symptoms with 4 core', () => {
    expect(SYMPTOM_CATALOG).toHaveLength(20);
    expect(
      SYMPTOM_CATALOG.filter((s) => s.is_core)
        .map((s) => s.code)
        .sort(),
    ).toEqual(['confusion', 'dizziness', 'fall_or_near_fall', 'shortness_of_breath']);
    expect(catalogByCode().get('rash')?.label).toBe('Rash');
    expect(symptomLabel('hiccup_attacks')).toBe('hiccup attacks');
  });
  it('isMedicationActiveOn / formatDose', () => {
    expect(
      isMedicationActiveOn(med('a', { status: 'stopped', end_date: '2026-03-10' }), '2026-03-09'),
    ).toBe(true);
    expect(formatDose({ dose_amount: 5, dose_unit: 'mg' })).toBe('5 mg');
    expect(formatDose({ dose_amount: 1, dose_unit: null })).toBe('1');
    expect(formatDose({ dose_amount: null, dose_unit: 'mg' })).toBe('');
  });
});
