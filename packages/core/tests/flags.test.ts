import { describe, expect, it } from 'vitest';
import { runFlagEngine, severityForScore, type FlagEngineInput } from '../src/flags.ts';
import type { ExistingFlag, FlagDraft } from '../src/types.ts';
import { findBannedPhrases } from '../src/wording.ts';
import { TZ, change, doses, log, med, patient, quietLogs, rules, settings } from './fixtures.ts';

const NOW = '2026-03-20T16:00:00Z'; // 12:00 EDT, local day 2026-03-20

function input(o: Partial<FlagEngineInput> = {}): FlagEngineInput {
  return {
    patient,
    medications: [],
    medicationChanges: [],
    doseEvents: [],
    symptomLogs: [],
    existingFlags: [],
    rules,
    settings,
    now: NOW,
    timezone: TZ,
    ...o,
  };
}

/** Story-1 style scenario: a sleep medicine started 3 days before dizziness. */
function sleepScenario(
  o: {
    symptom?: string;
    severity?: number;
    doseStatus?: (i: number) => 'given' | 'missed';
    drugClass?: string;
    changeDate?: string;
    priorLogs?: ReturnType<typeof log>[];
  } = {},
) {
  const changeDate = o.changeDate ?? '2026-03-17';
  const m = med('zol', {
    name: 'Zolpidem',
    drug_class: o.drugClass ?? 'sedative_hypnotic',
    start_date: changeDate,
    schedule_times: ['08:00', '20:00'],
  });
  return input({
    medications: [m],
    medicationChanges: [change('chg-1', 'zol', 'started', changeDate)],
    doseEvents: doses('zol', changeDate, '2026-03-19', ['08:00', '20:00'], o.doseStatus),
    symptomLogs: [
      ...(o.priorLogs ?? quietLogs('2026-03-10', '2026-03-19')),
      log('2026-03-20', { [o.symptom ?? 'dizziness']: o.severity ?? 2 }),
    ],
  });
}

const temporal = (flags: FlagDraft[]) =>
  flags.filter((f) => f.flag_type === 'temporal_correlation');

describe('severityForScore', () => {
  it('maps score bands', () => {
    expect(severityForScore(7)).toBe('high');
    expect(severityForScore(6)).toBe('high');
    expect(severityForScore(5)).toBe('medium');
    expect(severityForScore(4)).toBe('medium');
    expect(severityForScore(3)).toBe('low');
    expect(severityForScore(2)).toBe('low');
    expect(severityForScore(1)).toBeNull();
    expect(severityForScore(-1)).toBeNull();
  });
});

