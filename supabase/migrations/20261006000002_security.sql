-- MedWatch row-level security (spec §6, Hard Rule 3).
-- RLS is the security boundary; the UI only mirrors it.

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can read profiles/links without
-- recursing through RLS; they only ever answer questions about auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function public.auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.auth_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

-- Staff with mfa_required must hold an AAL2 session (TOTP verified) to touch patient data.
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select not (p.mfa_required and p.role in ('nurse', 'agency_admin'))
        or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      from public.profiles p
      where p.id = auth.uid() and p.is_active
    ),
    false
  )
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.auth_role() in ('nurse', 'agency_admin'), false) and public.mfa_satisfied()
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.auth_role() = 'agency_admin', false) and public.mfa_satisfied()
$$;

-- agency_admin: any patient in their org; nurse: caseload (or primary nurse);
-- caregiver/patient: linked patients only.
create or replace function public.can_access_patient(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.patients pt
    where pt.id = p_patient_id
      and pt.organization_id = public.auth_org_id()
      and public.mfa_satisfied()
      and case public.auth_role()
        when 'agency_admin' then true
        when 'nurse' then
          pt.primary_nurse_id = auth.uid()
          or exists (
            select 1 from public.caseload_assignments c
            where c.patient_id = pt.id and c.nurse_id = auth.uid()
          )
        when 'caregiver' then exists (
          select 1 from public.patient_links l
          where l.patient_id = pt.id and l.profile_id = auth.uid() and l.relationship = 'caregiver'
        )
        when 'patient' then exists (
          select 1 from public.patient_links l
          where l.patient_id = pt.id and l.profile_id = auth.uid() and l.relationship = 'self'
        )
        else false
      end
  )
$$;

-- Staff (nurse on caseload, or admin) who may edit clinical data for a patient.
create or replace function public.can_manage_patient(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_staff() and public.can_access_patient(p_patient_id)
$$;

-- True when the current request is a trusted server context (service role or a
-- direct database session such as migrations/seed), not an end user.
create or replace function public.is_service_context()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role' or auth.uid() is null
$$;

revoke all on function public.can_access_patient(uuid) from public, anon;
grant execute on function public.can_access_patient(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Integrity: child rows always inherit the patient's organization and must
-- reference a medication of the same patient. Prevents cross-org smuggling.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_patient_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if new.patient_id is null then
    return new;
  end if;
  select organization_id into v_org from public.patients where id = new.patient_id;
  if v_org is null then
    raise exception 'unknown patient' using errcode = '23503';
  end if;
  new.organization_id := v_org;
  return new;
end;
$$;

create or replace function public.enforce_medication_patient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.medications m where m.id = new.medication_id and m.patient_id = new.patient_id
  ) then
    raise exception 'medication does not belong to patient' using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'patient_links', 'caseload_assignments', 'consents', 'medications', 'medication_changes',
    'dose_events', 'symptom_logs', 'checkin_templates', 'ai_requests', 'flags', 'alerts',
    'visit_summaries', 'invitations'
  ] loop
    execute format(
      'create trigger enforce_patient_org before insert or update on public.%I for each row execute function public.enforce_patient_org()',
      t
    );
  end loop;
  foreach t in array array['medication_changes', 'dose_events'] loop
    execute format(
      'create trigger enforce_medication_patient before insert or update on public.%I for each row execute function public.enforce_medication_patient()',
      t
    );
  end loop;
end;
$$;

-- Profiles referenced from patient-scoped rows must be in the same organization.
create or replace function public.enforce_same_org_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
begin
  v_profile := (to_jsonb(new) ->> case tg_table_name
    when 'patient_links' then 'profile_id'
    when 'caseload_assignments' then 'nurse_id'
    when 'patients' then 'primary_nurse_id'
  end)::uuid;
  if v_profile is not null and not exists (
    select 1 from public.profiles where id = v_profile and organization_id = new.organization_id
  ) then
    raise exception 'profile is not in this organization' using errcode = '23514';
  end if;
  if tg_table_name = 'caseload_assignments' and not exists (
    select 1 from public.profiles where id = v_profile and role in ('nurse', 'agency_admin')
  ) then
    raise exception 'caseload assignee must be a nurse' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_same_org_profile after insert or update on public.patient_links
  for each row execute function public.enforce_same_org_profile();
create trigger enforce_same_org_profile after insert or update on public.caseload_assignments
  for each row execute function public.enforce_same_org_profile();
create trigger enforce_same_org_profile after insert or update on public.patients
  for each row execute function public.enforce_same_org_profile();

-- ---------------------------------------------------------------------------
-- Column-level guards
-- ---------------------------------------------------------------------------

