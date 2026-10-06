/**
 * Flag engine (spec §7.3). Pure and deterministic: same inputs → same outputs.
 * No randomness, no clock reads (callers pass `now`), no network.
 *
 * Every flag is a prompt for clinician review — never a conclusion.
 */
import type {
  ChangeType,
  DoseEvent,
  ExistingFlag,
  FlagDraft,
  FlagEvidence,
  FlagType,
  IsoDate,
  Medication,
  MedicationChange,
  PatientRef,
  Severity,
  SymptomCatalogEntry,
  SymptomLog,
} from './types.ts';
import type { OrgSettings } from './settings.ts';
import { SEVERITY_RANK } from './settings.ts';
import type { RuleSet } from './rules/loader.ts';
import { SYMPTOM_CATALOG, symptomLabel } from './catalog.ts';
import { isMedicationActiveOn } from './medications.ts';
import { isCountedDose, longestMissedRun } from './adherence.ts';
import { addDays, daysBetween, formatShortDate, localDate, toInstant } from './time.ts';
import { CLINICIAN_REVIEW_SUFFIX, findBannedPhrases } from './wording.ts';

export interface FlagEngineInput {
  patient: PatientRef;
  medications: readonly Medication[];
  medicationChanges: readonly MedicationChange[];
  doseEvents: readonly DoseEvent[];
  symptomLogs: readonly SymptomLog[];
  existingFlags: readonly ExistingFlag[];
  rules: RuleSet;
  settings: Pick<OrgSettings, 'flag_dedupe_hours'>;
  now: Date | string;
  timezone: string;
  catalog?: readonly SymptomCatalogEntry[];
  /**
   * How many recent symptom days to evaluate for temporal correlation.
   * Default: ceil(flag_dedupe_hours / 24) — any trigger day is examined by the hourly job
   * while it is inside the dedupe window, and never re-examined afterwards.
   */
  evaluationDays?: number;
}

/** Scoring constants (spec §7.3.1). */
export const SCORE = {
  associatedInWindow: 3,
  associatedOutOfWindow: 1,
  dosesMostlyGiven: 2,
  dosesMostlyMissed: -2,
  severityTwoOrMore: 1,
  fallOrConfusion: 1,
} as const;

export const LOOKBACK_CHANGE_DAYS = { min: 1, max: 14 } as const;
export const PRIOR_SYMPTOM_DAYS = 7;
export const ADHERENCE_WINDOW_DAYS = 7;
export const ADHERENCE_THRESHOLD = 0.7;
export const ADHERENCE_MIN_DOSES = 3;
export const CONSECUTIVE_MISSED_THRESHOLD = 3;

export function severityForScore(score: number): Severity | null {
  if (score >= 6) return 'high';
  if (score >= 4) return 'medium';
  if (score >= 2) return 'low';
  return null;
}

const PERSISTENT_TYPES: ReadonlySet<FlagType> = new Set(['medication_risk', 'interaction']);

export function runFlagEngine(input: FlagEngineInput): FlagDraft[] {
  const ctx = makeContext(input);
  const drafts = [
    ...temporalCorrelationFlags(ctx),
    ...medicationRiskFlags(ctx),
    ...interactionFlags(ctx),
    ...adherenceFlags(ctx),
  ];
  // One draft per key within a run: keep the most severe (latest wins a tie).
  const byKey = new Map<string, FlagDraft>();
  for (const d of drafts) {
    const prev = byKey.get(d.dedupe_key);
    if (!prev || SEVERITY_RANK[d.severity] >= SEVERITY_RANK[prev.severity])
      byKey.set(d.dedupe_key, d);
  }
  const out: FlagDraft[] = [];
  for (const d of byKey.values()) {
    const problems = findBannedPhrases(`${d.title} ${d.explanation}`);
    if (problems.length) {
      // Programming error in a template or rule text; never emit such a flag.
      throw new Error(`Flag ${d.dedupe_key} failed the wording check: ${problems.join(', ')}`);
    }
    const resolved = applyDedupe(d, input.existingFlags, ctx);
    if (resolved) out.push(resolved);
  }
  return out.sort((a, b) => a.dedupe_key.localeCompare(b.dedupe_key));
}

