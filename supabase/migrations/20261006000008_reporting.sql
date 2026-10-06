-- Reporting RPCs used by caseload lists and dashboards.
-- All are SECURITY INVOKER: they run with the caller's RLS, so each user only ever
-- aggregates rows they could read directly. Aggregating in SQL keeps dashboards fast and
-- avoids shipping thousands of dose rows to the browser.

create or replace function public.org_today()
returns date
language sql
stable
security invoker
set search_path = public
as $$
  select (now() at time zone coalesce(
    (select timezone from public.organizations where id = public.auth_org_id()),
    'America/New_York'
  ))::date
$$;

create or replace function public.org_timezone()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce((select timezone from public.organizations where id = public.auth_org_id()), 'America/New_York')
$$;

-- One row per visible patient: flag counts, 7-day reported adherence, check-in status,
-- and today's doses.
create or replace function public.patient_overview()
returns table (
  patient_id uuid,
  first_name text,
  last_name text,
  date_of_birth date,
  primary_nurse_id uuid,
  status text,
  last_visit_at timestamptz,
  open_high int,
  open_medium int,
  open_low int,
  adherence_7d numeric,
  given_7d int,
  total_7d int,
  last_checkin date,
  checkin_today boolean,
  doses_today_done int,
  doses_today_total int
)
language sql
stable
security invoker
set search_path = public
as $$
  with ctx as (
    select public.org_timezone() as tz, public.org_today() as today
  ),
  bounds as (
    select tz, today,
      (today::timestamp at time zone tz) as day_start,
      ((today + 1)::timestamp at time zone tz) as day_end
    from ctx
  )
  select
    p.id, p.first_name, p.last_name, p.date_of_birth, p.primary_nurse_id, p.status, p.last_visit_at,
    coalesce(f.high, 0), coalesce(f.medium, 0), coalesce(f.low, 0),
    case when coalesce(a.total, 0) > 0 then round(a.given::numeric / a.total, 4) end,
    coalesce(a.given, 0), coalesce(a.total, 0),
    s.last_checkin,
    coalesce(s.last_checkin = b.today, false),
    coalesce(t.done, 0), coalesce(t.total, 0)
  from public.patients p
  cross join bounds b
  left join lateral (
    select
      count(*) filter (where severity = 'high')::int as high,
      count(*) filter (where severity = 'medium')::int as medium,
      count(*) filter (where severity = 'low')::int as low
    from public.flags where patient_id = p.id and status = 'open'
  ) f on true
  left join lateral (
    select
      count(*) filter (where status = 'given')::int as given,
      count(*) filter (
        where status in ('given', 'missed', 'refused')
           or (status = 'skipped' and coalesce(btrim(note), '') = '')
      )::int as total
    from public.dose_events
    where patient_id = p.id and scheduled_for >= now() - interval '7 days' and scheduled_for <= now()
  ) a on true
  left join lateral (
    select max(logged_for_date) as last_checkin from public.symptom_logs where patient_id = p.id
  ) s on true
  left join lateral (
    select
      count(*) filter (where status in ('given', 'refused', 'skipped'))::int as done,
      count(*)::int as total
    from public.dose_events
    where patient_id = p.id and scheduled_for >= b.day_start and scheduled_for < b.day_end
  ) t on true
$$;

-- Daily dose outcomes for one patient (timeline lane 2).
create or replace function public.adherence_daily(p_patient_id uuid, p_start date, p_end date)
returns table (day date, given int, missed int, refused int, skipped int, pending int)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (d.scheduled_for at time zone public.org_timezone())::date as day,
    count(*) filter (where d.status = 'given')::int,
    count(*) filter (where d.status = 'missed')::int,
    count(*) filter (where d.status = 'refused')::int,
    count(*) filter (where d.status = 'skipped')::int,
    count(*) filter (where d.status = 'pending')::int
  from public.dose_events d
  where d.patient_id = p_patient_id
    and d.scheduled_for >= (p_start::timestamp at time zone public.org_timezone())
    and d.scheduled_for < ((p_end + 1)::timestamp at time zone public.org_timezone())
  group by 1
  order by 1
$$;