-- Patients and caregivers may only confirm doses (status/confirmation fields),
-- and the confirmation is always attributed to themselves.
create or replace function public.guard_dose_event_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_allowed text[] := array['status', 'confirmed_at', 'confirmed_by', 'confirmation_method', 'note', 'updated_at'];
begin
  if public.is_service_context() then
    return new;
  end if;
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    if v_role not in ('nurse', 'agency_admin') then
      raise exception 'only staff may change scheduling fields' using errcode = '42501';
    end if;
  end if;
  if new.status is distinct from old.status or new.confirmed_at is distinct from old.confirmed_at then
    if new.status = 'pending' then
      new.confirmed_at := null;
      new.confirmed_by := null;
      new.confirmation_method := null;
    else
      new.confirmed_by := auth.uid();
      new.confirmed_at := coalesce(new.confirmed_at, now());
      new.confirmation_method := case v_role
        when 'patient' then 'patient_tap'
        when 'caregiver' then 'caregiver_tap'
        else 'nurse'
      end;
    end if;
  end if;
  if v_role not in ('nurse', 'agency_admin') then
    if new.status not in ('pending', 'given', 'skipped', 'refused') then
      raise exception 'invalid status for this role' using errcode = '42501';
    end if;
    new.verification := old.verification;
  end if;
  return new;
end;
$$;
create trigger guard_dose_event_update before update on public.dose_events
  for each row execute function public.guard_dose_event_update();

-- Reviewers may only change review fields; flag content is engine-owned.
create or replace function public.guard_flag_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed text[] := array['status', 'reviewed_by', 'reviewed_at', 'review_note', 'updated_at'];
begin
  if public.is_service_context() then
    return new;
  end if;
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'flag content cannot be edited' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    if new.status = 'dismissed' and coalesce(btrim(new.review_note), '') = '' then
      raise exception 'dismissing a flag requires a reason' using errcode = '23514';
    end if;
    if new.status = 'escalated' and coalesce(btrim(new.review_note), '') = '' then
      raise exception 'escalating a flag requires a note' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_flag_update before update on public.flags
  for each row execute function public.guard_flag_update();

-- Users can edit their own contact preferences; only admins change role/org/active/MFA.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_service_context() then
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization cannot be changed' using errcode = '42501';
  end if;
  if (new.role, new.is_active, new.mfa_required) is distinct from (old.role, old.is_active, old.mfa_required)
     and not public.is_admin() then
    raise exception 'only admins may change role, status or MFA' using errcode = '42501';
  end if;
  if new.id = auth.uid() and new.role is distinct from old.role then
    raise exception 'you cannot change your own role' using errcode = '42501';
  end if;
  if new.sms_opt_in and not old.sms_opt_in then
    new.sms_opt_in_at := now();
  end if;
  return new;
end;
$$;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Symptom logs are always attributed to the signed-in user.
create or replace function public.stamp_symptom_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_service_context() then
    new.logged_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger stamp_symptom_log before insert or update on public.symptom_logs
  for each row execute function public.stamp_symptom_log();

-- medication_changes is immutable history. Deletion only happens through a
-- patient hard-delete cascade (trigger depth > 1).
create or replace function public.guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '% is immutable', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() <= 1 then
    raise exception '% rows cannot be deleted directly', tg_table_name using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger guard_immutable before update or delete on public.medication_changes
  for each row execute function public.guard_immutable();

-- Recorded-by is always the signed-in user.
create or replace function public.stamp_recorded_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_service_context() then
    new.recorded_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger stamp_recorded_by before insert on public.medication_changes
  for each row execute function public.stamp_recorded_by();

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.patients enable row level security;
alter table public.patient_links enable row level security;
alter table public.caseload_assignments enable row level security;
alter table public.consents enable row level security;
alter table public.medications enable row level security;
alter table public.medication_changes enable row level security;
alter table public.dose_events enable row level security;
alter table public.symptom_catalog enable row level security;
alter table public.symptom_logs enable row level security;
alter table public.checkin_templates enable row level security;
alter table public.ai_requests enable row level security;
alter table public.flags enable row level security;
alter table public.alerts enable row level security;
alter table public.visit_summaries enable row level security;
alter table public.audit_log enable row level security;
alter table public.invitations enable row level security;

-- organizations ---------------------------------------------------------------
create policy org_select on public.organizations for select to authenticated
  using (id = public.auth_org_id());
create policy org_update on public.organizations for update to authenticated
  using (id = public.auth_org_id() and public.is_admin())
  with check (id = public.auth_org_id() and public.is_admin());

-- profiles -------------------------------------------------------------------
-- Everyone sees themselves; staff see their org; patients/caregivers see their org's staff.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or (organization_id = public.auth_org_id() and public.is_staff())
    or (organization_id = public.auth_org_id() and role in ('nurse', 'agency_admin'))
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (organization_id = public.auth_org_id() and public.is_admin())
  with check (organization_id = public.auth_org_id() and public.is_admin());

-- patients -------------------------------------------------------------------
-- Admin branch checks the row directly so INSERT ... RETURNING works for new patients.
create policy patients_select on public.patients for select to authenticated
  using (
    (organization_id = public.auth_org_id() and public.is_admin())
    or public.can_access_patient(id)
  );
create policy patients_insert on public.patients for insert to authenticated
  with check (organization_id = public.auth_org_id() and public.is_admin());
create policy patients_update on public.patients for update to authenticated
  using (public.can_manage_patient(id))
  with check (organization_id = public.auth_org_id());
