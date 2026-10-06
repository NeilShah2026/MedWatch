-- Two flag-engine runs for the same patient can overlap (DB trigger + web app call + cron).
-- The engine already dedupes, but only the database can make it race-proof: at most one
-- open/acknowledged flag per patient and dedupe key.
create unique index if not exists flags_active_dedupe
  on public.flags (patient_id, dedupe_key)
  where status in ('open', 'acknowledged');