// ---------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------

interface Ctx {
  input: FlagEngineInput;
  now: number;
  today: IsoDate;
  catalog: readonly SymptomCatalogEntry[];
  medsById: Map<string, Medication>;
  activeMeds: Medication[];
  dosesByMed: Map<string, DoseEvent[]>;
  logsByDate: Map<IsoDate, SymptomLog>;
}

function makeContext(input: FlagEngineInput): Ctx {
  const now = toInstant(input.now);
  const today = localDate(now, input.timezone);
  const dosesByMed = new Map<string, DoseEvent[]>();
  for (const d of [...input.doseEvents].sort((a, b) =>
    a.scheduled_for.localeCompare(b.scheduled_for),
  )) {
    const list = dosesByMed.get(d.medication_id) ?? [];
    list.push(d);
    dosesByMed.set(d.medication_id, list);
  }
  const logsByDate = new Map<IsoDate, SymptomLog>();
  for (const l of input.symptomLogs) logsByDate.set(l.logged_for_date, l);
  const meds = [...input.medications].sort((a, b) => a.id.localeCompare(b.id));
  return {
    input,
    now,
    today,
    catalog: input.catalog ?? SYMPTOM_CATALOG,
    medsById: new Map(meds.map((m) => [m.id, m])),
    activeMeds: meds.filter((m) => isMedicationActiveOn(m, today)),
    dosesByMed,
    logsByDate,
  };
}

function base(
  ctx: Ctx,
  flag_type: FlagType,
): Pick<FlagDraft, 'organization_id' | 'patient_id' | 'flag_type'> {
  return {
    organization_id: ctx.input.patient.organization_id,
    patient_id: ctx.input.patient.id,
    flag_type,
  };
}

function emptyEvidence(rule_id: string | null): FlagEvidence {
  return {
    rule_id,
    medication_ids: [],
    medication_change_ids: [],
    dose_event_ids: [],
    symptom_log_ids: [],
  };
}

// ---------------------------------------------------------------------------
// 1. temporal correlation
// ---------------------------------------------------------------------------

interface Candidate {
  change: MedicationChange;
  medication: Medication;
  days: number;
  score: number;
  parts: { label: string; points: number }[];
  given: number;
  total: number;
  mostlyMissed: boolean;
  doseIds: string[];
  association: 'in_window' | 'out_of_window' | 'none';
  ruleId: string | null;
}

const CHANGE_NOUN: Record<ChangeType, string> = {
  started: 'start',
  stopped: 'stop',
  dose_increased: 'dose increase',
  dose_decreased: 'dose decrease',
  schedule_changed: 'schedule change',
};

function changePhrase(type: ChangeType, name: string): string {
  switch (type) {
    case 'started':
      return `${name} was started`;
    case 'dose_increased':
      return `the ${name} dose was raised`;
    case 'dose_decreased':
      return `the ${name} dose was lowered`;
    case 'schedule_changed':
      return `the ${name} schedule was changed`;
    case 'stopped':
      return `${name} was stopped`;
  }
}