describe('temporal correlation', () => {
  it('produces the spec example: associated, in window, all doses taken → high', () => {
    const [f] = temporal(runFlagEngine(sleepScenario()));
    expect(f).toBeDefined();
    expect(f!.severity).toBe('high');
    expect(f!.explanation).toBe(
      'Dizziness started 3 days after Zolpidem was started on Mar 17. Doses were reported taken 6 of 6 times. Dizziness is a recognized possible effect of this type of medicine. For clinician review.',
    );
    expect(f!.title).toBe('Dizziness began after Zolpidem start');
    expect(f!.evidence.score).toBe(6);
    expect(f!.evidence.medication_change_ids).toEqual(['chg-1']);
    expect(f!.evidence.medication_ids).toEqual(['zol']);
    expect(f!.evidence.dose_event_ids).toHaveLength(6);
    expect(f!.evidence.symptom_log_ids).toContain('log-2026-03-20');
    expect(f!.evidence.onset_date).toBe('2026-03-20');
    expect(f!.rule_id).toBe('se.sedative_hypnotic');
    expect(f!.dedupe_key).toBe('temporal_correlation:pat-1:zol:dizziness');
  });

  it('+3 when associated and inside the onset window', () => {
    const f = temporal(runFlagEngine(sleepScenario({ severity: 1 })))[0]!;
    expect(f.evidence.score_parts).toContainEqual({
      label: 'Listed effect, typical timing',
      points: 3,
    });
    expect(f.evidence.score).toBe(5); // 3 + 2 (given)
  });

  it('+1 when associated but outside the onset window', () => {
    // statin → muscle pain typical window 7–14 days; symptom at day 3
    const f = temporal(
      runFlagEngine(sleepScenario({ symptom: 'muscle_pain', drugClass: 'statin' })),
    )[0]!;
    expect(f.evidence.score_parts).toContainEqual({
      label: 'Listed effect, unusual timing',
      points: 1,
    });
    expect(f.evidence.score).toBe(4); // 1 + 2 + 1
    expect(f.severity).toBe('medium');
    expect(f.explanation).toContain('usually appears on a different timeline');
  });

  it('no association adds nothing and omits the "recognized effect" sentence', () => {
    const f = temporal(runFlagEngine(sleepScenario({ drugClass: 'other' })))[0]!;
    expect(f.evidence.score).toBe(3); // 2 + 1
    expect(f.severity).toBe('low');
    expect(f.rule_id).toBeNull();
    expect(f.explanation).not.toContain('recognized');
  });

  it('+2 when doses in the window were mostly given (≥80%)', () => {
    // 5 of 6 given = 83%
    const f = temporal(
      runFlagEngine(sleepScenario({ doseStatus: (i) => (i === 0 ? 'missed' : 'given') })),
    )[0]!;
    expect(f.evidence.score_parts).toContainEqual({ label: 'Doses reported taken', points: 2 });
    expect(f.explanation).toContain('taken 5 of 6 times');
  });

  it('−2 when doses were mostly missed, and the explanation says so', () => {
    const f = temporal(
      runFlagEngine(sleepScenario({ doseStatus: (i) => (i === 0 ? 'given' : 'missed') })),
    )[0]!;
    expect(f.evidence.score_parts).toContainEqual({ label: 'Doses mostly missed', points: -2 });
    expect(f.evidence.score).toBe(2); // 3 − 2 + 1
    expect(f.severity).toBe('low');
    expect(f.explanation).toContain('Most doses were reported missed');
    expect(f.explanation).toContain('taken 1 of 6 times');
  });

  it('neither bonus nor penalty for mixed adherence (50–79%)', () => {
    const f = temporal(
      runFlagEngine(sleepScenario({ doseStatus: (i) => (i % 2 ? 'missed' : 'given') })),
    )[0]!;
    expect(f.evidence.score).toBe(4); // 3 + 1
    expect(f.explanation).toContain('taken 3 of 6 times');
  });

  it('+1 for severity ≥ 2', () => {
    const s1 = temporal(runFlagEngine(sleepScenario({ severity: 1 })))[0]!;
    const s3 = temporal(runFlagEngine(sleepScenario({ severity: 3 })))[0]!;
    expect(s3.evidence.score! - s1.evidence.score!).toBe(1);
  });

  it('+1 for falls and confusion; falls are phrased as "reported"', () => {
    const fall = temporal(runFlagEngine(sleepScenario({ symptom: 'fall_or_near_fall' })))[0]!;
    expect(fall.evidence.score).toBe(7);
    expect(
      fall.explanation.startsWith('A fall or near-fall was reported 3 days after Zolpidem'),
    ).toBe(true);
    const conf = temporal(runFlagEngine(sleepScenario({ symptom: 'confusion' })))[0]!;
    expect(conf.evidence.score_parts).toContainEqual({ label: 'Fall or confusion', points: 1 });
  });

  it('notes when no dose records exist', () => {
    const i = sleepScenario();
    const f = temporal(runFlagEngine({ ...i, doseEvents: [] }))[0]!;
    expect(f.explanation).toContain('No dose records were available');
    expect(f.evidence.score).toBe(4);
  });

  it('detects worsened symptoms (severity up ≥1 vs prior 7-day max)', () => {
    const prior = [
      ...quietLogs('2026-03-10', '2026-03-17'),
      log('2026-03-18', { dizziness: 1 }),
      log('2026-03-19'),
    ];
    const f = temporal(runFlagEngine(sleepScenario({ priorLogs: prior, severity: 2 })))[0]!;
    expect(f.explanation.startsWith('Dizziness got worse 3 days after')).toBe(true);
    expect(f.title).toContain('worsened');
  });

  it('does not flag a symptom that is neither new nor worse', () => {
    // Dizziness 2 on Mar 13 (outside the evaluation window) → Mar 20 at the same level is not a trigger.
    const prior = [
      ...quietLogs('2026-03-10', '2026-03-12'),
      log('2026-03-13', { dizziness: 2 }),
      ...quietLogs('2026-03-14', '2026-03-19'),
    ];
    expect(temporal(runFlagEngine(sleepScenario({ priorLogs: prior, severity: 2 })))).toEqual([]);
    // A same-level repeat inside the window yields only the original onset day.
    const recent = [
      ...quietLogs('2026-03-10', '2026-03-17'),
      log('2026-03-18', { dizziness: 2 }),
      log('2026-03-19'),
    ];
    const t = temporal(runFlagEngine(sleepScenario({ priorLogs: recent, severity: 2 })));
    expect(t.map((f) => f.evidence.onset_date)).toEqual(['2026-03-18']);
  });

  it('treats a symptom last seen more than 7 days earlier as new', () => {
    const prior = [log('2026-03-12', { dizziness: 3 }), ...quietLogs('2026-03-13', '2026-03-19')];
    const f = temporal(runFlagEngine(sleepScenario({ priorLogs: prior })))[0]!;
    expect(f.explanation.startsWith('Dizziness started')).toBe(true);
  });

  it('only considers changes 1–14 days before the symptom day', () => {
    expect(temporal(runFlagEngine(sleepScenario({ changeDate: '2026-03-20' })))).toEqual([]);
    expect(temporal(runFlagEngine(sleepScenario({ changeDate: '2026-03-05' })))).toEqual([]);
    expect(temporal(runFlagEngine(sleepScenario({ changeDate: '2026-03-06' })))).toHaveLength(1);
  });

  it('ignores "stopped" changes', () => {
    const i = sleepScenario();
    const out = runFlagEngine({
      ...i,
      medicationChanges: [change('c', 'zol', 'stopped', '2026-03-17')],
    });
    expect(temporal(out)).toEqual([]);
  });

  it('ignores changes for medicines that are not in the list', () => {
    const i = sleepScenario();
    expect(
      temporal(
        runFlagEngine({ ...i, medicationChanges: [change('c', 'ghost', 'started', '2026-03-17')] }),
      ),
    ).toEqual([]);
  });

  it('describes dose and schedule changes', () => {
    const i = sleepScenario();
    for (const [type, phrase, noun] of [
      ['dose_increased', 'the Zolpidem dose was raised', 'dose increase'],
      ['dose_decreased', 'the Zolpidem dose was lowered', 'dose decrease'],
      ['schedule_changed', 'the Zolpidem schedule was changed', 'schedule change'],
    ] as const) {
      const f = temporal(
        runFlagEngine({ ...i, medicationChanges: [change('c', 'zol', type, '2026-03-17')] }),
      )[0]!;
      expect(f.explanation).toContain(phrase);
      expect(f.title).toContain(noun);
    }
  });

  it('picks the best-scoring change and lists the other candidates', () => {
    const i = sleepScenario();
    const other = med('vit', {
      name: 'Vitamin D',
      drug_class: 'vitamin_supplement',
      start_date: '2026-03-15',
    });
    const f = temporal(
      runFlagEngine({
        ...i,
        medications: [...i.medications, other],
        medicationChanges: [
          ...i.medicationChanges,
          change('chg-2', 'vit', 'started', '2026-03-15'),
        ],
      }),
    )[0]!;
    expect(f.evidence.medication_change_ids).toEqual(['chg-1']);
    expect(f.evidence.other_candidate_change_ids).toEqual(['chg-2']);
  });

  it('only evaluates symptom days within the dedupe window by default', () => {
    const i = sleepScenario({ changeDate: '2026-03-12' });
    const logs = [
      ...quietLogs('2026-03-05', '2026-03-14'),
      log('2026-03-15', { dizziness: 2 }),
      ...quietLogs('2026-03-16', '2026-03-20'),
    ];
    expect(temporal(runFlagEngine({ ...i, symptomLogs: logs }))).toEqual([]);
    expect(temporal(runFlagEngine({ ...i, symptomLogs: logs, evaluationDays: 7 }))).toHaveLength(1);
  });

  it('collapses several trigger days for the same key into one flag (most severe)', () => {
    const i = sleepScenario({ changeDate: '2026-03-16' });
    const logs = [
      ...quietLogs('2026-03-10', '2026-03-17'),
      log('2026-03-18', { dizziness: 1 }),
      log('2026-03-19'),
      log('2026-03-20', { dizziness: 3 }),
    ];
    const t = temporal(runFlagEngine({ ...i, symptomLogs: logs }));
    expect(t).toHaveLength(1);
    expect(t[0]!.evidence.onset_date).toBe('2026-03-20');
  });
});

