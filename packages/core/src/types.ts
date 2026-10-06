// Domain types shared by the web app, Edge Functions and seed generator.
// Shapes mirror the database rows (snake_case) so rows can be passed straight in.

export type Role = 'patient' | 'caregiver' | 'nurse' | 'agency_admin';
export type Severity = 'low' | 'medium' | 'high';
export type FlagType = 'temporal_correlation' | 'medication_risk' | 'interaction' | 'adherence';
export type FlagStatus = 'open' | 'acknowledged' | 'dismissed' | 'escalated';
export type DoseStatus = 'pending' | 'given' | 'missed' | 'skipped' | 'refused';
export type ChangeType =
  | 'started'
  | 'stopped'
  | 'dose_increased'
  | 'dose_decreased'
  | 'schedule_changed';

/** ISO date `YYYY-MM-DD` (a calendar day in the organization's timezone). */
export type IsoDate = string;
/** ISO timestamp (UTC instant). */
export type IsoInstant = string;

export interface PatientRef {
  id: string;
  organization_id: string;
}

export interface PatientInfo extends PatientRef {
  first_name: string;
  last_name: string;
  date_of_birth: IsoDate;
}

export interface Medication {
  id: string;
  organization_id: string;
  patient_id: string;
  name: string;
  generic_name?: string | null;
  drug_class?: string | null;
  dose_amount?: number | string | null;
  dose_unit?: string | null;
  route?: string | null;
  frequency_label?: string | null;
  schedule_times: string[];
  prn: boolean;
  start_date: IsoDate;
  end_date?: IsoDate | null;
  status: 'active' | 'stopped';
  purpose?: string | null;
}

export interface MedicationChange {
  id: string;
  patient_id: string;
  medication_id: string;
  change_type: ChangeType;
  previous?: Record<string, unknown> | null;
  current?: Record<string, unknown> | null;
  effective_date: IsoDate;
}

export interface DoseEvent {
  id: string;
  patient_id: string;
  medication_id: string;
  scheduled_for: IsoInstant;
  status: DoseStatus;
  note?: string | null;
  confirmed_at?: IsoInstant | null;
}

export interface SymptomEntry {
  symptom_code: string;
  severity: number; // 0–3
}

export interface SymptomLog {
  id: string;
  patient_id: string;
  logged_for_date: IsoDate;
  entries: SymptomEntry[];
  overall_feeling?: number | null;
}

export interface SymptomCatalogEntry {
  code: string;
  label: string;
  plain_label: string;
  help_text: string;
  category: string;
  is_core: boolean;
  sort_order: number;
}

export interface ExistingFlag {
  id: string;
  dedupe_key: string;
  status: FlagStatus;
  severity: Severity;
  created_at: IsoInstant;
}

export interface FlagEvidence {
  rule_id: string | null;
  medication_ids: string[];
  medication_change_ids: string[];
  dose_event_ids: string[];
  symptom_log_ids: string[];
  symptom_code?: string;
  onset_date?: IsoDate;
  score?: number;
  score_parts?: { label: string; points: number }[];
  other_candidate_change_ids?: string[];
  adherence?: { given: number; total: number; longest_missed_run: number };
}

export interface FlagDraft {
  organization_id: string;
  patient_id: string;
  flag_type: FlagType;
  severity: Severity;
  title: string;
  explanation: string;
  evidence: FlagEvidence;
  rule_id: string | null;
  dedupe_key: string;
  /** When set, the engine asks to raise the severity of this existing flag instead of creating one. */
  upgrades_flag_id?: string;
}

export interface CheckinQuestion {
  symptom_code: string;
  question_text: string;
  help_text: string;
  reason_medication_ids: string[];
  is_core: boolean;
}