function pluralDays(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

function temporalCorrelationFlags(ctx: Ctx): FlagDraft[] {
  const { input } = ctx;
  const evalDays = Math.max(
    1,
    input.evaluationDays ?? Math.ceil(input.settings.flag_dedupe_hours / 24),
  );
  const firstDay = addDays(ctx.today, -(evalDays - 1));
  const out: FlagDraft[] = [];

  const days = [...ctx.logsByDate.keys()].filter((d) => d >= firstDay && d <= ctx.today).sort();
  for (const day of days) {
    const log = ctx.logsByDate.get(day)!;
    const priorLogs: SymptomLog[] = [];
    for (let i = 1; i <= PRIOR_SYMPTOM_DAYS; i++) {
      const prior = ctx.logsByDate.get(addDays(day, -i));
      if (prior) priorLogs.push(prior);
    }
    const entries = [...log.entries]
      .filter((e) => e.severity > 0)
      .sort((a, b) => a.symptom_code.localeCompare(b.symptom_code));
    for (const entry of entries) {
      const priorMax = Math.max(
        0,
        ...priorLogs.flatMap((l) =>
          l.entries.filter((e) => e.symptom_code === entry.symptom_code).map((e) => e.severity),
        ),
      );
      const isNew = priorMax === 0;
      const isWorse = !isNew && entry.severity - priorMax >= 1;
      if (!isNew && !isWorse) continue;

      const best = bestCandidate(ctx, day, entry.symptom_code, entry.severity);
      if (!best) continue;
      const severity = severityForScore(best.score);
      if (!severity) continue;
      out.push(
        temporalDraft(ctx, {
          day,
          log,
          priorLogs,
          symptom: entry.symptom_code,
          isNew,
          best: best.best,
          others: best.others,
          severity,
        }),
      );
    }
  }
  return out;
}

function bestCandidate(
  ctx: Ctx,
  day: IsoDate,
  symptom: string,
  severity: number,
): { best: Candidate; others: Candidate[]; score: number } | null {
  const candidates: Candidate[] = [];
  for (const change of ctx.input.medicationChanges) {
    if (change.change_type === 'stopped') continue;
    const days = daysBetween(change.effective_date, day);
    if (days < LOOKBACK_CHANGE_DAYS.min || days > LOOKBACK_CHANGE_DAYS.max) continue;
    const medication = ctx.medsById.get(change.medication_id);
    if (!medication) continue;
    candidates.push(scoreCandidate(ctx, change, medication, day, days, symptom, severity));
  }
  if (!candidates.length) return null;
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.days - b.days ||
      a.medication.id.localeCompare(b.medication.id) ||
      a.change.id.localeCompare(b.change.id),
  );
  const [best, ...others] = candidates as [Candidate, ...Candidate[]];
  return { best, others, score: best.score };
}

function scoreCandidate(
  ctx: Ctx,
  change: MedicationChange,
  medication: Medication,
  day: IsoDate,
  days: number,
  symptom: string,
  severity: number,
): Candidate {
  const parts: { label: string; points: number }[] = [];
  const rule = medication.drug_class
    ? ctx.input.rules.sideEffectsByClass.get(medication.drug_class)
    : undefined;
  const assoc = rule?.symptoms.find((s) => s.symptom_code === symptom);
  let association: Candidate['association'] = 'none';
  if (assoc) {
    if (days >= assoc.typical_onset_days_min && days <= assoc.typical_onset_days_max) {
      association = 'in_window';
      parts.push({ label: 'Listed effect, typical timing', points: SCORE.associatedInWindow });
    } else {
      association = 'out_of_window';
      parts.push({ label: 'Listed effect, unusual timing', points: SCORE.associatedOutOfWindow });
    }
  }

  // Doses of this medicine from the change through the symptom day, already due.
  const doses = (ctx.dosesByMed.get(medication.id) ?? []).filter((d) => {
    const t = toInstant(d.scheduled_for);
    if (t > ctx.now) return false;
    const ld = localDate(t, ctx.input.timezone);
    return ld >= change.effective_date && ld <= day && isCountedDose(d);
  });
  const given = doses.filter((d) => d.status === 'given').length;
  const total = doses.length;
  const missedShare = total ? (total - given) / total : 0;
  let mostlyMissed = false;
  if (total > 0 && given / total >= 0.8) {
    parts.push({ label: 'Doses reported taken', points: SCORE.dosesMostlyGiven });
  } else if (total > 0 && missedShare > 0.5) {
    mostlyMissed = true;
    parts.push({ label: 'Doses mostly missed', points: SCORE.dosesMostlyMissed });
  }
  if (severity >= 2) parts.push({ label: 'Moderate or worse', points: SCORE.severityTwoOrMore });
  if (symptom === 'fall_or_near_fall' || symptom === 'confusion') {
    parts.push({ label: 'Fall or confusion', points: SCORE.fallOrConfusion });
  }
  return {
    change,
    medication,
    days,
    score: parts.reduce((s, p) => s + p.points, 0),
    parts,
    given,
    total,
    mostlyMissed,
    doseIds: doses.map((d) => d.id),
    association,
    ruleId: assoc && rule ? rule.id : null,
  };
}