describe('dedupe and upgrade', () => {
  const key = 'temporal_correlation:pat-1:zol:dizziness';
  const existing = (o: Partial<ExistingFlag>): ExistingFlag => ({
    id: 'f1',
    dedupe_key: key,
    status: 'open',
    severity: 'high',
    created_at: '2026-03-20T10:00:00Z',
    ...o,
  });

  it('does not create a duplicate while an open or acknowledged flag exists', () => {
    for (const status of ['open', 'acknowledged'] as const) {
      const out = runFlagEngine({
        ...sleepScenario(),
        existingFlags: [existing({ status, created_at: '2026-01-01T00:00:00Z' })],
      });
      expect(temporal(out)).toEqual([]);
    }
  });

  it('does not re-create a reviewed flag inside the dedupe window', () => {
    const out = runFlagEngine({
      ...sleepScenario(),
      existingFlags: [existing({ status: 'dismissed' })],
    });
    expect(temporal(out)).toEqual([]);
  });

  it('allows a new flag after the dedupe window for event-type flags', () => {
    const out = runFlagEngine({
      ...sleepScenario(),
      existingFlags: [existing({ status: 'dismissed', created_at: '2026-03-16T00:00:00Z' })],
    });
    expect(temporal(out)).toHaveLength(1);
  });

  it('upgrades severity of an existing open flag when the new evidence is stronger', () => {
    const out = temporal(
      runFlagEngine({ ...sleepScenario(), existingFlags: [existing({ severity: 'low' })] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.upgrades_flag_id).toBe('f1');
    expect(out[0]!.severity).toBe('high');
  });

  it('never downgrades', () => {
    const out = runFlagEngine({
      ...sleepScenario({ severity: 1, drugClass: 'other' }),
      existingFlags: [existing({ severity: 'medium' })],
    });
    expect(temporal(out)).toEqual([]);
  });
});

describe('medication risk', () => {
  it('raises one flag per rule listing every matching medicine', () => {
    const out = runFlagEngine(
      input({
        medications: [
          med('a', { name: 'Zolpidem', drug_class: 'sedative_hypnotic' }),
          med('b', { name: 'Eszopiclone', drug_class: 'sedative_hypnotic' }),
          med('c', { name: 'Atorvastatin', drug_class: 'statin' }),
        ],
      }),
    ).filter((f) => f.flag_type === 'medication_risk');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      rule_id: 'risk.sedative_hypnotic',
      severity: 'medium',
      dedupe_key: 'medication_risk:pat-1:risk.sedative_hypnotic:a,b',
    });
    expect(out[0]!.explanation).toBe(
      'Zolpidem, Eszopiclone: This kind of medicine can raise fall risk and cause next-day sleepiness in older adults. For clinician review.',
    );
    expect(out[0]!.evidence.medication_ids).toEqual(['a', 'b']);
  });

  it('honours min_days_active ("long-term")', () => {
    const recent = runFlagEngine(
      input({ medications: [med('n', { drug_class: 'nsaid', start_date: '2026-03-10' })] }),
    );
    expect(recent.filter((f) => f.flag_type === 'medication_risk')).toEqual([]);
    const longTerm = runFlagEngine(
      input({ medications: [med('n', { drug_class: 'nsaid', start_date: '2026-01-10' })] }),
    );
    expect(longTerm.filter((f) => f.flag_type === 'medication_risk').map((f) => f.rule_id)).toEqual(
      ['risk.nsaid_long_term'],
    );
  });

  it('ignores stopped and not-yet-started medicines', () => {
    const out = runFlagEngine(
      input({
        medications: [
          med('a', { drug_class: 'opioid', status: 'stopped', end_date: '2026-03-01' }),
          med('b', { drug_class: 'opioid', start_date: '2026-04-01' }),
        ],
      }),
    );
    expect(out).toEqual([]);
  });

  it('is not re-raised after review (persistent condition)', () => {
    const i = input({ medications: [med('a', { drug_class: 'opioid' })] });
    const key = 'medication_risk:pat-1:risk.opioid:a';
    const out = runFlagEngine({
      ...i,
      existingFlags: [
        {
          id: 'x',
          dedupe_key: key,
          status: 'dismissed',
          severity: 'medium',
          created_at: '2025-01-01T00:00:00Z',
        },
      ],
    });
    expect(out).toEqual([]);
  });
});