create policy patients_delete on public.patients for delete to authenticated
  using (organization_id = public.auth_org_id() and public.is_admin());

-- patient_links / caseload (admin-managed) -------------------------------------
create policy patient_links_select on public.patient_links for select to authenticated
  using (profile_id = auth.uid() or public.can_manage_patient(patient_id));
create policy patient_links_write on public.patient_links for all to authenticated
  using (organization_id = public.auth_org_id() and public.is_admin())
  with check (organization_id = public.auth_org_id() and public.is_admin());

create policy caseload_select on public.caseload_assignments for select to authenticated
  using (
    organization_id = public.auth_org_id()
    and public.is_staff()
    and (nurse_id = auth.uid() or public.is_admin())
  );
create policy caseload_write on public.caseload_assignments for all to authenticated
  using (organization_id = public.auth_org_id() and public.is_admin())
  with check (organization_id = public.auth_org_id() and public.is_admin());

-- consents (staff manage; family may view) -------------------------------------
create policy consents_select on public.consents for select to authenticated
  using (public.can_access_patient(patient_id));
create policy consents_insert on public.consents for insert to authenticated
  with check (public.can_manage_patient(patient_id));
create policy consents_update on public.consents for update to authenticated
  using (public.can_manage_patient(patient_id))
  with check (public.can_manage_patient(patient_id));

-- medications (patients/caregivers read-only) -----------------------------------
create policy medications_select on public.medications for select to authenticated
  using (public.can_access_patient(patient_id));
create policy medications_insert on public.medications for insert to authenticated
  with check (public.can_manage_patient(patient_id));
create policy medications_update on public.medications for update to authenticated
  using (public.can_manage_patient(patient_id))
  with check (public.can_manage_patient(patient_id));
create policy medications_delete on public.medications for delete to authenticated
  using (public.can_manage_patient(patient_id) and public.is_admin());

create policy medication_changes_select on public.medication_changes for select to authenticated
  using (public.can_access_patient(patient_id));
create policy medication_changes_insert on public.medication_changes for insert to authenticated
  with check (public.can_manage_patient(patient_id));

-- dose events ----------------------------------------------------------------
create policy dose_events_select on public.dose_events for select to authenticated
  using (public.can_access_patient(patient_id));
create policy dose_events_insert on public.dose_events for insert to authenticated
  with check (public.can_manage_patient(patient_id));
-- Patients/caregivers confirm doses; column guard trigger limits what they can change.
create policy dose_events_update on public.dose_events for update to authenticated
  using (public.can_access_patient(patient_id))
  with check (public.can_access_patient(patient_id));

-- symptoms -------------------------------------------------------------------
create policy symptom_catalog_select on public.symptom_catalog for select to authenticated
  using (true);

create policy symptom_logs_select on public.symptom_logs for select to authenticated
  using (public.can_access_patient(patient_id));
create policy symptom_logs_insert on public.symptom_logs for insert to authenticated
  with check (public.can_access_patient(patient_id));
create policy symptom_logs_update on public.symptom_logs for update to authenticated
  using (public.can_access_patient(patient_id))
  with check (public.can_access_patient(patient_id));
create policy symptom_logs_delete on public.symptom_logs for delete to authenticated
  using (public.can_manage_patient(patient_id));

-- check-in templates (written only by the tailor-checkin function) -------------
create policy checkin_templates_select on public.checkin_templates for select to authenticated
  using (public.can_access_patient(patient_id));

create policy ai_requests_select on public.ai_requests for select to authenticated
  using (organization_id = public.auth_org_id() and public.is_admin());

-- flags (engine inserts with service role; staff review) -------------------------
create policy flags_select on public.flags for select to authenticated
  using (public.can_access_patient(patient_id));
create policy flags_update on public.flags for update to authenticated
  using (public.can_manage_patient(patient_id))
  with check (public.can_manage_patient(patient_id));

-- alerts (recipient reads and marks read) ---------------------------------------
create policy alerts_select on public.alerts for select to authenticated
  using (
    recipient_profile_id = auth.uid()
    or (organization_id = public.auth_org_id() and public.is_admin())
  );
create policy alerts_update on public.alerts for update to authenticated
  using (recipient_profile_id = auth.uid())
  with check (recipient_profile_id = auth.uid());

-- visit summaries ------------------------------------------------------------
create policy visit_summaries_select on public.visit_summaries for select to authenticated
  using (public.can_access_patient(patient_id));
create policy visit_summaries_insert on public.visit_summaries for insert to authenticated
  with check (public.can_manage_patient(patient_id) and generated_by = auth.uid());

-- audit log (read: admins; write: triggers/RPCs only; never update/delete) -------
create policy audit_log_select on public.audit_log for select to authenticated
  using (organization_id = public.auth_org_id() and public.is_admin());

-- invitations ------------------------------------------------------------------
create policy invitations_select on public.invitations for select to authenticated
  using (organization_id = public.auth_org_id() and public.is_admin());
create policy invitations_delete on public.invitations for delete to authenticated
  using (organization_id = public.auth_org_id() and public.is_admin());
