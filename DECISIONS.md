# Decisions

One line of reasoning per ambiguous choice (spec §0.5).

- **Spec filename:** the repo shipped `BUILD_SEPC.md`; renamed to `BUILD_SPEC.md` to match the spec's own references.
- **Dependency versions:** pinned to stable majors (Vite 6, Vitest 3, ESLint 9, TypeScript 5.9, Tailwind 3, Recharts 2) rather than the newest majors, to keep the stack well-understood; React 18 and React Router 6 as the spec requires.
- **Secrets not visible in this session:** cloud environment variables added mid-session only reach new sessions, so cloud-only steps (`db:push`, seed, deploy, cloud RLS tests, E2E) are built and documented but run when the variables are present.
- **Local Postgres verification:** Postgres 16 is preinstalled in the sandbox, so migrations and RLS policies are additionally verified against a throwaway local cluster with a minimal Supabase `auth` shim (`npm run test:db:local`). This is a verification aid only; the cloud dev project remains the target (no Docker, no local Supabase stack).
- **`write-env.mjs` fallbacks:** accepts `SUPABASE_URL`/`SUPABASE_ANON_KEY` as aliases, derives `SUPABASE_DEV_PROJECT_REF` from the URL, defaults `APP_ENV=development`, `AI_ENABLED=false`, `AI_PROVIDER=mock`, `SMS_PROVIDER=console`, and generates a `CRON_SECRET` once (kept stable in `.env.functions`).
- **Function auth:** every Edge Function runs with `verify_jwt = false` and authenticates itself (cron secret header or `auth.getUser(token)`), so it works with both legacy JWT keys and the newer publishable/secret key format.
- **CSP `connect-src`:** `vercel.json` is static, so it allows `https://*.supabase.co` / `wss://*.supabase.co` rather than a single project URL; tighten to the production project URL when it exists.
- **Audit `changes` column:** stores only the names of changed columns (and `patient_id` on insert/delete), never values, so the audit trail does not duplicate PHI.
- **Org integrity triggers:** `organization_id` on patient-scoped rows is overwritten from the patient row, and referenced profiles must belong to the same org; RLS alone cannot stop a mismatched `organization_id` value.
- **Column guards:** patients/caregivers may only change dose confirmation fields (attribution forced to themselves, method forced to `patient_tap`/`caregiver_tap`); flag content is engine-owned and reviewers can only change review fields; dismiss needs a reason and escalate needs a note (enforced in the DB).
- **MFA in RLS:** staff with `mfa_required` must present an `aal2` JWT for any patient access (`mfa_satisfied()`), so the UI requirement is backed by the database.
- **`profiles.email`, `medications.purpose`, `invitations.full_name/invited_by`, `symptom_catalog.help_text/sort_order`:** small additions beyond §5 to support the Team page, "what it's for" on My medicines, invitation UX, and check-in help text.
- **Function config storage:** base URL and `CRON_SECRET` go to Supabase Vault via `private.set_function_config` (falls back to a private, non-exposed table if Vault is unavailable). pg_net calls never raise, so a failed trigger call cannot block a user's write; hourly cron catches misses.
