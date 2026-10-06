-- Audit logging (spec §6.3). audit_log is append-only for everyone.

-- Block UPDATE / DELETE / TRUNCATE on audit_log regardless of role.
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

-- Generic row audit. Stores only *which* columns changed, never values, so the
-- audit trail does not duplicate PHI.
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_changed text[];
  v_org uuid;
  v_action text;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
    v_action := 'delete';
  else
    v_row := to_jsonb(new);
    v_action := case tg_op when 'INSERT' then 'create' else 'update' end;
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    select coalesce(array_agg(k order by k), '{}') into v_changed
    from jsonb_object_keys(v_row) k
    where k <> 'updated_at' and (v_row -> k) is distinct from (v_old -> k);
    if cardinality(v_changed) = 0 then
      return new;
    end if;
  end if;

  v_org := case
    when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid
    else (v_row ->> 'organization_id')::uuid
  end;
  -- During an organization delete cascade the org row is already gone.
  if v_org is not null and not exists (select 1 from public.organizations where id = v_org) then
    v_org := null;
  end if;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, changes)
  values (
    v_org,
    auth.uid(),
    v_action,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    case
      when tg_op = 'UPDATE' then jsonb_build_object('changed', to_jsonb(v_changed))
      else jsonb_build_object('patient_id', v_row ->> 'patient_id')
    end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'profiles', 'patients', 'patient_links', 'caseload_assignments', 'consents',
    'medications', 'medication_changes', 'dose_events', 'symptom_logs', 'checkin_templates',
    'flags', 'alerts', 'visit_summaries', 'invitations'
  ] loop
    execute format(
      'create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row()',
      t
    );
  end loop;
end;
$$;

-- When an organization is deleted, its audit rows lose the FK (set null) instead of blocking.
-- (Handled by the FK's ON DELETE SET NULL; the immutability trigger allows FK maintenance
-- only via this definer function.)
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  -- Allow the FK's ON DELETE SET NULL cascade (trigger depth > 1) when an org is deleted.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and new.organization_id is null and old.organization_id is not null
     and (to_jsonb(new) - array['organization_id', 'updated_at']) = (to_jsonb(old) - array['organization_id', 'updated_at']) then
    return new;
  end if;
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: view and export logging (called by the frontend)
-- ---------------------------------------------------------------------------
create or replace function public.log_view(p_entity_type text, p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient uuid;
begin
  if auth.uid() is null or public.auth_org_id() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_entity_type not in ('patient', 'visit_summary', 'audit_log', 'dashboard', 'pilot_metrics') then
    raise exception 'unsupported entity type' using errcode = '22023';
  end if;
  v_patient := case p_entity_type
    when 'patient' then p_entity_id
    when 'visit_summary' then (select patient_id from public.visit_summaries where id = p_entity_id)
  end;
  if p_entity_type in ('patient', 'visit_summary') and not public.can_access_patient(v_patient) then
    raise exception 'no access' using errcode = '42501';
  end if;
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, changes)
  values (public.auth_org_id(), auth.uid(), 'view', p_entity_type, p_entity_id, null);
end;
$$;

create or replace function public.log_export(p_entity_type text, p_entity_id uuid, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.auth_org_id() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_entity_type not in ('patient', 'visit_summary', 'audit_log', 'pilot_metrics') then
    raise exception 'unsupported entity type' using errcode = '22023';
  end if;
  if p_entity_type = 'patient' and not public.can_access_patient(p_entity_id) then
    raise exception 'no access' using errcode = '42501';
  end if;
  if p_entity_type = 'visit_summary' and not public.can_access_patient(
    (select patient_id from public.visit_summaries where id = p_entity_id)
  ) then
    raise exception 'no access' using errcode = '42501';
  end if;
  if p_entity_type in ('audit_log', 'pilot_metrics') and not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  -- Only allow small, non-PHI detail keys (format, row counts, date range).
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, changes)
  values (
    public.auth_org_id(),
    auth.uid(),
    'export',
    p_entity_type,
    p_entity_id,
    jsonb_strip_nulls(jsonb_build_object(
      'format', p_details ->> 'format',
      'rows', p_details -> 'rows',
      'from', p_details ->> 'from',
      'to', p_details ->> 'to'
    ))
  );
end;
$$;

create or replace function public.log_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.auth_org_id() is null then
    return;
  end if;
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id)
  values (public.auth_org_id(), auth.uid(), 'login', 'profile', auth.uid());
end;
$$;

revoke all on function public.log_view(text, uuid) from public, anon;
revoke all on function public.log_export(text, uuid, jsonb) from public, anon;
revoke all on function public.log_login() from public, anon;
grant execute on function public.log_view(text, uuid) to authenticated;
grant execute on function public.log_export(text, uuid, jsonb) to authenticated;
grant execute on function public.log_login() to authenticated;
