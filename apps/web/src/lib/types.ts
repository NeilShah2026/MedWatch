// Row shapes returned by Supabase (hand-written; mirrors supabase/migrations).
import type {
  ChangeType,
  CheckinQuestion,
  DoseStatus,
  FlagEvidence,
  FlagStatus,
  FlagType,
  Role,
  Severity,
  SymptomEntry,
  VisitSummaryContent,
} from '@medwatch/core';

export interface ProfileRow {
  id: string;
  organization_id: string;
  role: Role;
  full_name: string;
  email: string | null;
  phone: string | null;
  sms_opt_in: boolean;
  mfa_required: boolean;
  is_active: boolean;
}

export interface OrganizationRow {
  id: string;
  name: string;
  timezone: string;
  settings: Record<string, unknown>;
}

export interface PatientRow {
  id: string;
  organization_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  primary_nurse_id: string | null;
  notes: string | null;
  status: 'active' | 'discharged';
  last_visit_at: string | null;
}

export interface MedicationRow {
  id: string;
  organization_id: string;
  patient_id: string;
  name: string;
  generic_name: string | null;
  drug_class: string | null;
  purpose: string | null;
  dose_amount: number | null;
  dose_unit: string | null;
  route: string | null;
  frequency_label: string | null;
  schedule_times: string[];
  prn: boolean;
  start_date: string;
  end_date: string | null;
  status: 'active' | 'stopped';
  prescriber_name: string | null;
  created_at: string;
}

export interface MedicationChangeRow {
  id: string;
  patient_id: string;
  medication_id: string;
  change_type: ChangeType;
  previous: Record<string, unknown> | null;
  current: Record<string, unknown> | null;
  effective_date: string;
  recorded_by: string | null;
  created_at: string;
}

export interface DoseEventRow {
  id: string;
  patient_id: string;
  medication_id: string;
  scheduled_for: string;
  status: DoseStatus;
  confirmed_at: string | null;
  confirmed_by: string | null;
  confirmation_method: 'patient_tap' | 'caregiver_tap' | 'nurse' | 'system' | null;
  verification: 'reported' | 'verified';
  note: string | null;
}

export interface SymptomLogRow {
  id: string;
  patient_id: string;
  logged_for_date: string;
  logged_by: string | null;
  entries: SymptomEntry[];
  overall_feeling: number | null;
  free_text: string | null;
  updated_at: string;
}

export interface CheckinTemplateRow {
  id: string;
  patient_id: string;
  medication_fingerprint: string;
  source: 'ai' | 'rules' | 'default';
  questions: CheckinQuestion[];
  model: string | null;
  prompt_version: string | null;
  status: 'active' | 'superseded';
  created_at: string;
}

export interface FlagRow {
  id: string;
  organization_id: string;
  patient_id: string;
  flag_type: FlagType;
  severity: Severity;
  status: FlagStatus;
  title: string;
  explanation: string;
  evidence: FlagEvidence;
  rule_id: string | null;
  dedupe_key: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

export interface AlertRow {
  id: string;
  patient_id: string | null;
  recipient_profile_id: string;
  channel: 'in_app' | 'sms';
  alert_type: 'missed_dose' | 'flag' | 'escalation';
  related_id: string | null;
  sent_at: string;
  read_at: string | null;
  patients?: { first_name: string; last_name: string } | null;
}

export interface ConsentRow {
  id: string;
  patient_id: string;
  consent_type: 'data_use' | 'sms' | 'caregiver_access';
  granted_by_name: string;
  granted_by_relationship: string;
  granted_at: string;
  revoked_at: string | null;
  document_version: string;
}

export interface VisitSummaryRow {
  id: string;
  patient_id: string;
  generated_by: string | null;
  period_start: string;
  period_end: string;
  content: VisitSummaryContent;
  created_at: string;
}

export interface AuditRow {
  id: string;
  actor_id: string | null;
  action: 'view' | 'create' | 'update' | 'delete' | 'export' | 'login';
  entity_type: string;
  entity_id: string | null;
  changes: Record<string, unknown> | null;
  created_at: string;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  full_name: string | null;
  patient_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface PatientOverviewRow {
  patient_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  primary_nurse_id: string | null;
  status: 'active' | 'discharged';
  last_visit_at: string | null;
  open_high: number;
  open_medium: number;
  open_low: number;
  adherence_7d: number | null;
  given_7d: number;
  total_7d: number;
  last_checkin: string | null;
  checkin_today: boolean;
  doses_today_done: number;
  doses_today_total: number;
}