-- Org-wide daily reported adherence (admin dashboard trend).
create or replace function public.org_adherence_daily(p_start date, p_end date)
returns table (day date, given int, counted int)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (d.scheduled_for at time zone public.org_timezone())::date as day,
    count(*) filter (where d.status = 'given')::int,
    count(*) filter (
      where d.status in ('given', 'missed', 'refused')
         or (d.status = 'skipped' and coalesce(btrim(d.note), '') = '')
    )::int
  from public.dose_events d
  where d.scheduled_for >= (p_start::timestamp at time zone public.org_timezone())
    and d.scheduled_for < ((p_end + 1)::timestamp at time zone public.org_timezone())
    and d.scheduled_for <= now()
  group by 1
  order by 1
$$;

-- Flags created vs reviewed per ISO week (admin dashboard chart).
create or replace function public.flags_weekly(p_start date, p_end date)
returns table (week_start date, created int, reviewed int)
language sql
stable
security invoker
set search_path = public
as $$
  with weeks as (
    select generate_series(date_trunc('week', p_start::timestamp), date_trunc('week', p_end::timestamp), interval '1 week')::date as w
  )
  select
    w.w,
    (select count(*)::int from public.flags f
      where date_trunc('week', (f.created_at at time zone public.org_timezone()))::date = w.w),
    (select count(*)::int from public.flags f
      where f.reviewed_at is not null
        and date_trunc('week', (f.reviewed_at at time zone public.org_timezone()))::date = w.w)
  from weeks w
  order by w.w
$$;

-- Admin KPI cards.
create or replace function public.dashboard_kpis()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with active as (select id from public.patients where status = 'active'),
  adh as (
    select
      count(*) filter (where status = 'given') as given,
      count(*) filter (
        where status in ('given', 'missed', 'refused') or (status = 'skipped' and coalesce(btrim(note), '') = '')
      ) as total
    from public.dose_events
    where scheduled_for >= now() - interval '7 days' and scheduled_for <= now()
      and patient_id in (select id from active)
  ),
  fl as (
    select
      count(*) filter (where severity = 'high') as high,
      count(*) filter (where severity = 'medium') as medium,
      count(*) filter (where severity = 'low') as low
    from public.flags where status = 'open'
  ),
  rev as (
    select percentile_cont(0.5) within group (order by extract(epoch from (reviewed_at - created_at)) / 3600.0) as median_hours,
      count(*) as n
    from public.flags
    where reviewed_at is not null and reviewed_at >= now() - interval '30 days'
  ),
  ci as (
    select count(*) as done
    from public.symptom_logs
    where logged_for_date between public.org_today() - 7 and public.org_today() - 1
      and patient_id in (select id from active)
  )
  select jsonb_build_object(
    'active_patients', (select count(*) from active),
    'adherence_7d', jsonb_build_object('given', adh.given, 'total', adh.total,
      'rate', case when adh.total > 0 then round(adh.given::numeric / adh.total, 4) end),
    'open_flags', jsonb_build_object('high', fl.high, 'medium', fl.medium, 'low', fl.low),
    'median_review_hours_30d', case when rev.n > 0 then round(rev.median_hours::numeric, 1) end,
    'reviewed_30d', rev.n,
    'checkin_completion_7d', jsonb_build_object('done', ci.done, 'expected', (select count(*) from active) * 7,
      'rate', case when (select count(*) from active) > 0 then round(ci.done::numeric / ((select count(*) from active) * 7), 4) end)
  )
  from adh, fl, rev, ci
$$;