describe('interaction', () => {
  it('flags an anticoagulant with an NSAID', () => {
    const out = runFlagEngine(
      input({
        medications: [
          med('w', { name: 'Apixaban', drug_class: 'anticoagulant' }),
          med('n', { name: 'Naproxen', drug_class: 'nsaid', start_date: '2026-03-15' }),
        ],
      }),
    ).filter((f) => f.flag_type === 'interaction');
    expect(out.map((f) => f.rule_id)).toEqual(['ix.anticoagulant_nsaid']);
    expect(out[0]!.severity).toBe('high');
    expect(out[0]!.explanation).toBe(
      'Naproxen and Apixaban are on the active medicine list. Together these kinds of medicines can raise the chance of bleeding. For clinician review.',
    );
    expect(out[0]!.evidence.medication_ids).toEqual(['n', 'w']);
  });

  it('same-group rules need two different medicines', () => {
    const one = runFlagEngine(input({ medications: [med('a', { drug_class: 'opioid' })] }));
    expect(one.filter((f) => f.flag_type === 'interaction')).toEqual([]);
    const two = runFlagEngine(
      input({
        medications: [
          med('a', { drug_class: 'opioid' }),
          med('b', { drug_class: 'benzodiazepine' }),
          med('c', { drug_class: 'gabapentinoid' }),
        ],
      }),
    ).filter((f) => f.flag_type === 'interaction');
    expect(two).toHaveLength(1);
    expect(two[0]!.explanation).toContain('are all on the active medicine list');
    expect(two[0]!.evidence.medication_ids).toEqual(['a', 'b', 'c']);
  });
});

