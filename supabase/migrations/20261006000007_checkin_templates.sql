-- Atomic replacement of a patient's active check-in template (used by tailor-checkin).
-- Service role only: end users never write templates.
create or replace function public.replace_checkin_template(
  p_patient_id uuid,
  p_fingerprint text,
  p_source text,
  p_questions jsonb,
  p_model text,
  p_prompt_version text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Serialize concurrent regenerations for the same patient.
  perform pg_advisory_xact_lock(hashtextextended(p_patient_id::text, 42));
  update public.checkin_templates set status = 'superseded'
  where patient_id = p_patient_id and status = 'active';
  insert into public.checkin_templates (organization_id, patient_id, medication_fingerprint, source, questions, model, prompt_version, status)
  values ((select organization_id from public.patients where id = p_patient_id), p_patient_id, p_fingerprint, p_source, p_questions, p_model, p_prompt_version, 'active')
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.replace_checkin_template(uuid, text, text, jsonb, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.replace_checkin_template(uuid, text, text, jsonb, text, text) from anon, authenticated';
    execute 'grant execute on function public.replace_checkin_template(uuid, text, text, jsonb, text, text) to service_role';
  end if;
end;
$$;