function temporalDraft(
  ctx: Ctx,
  a: {
    day: IsoDate;
    log: SymptomLog;
    priorLogs: SymptomLog[];
    symptom: string;
    isNew: boolean;
    best: Candidate;
    others: Candidate[];
    severity: Severity;
  },
): FlagDraft {
  const { best } = a;
  const label = symptomLabel(a.symptom, ctx.catalog);
  const name = best.medication.name;
  const when = `${pluralDays(best.days)} after ${changePhrase(best.change.change_type, name)} on ${formatShortDate(best.change.effective_date)}`;
  const lead = a.isNew
    ? a.symptom === 'fall_or_near_fall'
      ? `A fall or near-fall was reported ${when}.`
      : `${label} started ${when}.`
    : `${label} got worse ${when}.`;

  const sentences = [lead];
  if (best.total === 0) {
    sentences.push('No dose records were available for this period.');
  } else if (best.mostlyMissed) {
    sentences.push(
      `Most doses were reported missed: taken ${best.given} of ${best.total} times, so a link to this medicine may be less likely.`,
    );
  } else {
    sentences.push(`Doses were reported taken ${best.given} of ${best.total} times.`);
  }
  if (best.association === 'in_window') {
    sentences.push(`${label} is a recognized possible effect of this type of medicine.`);
  } else if (best.association === 'out_of_window') {
    sentences.push(
      `${label} is a recognized possible effect of this type of medicine, though it usually appears on a different timeline.`,
    );
  }
  sentences.push(CLINICIAN_REVIEW_SUFFIX);

  const evidence: FlagEvidence = {
    ...emptyEvidence(best.ruleId),
    medication_ids: [best.medication.id],
    medication_change_ids: [best.change.id],
    dose_event_ids: best.doseIds,
    symptom_log_ids: [a.log.id, ...a.priorLogs.map((l) => l.id)].sort(),
    symptom_code: a.symptom,
    onset_date: a.day,
    score: best.score,
    score_parts: best.parts,
  };
  if (a.others.length) {
    evidence.other_candidate_change_ids = a.others.map((c) => c.change.id).sort();
  }

  return {
    ...base(ctx, 'temporal_correlation'),
    severity: a.severity,
    title: `${label} ${a.isNew ? 'began' : 'worsened'} after ${name} ${CHANGE_NOUN[best.change.change_type]}`,
    explanation: sentences.join(' '),
    evidence,
    rule_id: best.ruleId,
    dedupe_key: `temporal_correlation:${ctx.input.patient.id}:${best.medication.id}:${a.symptom}`,
  };
}

// ---------------------------------------------------------------------------
// 2. medication risk
// ---------------------------------------------------------------------------

