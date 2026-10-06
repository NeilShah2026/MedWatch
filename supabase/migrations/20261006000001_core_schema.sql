-- MedWatch core schema (spec §5).
-- Every patient-data table carries organization_id for RLS (see 20261006000002_security.sql).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/New_York',
  settings jsonb not null default jsonb_build_object(
    'missed_dose_grace_minutes', 60,
    'agency_escalation_minutes', 120,
    'flag_min_severity_for_alert', 'medium',
    'flag_dedupe_hours', 72,
    'session_timeout_minutes', 15
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_settings_object check (jsonb_typeof(settings) = 'object')
);

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  role text not null check (role in ('patient', 'caregiver', 'nurse', 'agency_admin')),
  full_name text not null,
  email text,
  phone text,
  sms_opt_in boolean not null default false,
  sms_opt_in_at timestamptz,
  mfa_required boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------------
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  date_of_birth date not null,
  primary_nurse_id uuid references public.profiles (id) on delete set null,
  notes text,
  status text not null default 'active' check (status in ('active', 'discharged')),
  last_visit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.patient_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  relationship text not null check (relationship in ('self', 'caregiver')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, profile_id)
);

create table public.caseload_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  nurse_id uuid not null references public.profiles (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nurse_id, patient_id)
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  consent_type text not null check (consent_type in ('data_use', 'sms', 'caregiver_access')),
  granted_by_name text not null,
  granted_by_relationship text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  document_version text not null default 'v1-draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- medications and history
-- ---------------------------------------------------------------------------
create table public.medications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  name text not null,
  generic_name text,
  drug_class text,
  purpose text,
  dose_amount numeric,
  dose_unit text,
  route text,
  frequency_label text,
  schedule_times text[] not null default '{}',
  prn boolean not null default false,
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'stopped')),
  prescriber_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medications_schedule_times_format check (
    array_to_string(schedule_times, ',') ~ '^(([01][0-9]|2[0-3]):[0-5][0-9](,|$))*$'
  ),
  constraint medications_dates check (end_date is null or end_date >= start_date)
);

create table public.medication_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  medication_id uuid not null references public.medications (id) on delete cascade,
  change_type text not null check (
    change_type in ('started', 'stopped', 'dose_increased', 'dose_decreased', 'schedule_changed')
  ),
  previous jsonb,
  current jsonb,
  effective_date date not null,
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- doses and symptoms
-- ---------------------------------------------------------------------------
create table public.dose_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  medication_id uuid not null references public.medications (id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (
    status in ('pending', 'given', 'missed', 'skipped', 'refused')
  ),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmation_method text check (
    confirmation_method in ('patient_tap', 'caregiver_tap', 'nurse', 'system')
  ),
  verification text not null default 'reported' check (verification in ('reported', 'verified')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (medication_id, scheduled_for)
);

create table public.symptom_catalog (
  code text primary key,
  label text not null,
  plain_label text not null,
  help_text text not null default '',
  category text not null,
  is_core boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.symptom_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  logged_for_date date not null,
  logged_by uuid references public.profiles (id) on delete set null,
  entries jsonb not null default '[]'::jsonb,
  overall_feeling int check (overall_feeling between 1 and 5),
  free_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, logged_for_date),
  constraint symptom_logs_entries_array check (jsonb_typeof(entries) = 'array')
);