-- "Needs attention today": high flags, escalated missed doses (24h), no check-in in 2+ days.
create or replace function public.needs_attention()
returns table (
  patient_id uuid,
  first_name text,
  last_name text,
  high_flags int,
  escalations_24h int,
  last_checkin date,
  missing_checkin boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select * from (
    select
      p.id, p.first_name, p.last_name,
      (select count(*)::int from public.flags f where f.patient_id = p.id and f.status = 'open' and f.severity = 'high') as high_flags,
      (select count(distinct a.related_id)::int from public.alerts a
        where a.patient_id = p.id and a.alert_type = 'escalation' and a.sent_at >= now() - interval '24 hours') as escalations_24h,
      (select max(l.logged_for_date) from public.symptom_logs l where l.patient_id = p.id) as last_checkin,
      coalesce((select max(l.logged_for_date) from public.symptom_logs l where l.patient_id = p.id) < public.org_today() - 1, true) as missing_checkin
    from public.patients p
    where p.status = 'active'
  ) x
  where x.high_flags > 0 or x.escalations_24h > 0 or x.missing_checkin
  order by x.high_flags desc, x.escalations_24h desc, x.last_checkin nulls first
$$;

-- Pilot metrics for a date range (admin only).
create or replace function public.pilot_metrics(p_start date, p_end date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_from timestamptz := p_start::timestamp at time zone public.org_timezone();
  v_to timestamptz := (p_end + 1)::timestamp at time zone public.org_timezone();
  v_days int := (p_end - p_start) + 1;
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'from', p_start,
    'to', p_end,
    'flags_by_type_severity', coalesce((
      select jsonb_agg(jsonb_build_object('flag_type', flag_type, 'severity', severity, 'count', n) order by flag_type, severity)
      from (select flag_type, severity, count(*) n from public.flags
            where created_at >= v_from and created_at < v_to group by 1, 2) t
    ), '[]'::jsonb),
    'flags_created', (select count(*) from public.flags where created_at >= v_from and created_at < v_to),
    'flags_reviewed', (select count(*) from public.flags where reviewed_at >= v_from and reviewed_at < v_to),
    'median_review_hours', (
      select round((percentile_cont(0.5) within group (order by extract(epoch from (reviewed_at - created_at)) / 3600.0))::numeric, 1)
      from public.flags where reviewed_at >= v_from and reviewed_at < v_to
    ),
    'flags_escalated', (select count(*) from public.flags where status = 'escalated' and reviewed_at >= v_from and reviewed_at < v_to),
    'adherence', (
      select jsonb_build_object('given', given, 'total', total, 'rate', case when total > 0 then round(given::numeric / total, 4) end)
      from (
        select count(*) filter (where status = 'given') given,
          count(*) filter (where status in ('given', 'missed', 'refused') or (status = 'skipped' and coalesce(btrim(note), '') = '')) total
        from public.dose_events where scheduled_for >= v_from and scheduled_for < v_to and scheduled_for <= now()
      ) a
    ),
    'checkin_completion', (
      select jsonb_build_object('done', done, 'expected', expected, 'rate', case when expected > 0 then round(done::numeric / expected, 4) end)
      from (
        select
          (select count(*) from public.symptom_logs where logged_for_date between p_start and p_end) done,
          (select count(*) from public.patients where status = 'active') * v_days expected
      ) c
    ),
    'missed_dose_alerts', (select count(*) from public.alerts where alert_type = 'missed_dose' and sent_at >= v_from and sent_at < v_to),
    'escalation_alerts', (select count(*) from public.alerts where alert_type = 'escalation' and sent_at >= v_from and sent_at < v_to)
  ) into v;
  return v;
end;
$$;

-- Admin "AI check-ins" card: template sources and 7-day AI failure rate.
create or replace function public.ai_checkin_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'active_templates', jsonb_build_object(
      'ai', (select count(*) from public.checkin_templates where status = 'active' and source = 'ai'),
      'rules', (select count(*) from public.checkin_templates where status = 'active' and source = 'rules'),
      'default', (select count(*) from public.checkin_templates where status = 'active' and source = 'default')
    ),
    'ai_requests_7d', (select count(*) from public.ai_requests where created_at >= now() - interval '7 days'),
    'ai_failures_7d', (select count(*) from public.ai_requests where created_at >= now() - interval '7 days' and status <> 'success')
  )
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'org_today()', 'org_timezone()', 'patient_overview()', 'adherence_daily(uuid, date, date)',
    'org_adherence_daily(date, date)', 'flags_weekly(date, date)', 'dashboard_kpis()', 'needs_attention()',
    'pilot_metrics(date, date)', 'ai_checkin_stats()'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function public.%s from anon', f);
      execute format('grant execute on function public.%s to authenticated, service_role', f);
    end if;
  end loop;
end;
$$;