function medicationRiskFlags(ctx: Ctx): FlagDraft[] {
  const out: FlagDraft[] = [];
  for (const rule of ctx.input.rules.medicationRisks) {
    const meds = ctx.activeMeds.filter(
      (m) =>
        m.drug_class === rule.drug_class &&
        (!rule.min_days_active || daysBetween(m.start_date, ctx.today) >= rule.min_days_active),
    );
    if (!meds.length) continue;
    const ids = meds.map((m) => m.id).sort();
    out.push({
      ...base(ctx, 'medication_risk'),
      severity: rule.severity,
      title: rule.title,
      explanation: `${meds.map((m) => m.name).join(', ')}: ${rule.risk_summary} ${CLINICIAN_REVIEW_SUFFIX}`,
      evidence: { ...emptyEvidence(rule.id), medication_ids: ids },
      rule_id: rule.id,
      dedupe_key: `medication_risk:${ctx.input.patient.id}:${rule.id}:${ids.join(',')}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. interaction
// ---------------------------------------------------------------------------

function interactionFlags(ctx: Ctx): FlagDraft[] {
  const out: FlagDraft[] = [];
  for (const rule of ctx.input.rules.interactions) {
    const inA = ctx.activeMeds.filter((m) => m.drug_class && rule.group_a.includes(m.drug_class));
    const inB = ctx.activeMeds.filter((m) => m.drug_class && rule.group_b.includes(m.drug_class));
    const pairs: [Medication, Medication][] = [];
    for (const a of inA) for (const b of inB) if (a.id !== b.id) pairs.push([a, b]);
    if (!pairs.length) continue;
    const involved = [...new Set(pairs.flatMap(([a, b]) => [a.id, b.id]))].sort();
    const names = involved.map((id) => ctx.medsById.get(id)!.name);
    const list =
      names.length === 2 ? `${names[0]} and ${names[1]} are` : `${names.join(', ')} are all`;
    out.push({
      ...base(ctx, 'interaction'),
      severity: rule.severity,
      title: rule.title,
      explanation: `${list} on the active medicine list. ${rule.risk_summary} ${CLINICIAN_REVIEW_SUFFIX}`,
      evidence: { ...emptyEvidence(rule.id), medication_ids: involved },
      rule_id: rule.id,
      dedupe_key: `interaction:${ctx.input.patient.id}:${rule.id}:${involved.join(',')}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. adherence
// ---------------------------------------------------------------------------

function adherenceFlags(ctx: Ctx): FlagDraft[] {
  const out: FlagDraft[] = [];
  const windowStart = ctx.now - ADHERENCE_WINDOW_DAYS * 24 * 60 * 60_000;
  for (const m of ctx.activeMeds) {
    if (m.prn) continue;
    const doses = (ctx.dosesByMed.get(m.id) ?? []).filter((d) => {
      const t = toInstant(d.scheduled_for);
      return t >= windowStart && t <= ctx.now && isCountedDose(d);
    });
    if (!doses.length) continue;
    const given = doses.filter((d) => d.status === 'given').length;
    const rate = given / doses.length;
    const run = longestMissedRun(doses);
    const lowRate = doses.length >= ADHERENCE_MIN_DOSES && rate < ADHERENCE_THRESHOLD;
    const longRun = run >= CONSECUTIVE_MISSED_THRESHOLD;
    if (!lowRate && !longRun) continue;

    const pct = Math.round(rate * 100);
    const sentences = [
      `${m.name}: doses were reported taken ${given} of ${doses.length} times in the last 7 days (${pct}%).`,
    ];
    if (longRun) sentences.push(`${run} doses in a row were reported missed.`);
    sentences.push(CLINICIAN_REVIEW_SUFFIX);
    out.push({
      ...base(ctx, 'adherence'),
      severity: rate < 0.5 ? 'high' : 'medium',
      title: longRun ? `Missed doses in a row: ${m.name}` : `Low reported adherence: ${m.name}`,
      explanation: sentences.join(' '),
      evidence: {
        ...emptyEvidence(null),
        medication_ids: [m.id],
        dose_event_ids: doses.filter((d) => d.status !== 'given').map((d) => d.id),
        adherence: { given, total: doses.length, longest_missed_run: run },
      },
      rule_id: null,
      dedupe_key: `adherence:${ctx.input.patient.id}:${m.id}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// dedupe / upgrade
// ---------------------------------------------------------------------------

/**
 * - An open/acknowledged flag with the same key suppresses the draft, unless the draft is
 *   more severe — then the existing flag is upgraded instead.
 * - Any flag with the same key created within flag_dedupe_hours suppresses the draft.
 * - Persistent conditions (medication risk, interaction) are flagged once per key: a flag
 *   that was reviewed (dismissed/escalated) is not re-raised. The key includes the medicine
 *   ids, so a new medicine produces a new key.
 */
function applyDedupe(
  draft: FlagDraft,
  existing: readonly ExistingFlag[],
  ctx: Ctx,
): FlagDraft | null {
  const same = existing
    .filter((f) => f.dedupe_key === draft.dedupe_key)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  if (!same.length) return draft;

  const active = same.find((f) => f.status === 'open' || f.status === 'acknowledged');
  if (active) {
    if (SEVERITY_RANK[draft.severity] > SEVERITY_RANK[active.severity]) {
      return { ...draft, upgrades_flag_id: active.id };
    }
    return null;
  }
  if (PERSISTENT_TYPES.has(draft.flag_type)) return null;
  const windowStart = ctx.now - ctx.input.settings.flag_dedupe_hours * 60 * 60_000;
  if (same.some((f) => toInstant(f.created_at) >= windowStart)) return null;
  return draft;
}