-- ---------------------------------------------------------------------------
-- tailored check-ins and AI metadata
-- ---------------------------------------------------------------------------
create table public.checkin_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  medication_fingerprint text not null,
  source text not null check (source in ('ai', 'rules', 'default')),
  questions jsonb not null,
  model text,
  prompt_version text,
  status text not null default 'active' check (status in ('active', 'superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkin_templates_questions_array check (jsonb_typeof(questions) = 'array')
);
create unique index checkin_templates_one_active
  on public.checkin_templates (patient_id) where status = 'active';

-- Metadata only: never prompt or response bodies (Hard Rule 9).
create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid references public.patients (id) on delete cascade,
  purpose text not null default 'checkin_template' check (purpose in ('checkin_template')),
  model text,
  status text not null check (status in ('success', 'invalid_output', 'error', 'timeout')),
  latency_ms int,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- flags, alerts, summaries
-- ---------------------------------------------------------------------------
create table public.flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  flag_type text not null check (
    flag_type in ('temporal_correlation', 'medication_risk', 'interaction', 'adherence')
  ),
  severity text not null check (severity in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'dismissed', 'escalated')),
  title text not null,
  explanation text not null,
  evidence jsonb not null default '{}'::jsonb,
  rule_id text,
  dedupe_key text not null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid references public.patients (id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null check (channel in ('in_app', 'sms')),
  alert_type text not null check (alert_type in ('missed_dose', 'flag', 'escalation')),
  related_id uuid,
  sent_at timestamptz not null default now(),
  read_at timestamptz,
  delivery_status text not null default 'delivered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- DB-level idempotency for alert jobs: one alert per recipient/type/subject/channel.
create unique index alerts_dedupe
  on public.alerts (recipient_profile_id, alert_type, related_id, channel);

create table public.visit_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  generated_by uuid references public.profiles (id) on delete set null,
  period_start date not null,
  period_end date not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- audit log (append-only; protections in 20261006000003_audit.sql)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  actor_id uuid,
  action text not null check (action in ('view', 'create', 'update', 'delete', 'export', 'login')),
  entity_type text not null,
  entity_id uuid,
  changes jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role text not null check (role in ('patient', 'caregiver', 'nurse', 'agency_admin')),
  full_name text,
  patient_id uuid references public.patients (id) on delete cascade,
  token_hash text not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitations_patient_for_family check (
    role in ('nurse', 'agency_admin') or patient_id is not null
  )
);

-- ---------------------------------------------------------------------------
-- indexes (spec §5)
-- ---------------------------------------------------------------------------
create index profiles_org_idx on public.profiles (organization_id);
create index patients_org_idx on public.patients (organization_id);
create index patients_primary_nurse_idx on public.patients (primary_nurse_id);
create index patient_links_org_idx on public.patient_links (organization_id);
create index patient_links_patient_idx on public.patient_links (patient_id);
create index patient_links_profile_idx on public.patient_links (profile_id);
create index caseload_org_idx on public.caseload_assignments (organization_id);
create index caseload_patient_idx on public.caseload_assignments (patient_id);
create index caseload_nurse_idx on public.caseload_assignments (nurse_id);
create index consents_org_idx on public.consents (organization_id);
create index consents_patient_idx on public.consents (patient_id);
create index medications_org_idx on public.medications (organization_id);
create index medications_patient_idx on public.medications (patient_id);
create index medication_changes_org_idx on public.medication_changes (organization_id);
create index medication_changes_patient_idx on public.medication_changes (patient_id, effective_date);
create index medication_changes_med_idx on public.medication_changes (medication_id);
create index dose_events_org_idx on public.dose_events (organization_id);
create index dose_events_patient_idx on public.dose_events (patient_id, scheduled_for);
create index dose_events_sched_status_idx on public.dose_events (scheduled_for, status);
create index symptom_logs_org_idx on public.symptom_logs (organization_id);
create index symptom_logs_patient_date_idx on public.symptom_logs (patient_id, logged_for_date);
create index checkin_templates_org_idx on public.checkin_templates (organization_id);
create index checkin_templates_patient_idx on public.checkin_templates (patient_id);
create index ai_requests_org_idx on public.ai_requests (organization_id, created_at);
create index ai_requests_patient_idx on public.ai_requests (patient_id, created_at);
create index flags_org_status_sev_idx on public.flags (organization_id, status, severity);
create index flags_patient_idx on public.flags (patient_id);
create index flags_dedupe_idx on public.flags (patient_id, dedupe_key);
create index alerts_org_idx on public.alerts (organization_id);
create index alerts_patient_idx on public.alerts (patient_id);
create index alerts_recipient_idx on public.alerts (recipient_profile_id, read_at);
create index visit_summaries_org_idx on public.visit_summaries (organization_id);
create index visit_summaries_patient_idx on public.visit_summaries (patient_id, created_at);
create index audit_log_org_idx on public.audit_log (organization_id, created_at);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_id);
create index invitations_org_idx on public.invitations (organization_id);
create index invitations_patient_idx on public.invitations (patient_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers on every table
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'profiles', 'patients', 'patient_links', 'caseload_assignments', 'consents',
    'medications', 'medication_changes', 'dose_events', 'symptom_catalog', 'symptom_logs',
    'checkin_templates', 'ai_requests', 'flags', 'alerts', 'visit_summaries', 'audit_log',
    'invitations'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t
    );
  end loop;
end;
$$;
