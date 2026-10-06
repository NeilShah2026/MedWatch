-- Background jobs (spec §8): pg_cron schedules and pg_net triggers that call Edge Functions.
-- The function base URL and CRON_SECRET live in Supabase Vault (fallback: a private table
-- when Vault is unavailable). They are written by `npm run secrets:sync`.
-- Everything here degrades to a no-op when pg_cron / pg_net / Vault are not installed.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema private from anon, authenticated';
  end if;
end;
$$;

-- Fallback store (only used when the Vault extension is missing).
create table if not exists private.function_config (
  id int primary key default 1 check (id = 1),
  base_url text,
  cron_secret text,
  updated_at timestamptz not null default now()
);
revoke all on private.function_config from public;

create or replace function private.vault_available()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from information_schema.views
    where table_schema = 'vault' and table_name = 'decrypted_secrets'
  )
$$;

create or replace function private.set_function_config(p_base_url text, p_cron_secret text)
returns void
language plpgsql
security definer
set search_path = private, public
as $$
declare
  v_id uuid;
begin
  if private.vault_available() then
    execute 'select id from vault.secrets where name = $1' into v_id using 'medwatch_functions_base_url';
    if v_id is null then
      execute 'select vault.create_secret($1, $2)' using p_base_url, 'medwatch_functions_base_url';
    else
      execute 'select vault.update_secret($1, $2)' using v_id, p_base_url;
    end if;
    v_id := null;
    execute 'select id from vault.secrets where name = $1' into v_id using 'medwatch_cron_secret';
    if v_id is null then
      execute 'select vault.create_secret($1, $2)' using p_cron_secret, 'medwatch_cron_secret';
    else
      execute 'select vault.update_secret($1, $2)' using v_id, p_cron_secret;
    end if;
  else
    insert into private.function_config (id, base_url, cron_secret, updated_at)
    values (1, p_base_url, p_cron_secret, now())
    on conflict (id) do update
      set base_url = excluded.base_url, cron_secret = excluded.cron_secret, updated_at = now();
  end if;
end;
$$;

create or replace function private.get_function_config(out base_url text, out cron_secret text)
language plpgsql
stable
security definer
set search_path = private, public
as $$
begin
  if private.vault_available() then
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
      into base_url using 'medwatch_functions_base_url';
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
      into cron_secret using 'medwatch_cron_secret';
  else
    select c.base_url, c.cron_secret into base_url, cron_secret
    from private.function_config c where c.id = 1;
  end if;
end;
$$;

-- Fire-and-forget POST to an Edge Function. Never raises: a failed call must not
-- block the user's write; hourly cron jobs catch anything missed.
create or replace function private.invoke_function(p_name text, p_body jsonb)
returns void
language plpgsql
security definer
set search_path = private, public
as $$
declare
  v_cfg record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;
  select * into v_cfg from private.get_function_config();
  if v_cfg.base_url is null or v_cfg.cron_secret is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    using
      v_cfg.base_url || '/' || p_name,
      p_body,
      jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_cfg.cron_secret);
exception
  when others then
    raise warning 'invoke_function % failed: %', p_name, sqlstate;
end;
$$;

revoke all on function private.set_function_config(text, text) from public;
revoke all on function private.get_function_config() from public;
revoke all on function private.invoke_function(text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- On-demand triggers
-- ---------------------------------------------------------------------------
-- Medication change → regenerate the tailored check-in (idempotent per fingerprint)
-- and re-run the flag engine for that patient.
create or replace function private.on_medication_change()
returns trigger
language plpgsql
security definer
set search_path = private, public
as $$
declare
  v_patient uuid;
begin
  -- Only user-initiated writes trigger calls; server jobs and seeding (service role or a
  -- direct database session) already run the engines themselves.
  if public.is_service_context() then
    return null;
  end if;
  if tg_op = 'DELETE' then
    v_patient := old.patient_id;
  else
    v_patient := new.patient_id;
  end if;
  perform private.invoke_function('tailor-checkin', jsonb_build_object('patient_id', v_patient));
  perform private.invoke_function('run-flag-engine', jsonb_build_object('patient_id', v_patient));
  return null;
end;
$$;

create trigger medications_after_change
  after insert or update or delete on public.medications
  for each row execute function private.on_medication_change();

-- Symptom log saved → run the flag engine for that patient.
create or replace function private.on_symptom_log()
returns trigger
language plpgsql
security definer
set search_path = private, public
as $$
begin
  if public.is_service_context() then
    return null;
  end if;
  perform private.invoke_function('run-flag-engine', jsonb_build_object('patient_id', new.patient_id));
  return null;
end;
$$;

create trigger symptom_logs_after_change
  after insert or update on public.symptom_logs
  for each row execute function private.on_symptom_log();

-- ---------------------------------------------------------------------------
-- Schedules (cron.schedule upserts by job name, so re-running is safe)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('medwatch-generate-doses', '5 * * * *',
      $job$select private.invoke_function('generate-doses', '{}'::jsonb)$job$);
    perform cron.schedule('medwatch-check-missed-doses', '*/10 * * * *',
      $job$select private.invoke_function('check-missed-doses', '{}'::jsonb)$job$);
    perform cron.schedule('medwatch-run-flag-engine', '20 * * * *',
      $job$select private.invoke_function('run-flag-engine', '{}'::jsonb)$job$);
    perform cron.schedule('medwatch-tailor-checkin-sweep', '30 7 * * *',
      $job$select private.invoke_function('tailor-checkin', '{"sweep": true}'::jsonb)$job$);
  end if;
end;
$$;