describe('adherence', () => {
  const m = med('bp', {
    name: 'Lisinopril',
    drug_class: 'ace_inhibitor',
    schedule_times: ['08:00', '20:00'],
  });

  it('flags adherence below 70% over the last 7 days', () => {
    const out = runFlagEngine(
      input({
        medications: [m],
        doseEvents: doses('bp', '2026-03-13', '2026-03-19', ['08:00', '20:00'], (i) =>
          i % 3 === 0 ? 'given' : i % 3 === 1 ? 'missed' : 'given',
        ),
      }),
    );
    // pattern given, missed, given → 2/3 ≈ 67%, but runs never reach 3
    const f = out.find((x) => x.flag_type === 'adherence')!;
    expect(f.title).toBe('Low reported adherence: Lisinopril');
    expect(f.severity).toBe('medium');
    expect(f.explanation).toMatch(
      /^Lisinopril: doses were reported taken \d+ of \d+ times in the last 7 days \(\d+%\)\. For clinician review\.$/,
    );
  });

  it('flags 3+ consecutive missed doses even when the rate is fine', () => {
    const statuses = (i: number) => (i >= 6 && i <= 8 ? 'missed' : 'given');
    const out = runFlagEngine(
      input({
        medications: [m],
        doseEvents: doses('bp', '2026-03-12', '2026-03-19', ['08:00', '20:00'], statuses),
      }),
    );
    const f = out.find((x) => x.flag_type === 'adherence')!;
    expect(f.title).toBe('Missed doses in a row: Lisinopril');
    expect(f.explanation).toContain('3 doses in a row were reported missed.');
    expect(f.evidence.adherence?.longest_missed_run).toBe(3);
    expect(f.evidence.dose_event_ids).toHaveLength(3);
  });

  it('is high severity below 50%', () => {
    const out = runFlagEngine(
      input({
        medications: [m],
        doseEvents: doses('bp', '2026-03-14', '2026-03-19', ['08:00', '20:00'], (i) =>
          i % 3 === 0 ? 'given' : 'missed',
        ),
      }),
    );
    expect(out.find((x) => x.flag_type === 'adherence')!.severity).toBe('high');
  });

  it('does not flag good adherence, PRN medicines, or medicines without doses', () => {
    expect(
      runFlagEngine(
        input({ medications: [m], doseEvents: doses('bp', '2026-03-13', '2026-03-19') }),
      ),
    ).toEqual([]);
    const prn = med('prn', { prn: true });
    expect(
      runFlagEngine(
        input({
          medications: [prn],
          doseEvents: doses('prn', '2026-03-13', '2026-03-19', ['08:00'], () => 'missed'),
        }),
      ),
    ).toEqual([]);
    expect(runFlagEngine(input({ medications: [m] }))).toEqual([]);
  });
});

describe('engine-wide guarantees', () => {
  function everything(): FlagEngineInput {
    const i = sleepScenario();
    return {
      ...i,
      medications: [
        ...i.medications,
        med('w', { name: 'Apixaban', drug_class: 'anticoagulant' }),
        med('n', { name: 'Naproxen', drug_class: 'nsaid' }),
        med('bp', { name: 'Lisinopril', drug_class: 'ace_inhibitor' }),
      ],
      doseEvents: [
        ...i.doseEvents,
        ...doses('bp', '2026-03-13', '2026-03-19', ['08:00'], () => 'missed'),
      ],
    };
  }

  it('produces all four flag types for a combined scenario', () => {
    const types = new Set(runFlagEngine(everything()).map((f) => f.flag_type));
    expect(types).toEqual(
      new Set(['temporal_correlation', 'medication_risk', 'interaction', 'adherence']),
    );
  });

  it('every explanation ends with "For clinician review." and passes the wording check', () => {
    for (const f of runFlagEngine(everything())) {
      expect(f.explanation.endsWith('For clinician review.')).toBe(true);
      expect(findBannedPhrases(`${f.title} ${f.explanation}`)).toEqual([]);
      expect(f.organization_id).toBe('org-1');
      expect(f.patient_id).toBe('pat-1');
    }
  });

  it('is deterministic, including when input order is shuffled', () => {
    const a = runFlagEngine(everything());
    const b = runFlagEngine(everything());
    expect(b).toEqual(a);
    const i = everything();
    const shuffled = runFlagEngine({
      ...i,
      medications: [...i.medications].reverse(),
      doseEvents: [...i.doseEvents].reverse(),
      symptomLogs: [...i.symptomLogs].reverse(),
    });
    expect(shuffled).toEqual(a);
    expect(a.map((f) => f.dedupe_key)).toEqual([...a.map((f) => f.dedupe_key)].sort());
  });

  it('refuses to emit a flag whose text fails the wording check', () => {
    const i = sleepScenario();
    expect(() =>
      runFlagEngine({ ...i, medications: [{ ...i.medications[0]!, name: 'Prescribe' }] }),
    ).toThrow(/wording check/);
  });

  it('accepts Date objects for now', () => {
    expect(runFlagEngine({ ...sleepScenario(), now: new Date(NOW) })).toEqual(
      runFlagEngine(sleepScenario()),
    );
  });
});
