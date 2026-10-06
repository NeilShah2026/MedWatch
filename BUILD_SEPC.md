# MedWatch — Full Build Specification for Claude Code

> **This spec is written for Claude Code on the web (cloud sessions at claude.ai/code).** Put this file in an empty GitHub repo as `BUILD_SPEC.md`, start a cloud session on that repo, and say: "Read BUILD_SPEC.md and build it end to end, following its instructions exactly."
>
> **Before starting, configure the cloud environment** (environment selector at claude.ai/code):
> 1. **Environment variables** (pasted in `.env` format; never commit these to the repo): every variable listed in Section 14, including `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` so the Supabase CLI works without an interactive login.
> 2. **Network access:** the default "Trusted" level blocks domains outside its allowlist. Use a custom allowlist that adds `*.supabase.co`, `*.supabase.com`, `api.supabase.com`, and your AI gateway's domain (or use full access while building).
> 3. **Setup script:** `npm ci || npm install` once the repo has a lockfile; leave empty for the first session.

---

## 0. Your role and how to work

You are the sole engineer building **MedWatch** from scratch: a medication-safety web app for home health agencies caring for older adults on many medications. There is no existing code. Build the entire product described below in one continuous run.

### Operating instructions (follow these exactly)

1. **Read this entire spec before writing any code.** Then write `PLAN.md` that breaks the work into the phases in Section 12, with a checklist per phase.
2. **Work phase by phase, in order.** Do not start a phase until the previous phase passes its acceptance checks.
3. **After every phase:** run `npm run typecheck`, `npm run lint`, and `npm run test`. Fix every failure before moving on. Then `git commit` with a message like `phase 3: adherence engine`.
4. **Keep `PROGRESS.md` current.** After each phase, record what was built, what was tested, and anything left undone. If the session is interrupted, a new session must be able to resume from `PROGRESS.md` alone.
5. **Do not stop to ask me questions.** When something is ambiguous, choose the simplest reasonable option that respects the Hard Rules, and log it in `DECISIONS.md` with one line of reasoning.
6. **Never skip tests to save time.** Tests for the flag engine, adherence engine, and security policies are mandatory.
7. **You are running in a cloud sandbox (Claude Code on the web).** This changes how you work:
   - **Commit and push after every phase** (and at least every hour of work) to the session branch, so progress survives if the session ends. Never force-push.
   - **Secrets come from environment variables,** not files. At the start of Phase 1, write `scripts/write-env.mjs` that generates the gitignored `.env` and `.env.functions` from `process.env`, and run it at the start of every session. Fail with a clear list of anything missing.
   - **Everything must be non-interactive.** Use `npx supabase` with `SUPABASE_ACCESS_TOKEN` for auth, `npx supabase link --project-ref "$SUPABASE_DEV_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"`, and pass `--yes`/`--non-interactive` style flags wherever a command might prompt.
   - **No Docker or local Supabase.** All database work targets the cloud dev project.
   - **If a network call is blocked** (a domain not on the allowlist), record the exact domain in `PROGRESS.md` under "Blocked by network", keep building everything that doesn't need it, and list it in the final report so I can add it to the allowlist.
   - **Playwright:** run `npx playwright install --with-deps chromium`. If browsers can't install in the sandbox, write all E2E tests anyway, mark them "not run in sandbox" in `PROGRESS.md`, and continue.
   - **Resuming:** if you start a session and `PROGRESS.md` exists, read it and this spec, run `scripts/write-env.mjs`, and continue from the first unfinished phase. Do not redo finished phases.
8. **At the very end,** write `README.md` (setup, run, test, seed, deploy) and a `FINAL_REPORT.md` listing: everything built, every test suite and its result, known gaps, and what a human must review before real patients use it.

---

## 1. Hard rules (never violate)

1. **Synthetic data only.** Never add real patient information anywhere: code, tests, seed data, comments, or fixtures. All seed people are fictional.
2. **Clinical language.** The app never diagnoses or recommends treatment. Every flag is framed as **"for clinician review."** Banned words in any user-facing string: `diagnose`, `diagnosis`, `stop taking`, `reduce dose`, `increase dose`, `you have`, `you should take`, `prescribe`. Add an automated test (Section 11) that fails the build if any banned phrase appears in `src/`.
3. **Every table holding patient data has row-level security (RLS)** scoped by `organization_id`. No exceptions. Users can never read another organization's data.
4. **Never log protected health information (PHI)**, meaning names, birthdates, medications, symptoms, or notes, to the console, error trackers, analytics, or URLs. Use IDs only.
5. **Clinical rules live in data, not code.** Rule content goes in `/rules/*.json`, loaded and validated at runtime. Every rule file carries `"status": "PLACEHOLDER_REQUIRES_CLINICAL_REVIEW"` until a clinician approves it.
6. **Do not copy proprietary clinical content.** Do not reproduce the AGS Beers Criteria tables, First Databank, Lexicomp, or any licensed database. Write a small, illustrative, original rule set clearly marked as placeholder. Public data such as OpenFDA may be used within its terms.
7. **Show a persistent banner in every non-production environment:** "Demo environment — synthetic data only. Not for clinical use."
8. **AI shapes questions, never conclusions.** The AI model (Section 7.5) may only choose and word symptom check-in questions from the existing symptom catalog. It never creates, scores, edits, or dismisses flags, never writes explanations shown as clinical findings, and never sees symptom answers. The flag engine stays fully deterministic.
9. **AI calls run server-side only.** The AI gateway URL and key live in Supabase Edge Function secrets, never in the browser bundle or any `VITE_` variable. Send only what the prompt needs: medication names, drug classes, and patient age band (e.g. "80–89"). Never send names, birthdates, contact details, or notes.
10. **The database is a cloud Supabase project.** Destructive scripts (`db:reset`, `seed`) must refuse to run unless `APP_ENV` is `local` or `development` **and** the project ref matches `SUPABASE_DEV_PROJECT_REF`. Print the target project and require a `--yes` flag before wiping anything.

---

## 2. Product summary

MedWatch helps a home health agency catch medication problems early. It:

- Tracks each client's medication list and every change to it (start, stop, dose change).
- Tracks adherence: was each scheduled dose given, and who confirmed it.
- Collects a 30-second daily symptom check-in.
- Runs a **flag engine** that notices when a new or worsening symptom follows a medication change, or when a medication carries a known risk for older adults. It explains each flag in plain language and routes it to a nurse for review.
- Generates a **one-page visit summary** for the clinician.
- Gives the director of nursing an **agency dashboard**: who needs attention today, open flags by severity, adherence by client.

**Primary buyer:** the director of nursing (DON) or owner of a Medicare-certified home health agency.
**Value to prove:** fewer rehospitalizations, nurse time saved, earlier warning of side effects.

---

## 3. Tech stack (use exactly this)

| Layer | Choice |
| --- | --- |
| Frontend | React 18 + Vite + TypeScript (strict mode) |
| Styling | Tailwind CSS with a custom theme (Section 9) |
| Routing | React Router v6 |
| Server state | TanStack Query |
| Forms and validation | React Hook Form + Zod |
| Charts | Recharts |
| PDF | `@react-pdf/renderer` |
| Backend | Supabase: Postgres, Auth, RLS, Edge Functions (Deno), `pg_cron` |
| Database host | **Cloud Supabase** (hosted project, not local Docker). Use one project for development with synthetic data (`SUPABASE_DEV_PROJECT_REF`); a separate production project is created later. Manage schema with the Supabase CLI via `npx supabase link` and `npx supabase db push`. |
| Frontend hosting | **Vercel** (static Vite build). Include `vercel.json` with SPA rewrites to `index.html` and security headers (Section 14). |
| Shared logic | `packages/core` — pure TypeScript engines used by both frontend and Edge Functions |
| AI | Claude Sonnet through a user-provided gateway, called only from a Supabase Edge Function via an `AiProvider` interface (Section 7.5) |
| SMS | Provider interface with a `ConsoleSmsProvider` (default, dev) and a `TwilioSmsProvider` (disabled unless env vars present) |
| Unit tests | Vitest |
| E2E tests | Playwright |
| Lint and format | ESLint + Prettier |

### Repository layout

```
/
├─ apps/web/                 # React app
│  ├─ src/
│  │  ├─ app/                # routes, layout, providers
│  │  ├─ features/           # one folder per feature (patients, meds, doses, symptoms, flags, summary, dashboard, admin, auth)
│  │  ├─ components/ui/      # design-system components
│  │  ├─ lib/                # supabase client, query keys, formatting
│  │  └─ copy/               # ALL user-facing strings live here (enables the wording test)
│  └─ e2e/                   # Playwright tests
├─ packages/core/            # flag engine, adherence engine, summary builder, rule loader (pure TS, no I/O)
├─ rules/                    # clinical rule JSON files + JSON Schemas
├─ supabase/
│  ├─ migrations/            # SQL schema, RLS, triggers, cron
│  ├─ functions/             # edge functions
│  └─ seed/                  # synthetic data generator
├─ docs/                     # ARCHITECTURE.md, DATA_MODEL.md, SECURITY.md, CLINICAL_RULES.md
├─ PLAN.md  PROGRESS.md  DECISIONS.md  README.md  FINAL_REPORT.md
```

Use npm workspaces. Root scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `db:push` (apply migrations to the linked cloud project), `db:reset` (wipe and reseed the **dev** cloud project only, guarded per Hard Rule 10), `seed`, `functions:deploy` (deploy all Edge Functions), `secrets:sync` (push Edge Function secrets from `.env.functions` via `supabase secrets set`).

Docker is not required. All database work targets the cloud dev project.

---

## 4. Roles and permissions

| Role | Who | Can do |
| --- | --- | --- |
| `patient` | The older adult | See own meds and today's doses, mark own doses taken, do own symptom check-in, see own summary |
| `caregiver` | Family member or aide | For linked patients only: confirm doses, do check-ins on the patient's behalf, receive missed-dose alerts, view flags (read-only) and summaries |
| `nurse` | Agency clinician | For patients on their caseload: everything a caregiver can, plus edit medications, record medication changes, review flags (acknowledge, dismiss, escalate, add a note), generate visit summaries |
| `agency_admin` | DON or owner | Everything a nurse can for all patients in the org, plus the agency dashboard, user invites and roles, caseload assignment, org settings, audit log viewer, pilot metrics export |

Enforce permissions **in the database via RLS** and mirror them in the UI (hide what a user cannot do). UI checks are convenience; RLS is the security boundary.

---

## 5. Data model

Create these tables in SQL migrations. Use `uuid` primary keys (`gen_random_uuid()`), `created_at`/`updated_at` timestamps (`timestamptz`, default `now()`), and an `updated_at` trigger on every table. Every patient-data table carries `organization_id` for RLS.

### organizations
`id, name, timezone (default 'America/New_York'), settings jsonb`
`settings` holds: `missed_dose_grace_minutes` (default 60), `agency_escalation_minutes` (default 120), `flag_min_severity_for_alert` (default `'medium'`), `flag_dedupe_hours` (default 72), `session_timeout_minutes` (default 15).

### profiles
`id (= auth.users.id), organization_id, role, full_name, phone, sms_opt_in boolean default false, sms_opt_in_at, mfa_required boolean, is_active`

### patients
`id, organization_id, first_name, last_name, date_of_birth, primary_nurse_id → profiles, notes, status ('active'|'discharged'), last_visit_at`

### patient_links
Connects caregivers and patient-users to patients. `id, organization_id, patient_id, profile_id, relationship ('self'|'caregiver')`

### caseload_assignments
`id, organization_id, nurse_id, patient_id`

### consents
`id, organization_id, patient_id, consent_type ('data_use'|'sms'|'caregiver_access'), granted_by_name, granted_by_relationship, granted_at, revoked_at, document_version`

### medications
`id, organization_id, patient_id, name, generic_name, drug_class, dose_amount, dose_unit, route, frequency_label, schedule_times text[] (e.g. ['08:00','20:00']), prn boolean, start_date, end_date, status ('active'|'stopped'), prescriber_name`

### medication_changes
Immutable history. `id, organization_id, patient_id, medication_id, change_type ('started'|'stopped'|'dose_increased'|'dose_decreased'|'schedule_changed'), previous jsonb, current jsonb, effective_date, recorded_by`

### dose_events
One row per expected dose. `id, organization_id, patient_id, medication_id, scheduled_for timestamptz, status ('pending'|'given'|'missed'|'skipped'|'refused'), confirmed_at, confirmed_by, confirmation_method ('patient_tap'|'caregiver_tap'|'nurse'|'system'), verification ('reported'|'verified') default 'reported', note`
Unique on `(medication_id, scheduled_for)`.

### symptom_logs
`id, organization_id, patient_id, logged_for_date, logged_by, entries jsonb` — array of `{ symptom_code, severity 0–3 }` — plus `overall_feeling (1–5), free_text`
Unique on `(patient_id, logged_for_date)` (edits update the row and append to audit log).

### checkin_templates
The tailored check-in form for one patient. `id, organization_id, patient_id, medication_fingerprint (hash of sorted active medication ids + doses + drug classes), source ('ai'|'rules'|'default'), questions jsonb, model, prompt_version, status ('active'|'superseded'), created_at`
`questions` is an ordered array of `{ symptom_code, question_text, help_text, reason_medication_ids[], is_core boolean }`. Exactly one `active` template per patient.

### ai_requests
Metadata only, for cost and reliability tracking. **No prompt or response bodies.** `id, organization_id, patient_id, purpose ('checkin_template'), model, status ('success'|'invalid_output'|'error'|'timeout'), latency_ms, input_tokens, output_tokens, created_at`

### symptom_catalog (reference, not PHI)
`code, label, plain_label, category`. Seed about 20 symptoms older adults commonly report: dizziness, drowsiness, confusion, fall or near-fall, nausea, constipation, diarrhea, dry mouth, headache, fatigue, low appetite, swelling in legs, shortness of breath, cough, rash, bruising or bleeding, muscle pain, trouble sleeping, low mood, urinary problems. Add an `is_core boolean` column: `fall_or_near_fall`, `confusion`, `dizziness`, and `shortness_of_breath` are core and appear on every patient's form regardless of tailoring.

### flags
`id, organization_id, patient_id, flag_type ('temporal_correlation'|'medication_risk'|'interaction'|'adherence'), severity ('low'|'medium'|'high'), status ('open'|'acknowledged'|'dismissed'|'escalated'), title, explanation (plain language), evidence jsonb (linked medication_change ids, dose_event ids, symptom_log ids, rule id), rule_id, dedupe_key, reviewed_by, reviewed_at, review_note`

### alerts
`id, organization_id, patient_id, recipient_profile_id, channel ('in_app'|'sms'), alert_type ('missed_dose'|'flag'|'escalation'), related_id, sent_at, read_at, delivery_status`

### visit_summaries
`id, organization_id, patient_id, generated_by, period_start, period_end, content jsonb, created_at`

### audit_log
Append-only. `id, organization_id, actor_id, action ('view'|'create'|'update'|'delete'|'export'|'login'), entity_type, entity_id, changes jsonb, created_at`
No UPDATE or DELETE allowed for anyone (enforce with RLS plus a trigger that raises an exception).

### invitations
`id, organization_id, email, role, patient_id (nullable, for caregivers), token_hash, expires_at, accepted_at`

### Indexes
On every `organization_id`, every `patient_id`, `dose_events(scheduled_for, status)`, `flags(organization_id, status, severity)`, `symptom_logs(patient_id, logged_for_date)`.

Document the full schema with an entity diagram (Mermaid) in `docs/DATA_MODEL.md`.

---

## 6. Security and RLS

1. Create SQL helper functions: `auth_org_id()`, `auth_role()`, `can_access_patient(patient_id)`.
   - `agency_admin`: any patient in their org.
   - `nurse`: patients in `caseload_assignments` for them.
   - `caregiver` / `patient`: patients in `patient_links` for them.
2. Every patient-data table: SELECT/INSERT/UPDATE/DELETE policies built on these helpers. Patients and caregivers cannot edit medications or review flags.
3. **Audit triggers** on all patient-data tables write to `audit_log` on insert, update, and delete. Frontend calls a `log_view(entity_type, entity_id)` RPC when a patient record or summary is opened. Exports (PDF, CSV) are logged as `export`.
4. **Auth:** Supabase email + password. Require TOTP MFA for `nurse` and `agency_admin` (setting `mfa_required`). Idle session timeout from org settings: warn at 1 minute remaining, then sign out.
5. **Invitations:** admins invite by email; token stored hashed; expires in 7 days. Send invite emails through Supabase Auth's email. When `APP_ENV` is `development`, also print the invite link to the script/function log (never the patient's details) so testing doesn't depend on email delivery.
6. **Data rights:** admin can export everything for one patient as JSON, and soft-delete (discharge) or hard-delete a patient with a confirmation step; both logged.
7. Write `docs/SECURITY.md` explaining each control and listing what must be done before production (BAA with Supabase and SMS vendor, HIPAA add-on, backups, penetration test, attorney review).

---

## 7. Engines (in `packages/core`, pure TypeScript, fully unit-tested)

### 7.1 Rule loader
- Load `/rules/medication_risks.json`, `/rules/interactions.json`, `/rules/side_effect_associations.json`.
- Validate each against a JSON Schema (Zod) at load. Invalid file → throw a clear error.
- Each rule: `id, version, status, description, source_note, severity`, plus type-specific fields.

**`medication_risks.json`** — about 10 original illustrative rules keyed by `drug_class`, e.g. sedative-hypnotics, first-generation antihistamines, anticholinergics, long-acting sulfonylureas, NSAIDs (long-term), muscle relaxants, benzodiazepines, antipsychotics, opioids, proton pump inhibitors (long-term). Each has `risk_summary` in plain language (e.g. "This kind of medicine can raise fall risk in older adults") and `severity`.

**`interactions.json`** — about 8 illustrative class-pair rules (e.g. two CNS depressants together; anticoagulant + NSAID; multiple anticholinergics).

**`side_effect_associations.json`** — maps `drug_class` → list of `{ symptom_code, typical_onset_days_min, typical_onset_days_max }`. About 15 classes.

All files: `"status": "PLACEHOLDER_REQUIRES_CLINICAL_REVIEW"`. Write `docs/CLINICAL_RULES.md` explaining the format so a clinician can review and edit rules without reading code.

### 7.2 Adherence engine
- `generateExpectedDoses(medications, date, timezone)` → dose_event drafts for that day from `schedule_times` (skip `prn`, respect `start_date`/`end_date`).
- `evaluateMissedDoses(doseEvents, now, settings)` → which pending doses become `missed` (past `scheduled_for + grace`) and which need agency escalation (past `scheduled_for + agency_escalation_minutes` and still unconfirmed).
- `adherenceRate(doseEvents, period)` → given ÷ (given + missed + refused), excluding `skipped` with a note and future doses. Return also counts and a "reported" label.
- Handle timezones and daylight saving correctly. Test across a DST boundary.

### 7.3 Flag engine
`runFlagEngine({ patient, medications, medicationChanges, doseEvents, symptomLogs, existingFlags, rules, settings, now })` → `FlagDraft[]`.

Generate four flag types:

1. **Temporal correlation.** For each symptom that is **new** (not present in the prior 7 days of logs) or **worsened** (severity up by ≥1 versus the prior 7-day max) on day D:
   - Look back for medication changes within 1–14 days before D.
   - Score each candidate: +3 if the drug class has an association with that symptom in `side_effect_associations` **and** D falls in its onset window; +1 if associated but outside the window; +2 if the doses of that medication in the window were mostly `given` (≥80%); −2 if they were mostly missed (then the explanation must mention the missed doses); +1 if severity ≥2; +1 if symptom is `fall_or_near_fall` or `confusion`.
   - Severity: score ≥6 high, 4–5 medium, 2–3 low, below 2 no flag.
   - Explanation template: *"Dizziness started 3 days after [medication] was started on [date]. Doses were reported taken 6 of 6 times. Dizziness is a recognized possible effect of this type of medicine. For clinician review."*
2. **Medication risk.** On any active medication whose `drug_class` matches a `medication_risks` rule: one flag per patient per rule (dedupe), using the rule's plain-language summary plus "For clinician review."
3. **Interaction.** When two active meds match an interaction pair rule.
4. **Adherence.** When a medication's adherence over the last 7 days drops below 70%, or 3+ consecutive missed doses.

Rules for every flag:
- Build a stable `dedupe_key` (e.g. `type:patient:rule:medication:symptom`). Do not create a new flag if an open or acknowledged flag with the same key exists within `flag_dedupe_hours`. Worsening may upgrade severity of the existing flag instead.
- `evidence` must list the exact IDs used, so the UI can show "why."
- Output must pass the banned-wording check.
- Deterministic: same inputs → same outputs. No randomness, no network calls.

### 7.4 Visit summary builder
`buildVisitSummary({ patient, period, ... })` returns structured content:
- Header: patient name, age, period covered, generated date, generated by.
- Medication changes in period (table).
- Current medication list.
- Adherence: overall rate plus per medication, labeled "reported."
- Symptom trends: top symptoms with first-seen date and trajectory (better / same / worse).
- Flags: open and reviewed in period, with status and reviewer notes.
- "Questions for the clinician" — generated from open flags, phrased as questions (e.g. "Dizziness began after [med] was started. Is this worth reviewing?").
- Footer: "Generated by MedWatch for clinician review. Not a diagnosis. Adherence is caregiver/patient-reported."

Must fit on one printed page for a typical patient (truncate long lists with "+N more").

### 7.5 Tailored symptom check-in (AI with rules fallback)

**Goal:** each patient's daily check-in asks about the symptoms most relevant to the medicines they actually take, instead of a generic form.

**Two builders, one output shape.** Both return `CheckinQuestion[]` (shape in Section 5, `checkin_templates.questions`).

1. **`buildRulesCheckin(medications, catalog, rules)`** — pure function in `packages/core`. Uses `side_effect_associations.json` to collect symptoms linked to each active medication's drug class, ranks them by number of medications pointing to them, adds all core symptoms, caps at 10 questions, and uses the catalog's `plain_label` for wording. Deterministic and fully unit-tested. This is the fallback and the baseline.
2. **AI builder** — runs in the `tailor-checkin` Edge Function (Section 8):
   - Input sent to the model: active medication names, generic names, drug classes, dose changes in the last 14 days, the patient's age band, the full symptom catalog (codes and labels), and the rules-based draft from builder 1. Nothing else (Hard Rule 9).
   - System prompt (store in `supabase/functions/_shared/prompts/checkin_v1.ts` with a `PROMPT_VERSION` constant): the model is helping build a short daily check-in for an older adult; it must choose 6–10 symptoms **only from the provided catalog codes**; prioritize symptoms linked to recently started or changed medications; write each question in plain, warm language at about a 5th-grade reading level, under 12 words, as a yes/no question (e.g. "Have you felt dizzy or unsteady today?"); give a short `help_text` example of what counts; list which medication ids make each question relevant; never mention diagnoses, never say a medicine causes anything, never give advice. Respond with JSON only, matching the schema, no prose and no code fences.
   - Call through the `AiProvider` interface (below) with temperature 0 and a 15-second timeout.
   - **Validate** the response with Zod: parse JSON (strip stray code fences first), every `symptom_code` must exist in the catalog, 6–10 items, no duplicates, question length limits, and every `question_text` and `help_text` must pass the banned-wording check. Then **force-merge core symptoms** (`is_core = true`) if the model left any out.
   - On any failure (gateway down, timeout, invalid JSON, validation failure): retry once, then save the rules-based template with `source = 'rules'`. The patient must never see an error or an empty form.
   - Record one `ai_requests` row per call (metadata only).

**When templates regenerate.** Compute `medication_fingerprint` whenever medications change. If it differs from the active template's fingerprint, enqueue regeneration (DB trigger on `medications` → call `tailor-checkin` via `pg_net`, or the frontend calls it after a medication save). The old template is marked `superseded`. Never regenerate daily; the same form day to day keeps symptom trends comparable. A nurse can also press "Regenerate check-in" on the patient's Medications tab.

**`AiProvider` interface** (`supabase/functions/_shared/ai/`):
- `AnthropicGatewayProvider`: POST to `${AI_GATEWAY_URL}/v1/messages` in Anthropic Messages API format, model from `AI_MODEL` (default `claude-sonnet-5-5`), auth header name from `AI_GATEWAY_AUTH_HEADER` (default `x-api-key`) with value `AI_GATEWAY_API_KEY`, plus `anthropic-version: 2023-06-01`. If the gateway turns out to use a different format, adapt only this class and log it in `DECISIONS.md`.
- `MockAiProvider`: returns a fixed valid response, or invalid ones on demand, for tests.
- Selected by `AI_PROVIDER` (`gateway` | `mock`, default `mock`). If `AI_ENABLED` is not `true`, skip AI entirely and use the rules builder.
- Never log request or response bodies; log only status, latency, and token counts.

**In the UI:**
- The patient and caregiver check-in screens render the active template's questions in order: core questions first, then tailored ones, then "Anything else bothering you?" which opens the full catalog grid, then the free-text note. Each answered question still records severity 1–3, so `symptom_logs.entries` keeps the same shape and the flag engine is unchanged.
- The nurse sees, on the Medications tab, which template is active (AI or rules), when it was made, and for each question which medicines it relates to ("Asked because of: [medicine]"). Patients do not see the "because of" link, to avoid suggesting a medicine is causing anything.
- Admin dashboard shows a small "AI check-ins" card: share of active templates from AI vs rules, and AI failure rate over 7 days.

---

## 8. Backend jobs (Supabase Edge Functions + pg_cron)

| Job | Schedule | What it does |
| --- | --- | --- |
| `generate-doses` | Daily at 00:05 org local time (run hourly, act on orgs whose local time just passed midnight) | Creates tomorrow's and today's missing `dose_events` (idempotent via unique constraint) |
| `check-missed-doses` | Every 10 minutes | Marks missed doses; sends caregiver alert at grace; sends agency escalation at escalation threshold; no duplicate alerts |
| `run-flag-engine` | Every hour, plus on demand after a symptom log or medication change is saved (DB trigger → `pg_net` call, or frontend calls function after save) | Runs `packages/core` flag engine per affected patient, inserts new flags, creates alerts for flags ≥ org threshold |
| `send-alert` | Called by others | Delivers in-app alert; SMS only if recipient `sms_opt_in = true` and a valid SMS consent exists; uses provider interface |
| `tailor-checkin` | On medication change (trigger), on nurse request, and a nightly sweep for any patient missing an active template | Builds the tailored check-in per Section 7.5; falls back to rules on any failure; idempotent per fingerprint (same fingerprint → no new call) |

Edge functions import from `packages/core` (configure the import map). They use the service role key server-side only, never in the browser. Each job must be safe to run twice (idempotent).

**Cloud setup notes:** enable the `pg_cron` and `pg_net` extensions in a migration. Store the Edge Function base URL and a shared `CRON_SECRET` in Supabase Vault or as function secrets; cron-invoked functions reject requests without that secret. Edge Function secrets (`SUPABASE_SERVICE_ROLE_KEY`, `AI_*`, `TWILIO_*`, `CRON_SECRET`) are set with `supabase secrets set`, never committed. Add a rate limit on `tailor-checkin` (max 3 AI calls per patient per hour) to cap costs.

---

## 9. Design system and UX

**Audience:** older adults and tired caregivers on phones; nurses and admins on laptops. Plain language, large targets, calm visuals.

- **Palette (soft, professional, warm):**
  - Primary: deep teal `#2F6F73`; primary-light `#E3F0EF`
  - Accent: warm sand `#D9A86C`
  - Background: warm off-white `#FAF7F2`; surface white `#FFFFFF`
  - Text: charcoal `#2B2B2B`; muted `#6B6B6B`
  - Severity: high `#B4483C` (muted red), medium `#C98A2E` (amber), low `#5A7FA6` (soft blue). Always pair color with a text label and icon — never color alone.
- **Typography:** Inter or system UI. Base 18px for patient and caregiver views, 16px for nurse and admin. Line height 1.5.
- **Touch targets:** at least 48×48px. Primary actions full-width on mobile.
- **Accessibility:** WCAG 2.1 AA contrast, full keyboard navigation, visible focus rings, ARIA labels, respects reduced-motion. Run `@axe-core/playwright` in E2E on every main page.
- **Tone:** short sentences, no jargon on patient/caregiver screens ("medicine," not "medication regimen"). All strings in `src/copy/`.
- **Empty, loading, and error states** for every screen. Errors never show PHI or stack traces.
- **Responsive:** patient/caregiver mobile-first; nurse/admin desktop-first but usable on tablet.

---

## 10. Screens and features

### Shared
- Sign in, MFA setup and challenge, accept invitation, forgot password, session-timeout warning modal, sign out.
- Top bar with role-appropriate navigation, the demo banner, and an alerts bell (unread count, list, mark read).

### Patient (`/me`)
1. **Today:** large cards for each dose due today, in time order, each with "I took it" button (and "Not taken" with optional reason). Shows done/remaining count.
2. **How are you today?** The 30-second check-in: overall feeling (5 large faces with text labels), then the patient's **tailored questions** from their active check-in template (Section 7.5), one per screen on mobile, each with large Yes / No buttons; a "Yes" asks "How much?" (A little / Some / A lot = severity 1–3). Then "Anything else bothering you?" opens the full catalog grid. Optional note. Confirmation screen. Editable the same day. If no template exists yet, use the rules-based builder in the browser as a fallback.
3. **My medicines:** simple list with name, what it's for (if entered), and when to take it. Read-only.

### Caregiver (`/care`)
1. **My people:** list of linked patients with today's status (doses done x/y, check-in done or not, open flags count).
2. Patient view with tabs: **Today** (confirm doses on their behalf, labeled "confirmed by caregiver"), **Check-in** (on their behalf), **Medicines** (read-only), **Flags** (read-only, with explanation), **Summary** (view/download latest).
3. Alerts for missed doses.

### Nurse (`/clinic`)
1. **My caseload:** table of patients sortable by open flag severity, adherence (7-day), last check-in, last visit. Row highlight if any high flag.
2. **Patient detail:**
   - Header: name, age, primary nurse, key counts.
   - **Timeline chart (the signature feature):** horizontal time axis (last 30 days, adjustable 7/30/90). Lane 1: medication change markers (start/stop/dose change) with labels. Lane 2: adherence per day (stacked given/missed). Lane 3: symptom severity lines for the top 3–5 symptoms. Flags appear as markers; clicking one highlights its evidence across lanes.
   - **Medications tab:** add/edit/stop medications; every edit asks for change type and effective date and writes a `medication_changes` row. Drug class chosen from the list used in rules (with "Other").
   - **Flags tab:** list with severity, title, explanation, "Why?" expander that shows the evidence (the specific change, doses, symptom logs). Actions: Acknowledge, Dismiss (requires reason), Escalate (requires note), each recorded with reviewer and time.
   - **Doses tab:** dose history with filters; nurse can correct a dose status (logged).
   - **Symptoms tab:** history table and per-symptom trend.
   - **Summary tab:** choose period (default: since last visit), preview, generate PDF, history of past summaries. "Record visit" button sets `last_visit_at`.
   - **People tab:** linked caregivers, consents on file (add/revoke).
3. **Flag inbox:** all open flags across caseload, sorted by severity then age.

### Agency admin (`/admin`)
1. **Dashboard:**
   - "Needs attention today" list: patients with high flags, escalated missed doses, or no check-in in 2+ days. Each row has a one-line reason.
   - KPI cards: active patients, 7-day adherence (reported), open flags by severity, median time from flag to review, check-in completion rate.
   - Charts: adherence trend (30 days), flags created vs reviewed per week.
2. **Patients:** add patient (with required data-use consent capture), assign primary nurse and caseload, link caregivers, discharge.
3. **Team:** invite users, set roles, deactivate users, require MFA.
4. **Settings:** the org settings in Section 5, with explanations.
5. **Audit log:** filterable by user, patient, action, date; export CSV (export itself logged).
6. **Pilot metrics:** for a chosen date range, export CSV and show: flags by type and severity, flags reviewed and median review time, flags marked "escalated," adherence rate, check-in completion, missed-dose alerts sent. Include a short printable "Pilot report" page.

### Static pages
Privacy policy and Terms of Use placeholders (clearly marked "DRAFT — requires attorney review"), and an "About the flags" page explaining in plain language that flags are prompts for clinician review, not medical advice.

---

## 11. Testing (mandatory)

### Unit (Vitest, `packages/core`) — aim for 90%+ coverage of core
- Adherence: dose generation, PRN skipped, start/end dates, DST boundary, grace and escalation thresholds, adherence rate math.
- Flag engine: one test per scoring rule; new vs worsened symptom detection; onset window in/out; mostly-missed doses lowers score and changes explanation; dedupe within window; severity upgrade; deterministic output; medication risk, interaction, and adherence flags; every explanation ends with "For clinician review."
- Rule loader: valid files load, invalid files throw clear errors.
- Summary builder: correct sections, truncation, footer present.
- Rules check-in builder: correct symptoms per drug class, core symptoms always present, cap of 10, deterministic.

### AI tailoring (Vitest with `MockAiProvider`; never calls the real gateway in automated tests)
- Valid response → template saved with `source = 'ai'`, core symptoms merged in.
- Unknown symptom code, duplicates, too few/many items, banned words, malformed JSON, JSON inside code fences, timeout, HTTP 500 → each case falls back to `source = 'rules'` and the patient form still renders.
- Same medication fingerprint → no new AI call.
- The request body sent to the provider contains no name, birthdate, phone, email, or notes (assert on the captured request).
- No `VITE_` variable contains any AI key (scan the built bundle in `dist/` for the key's env var name and value patterns).
- `ai_requests` rows contain no prompt or response text.
- Add a manual script `npm run ai:smoke` (not part of CI) that sends one synthetic medication list through the real gateway and prints the validated result, for checking the gateway works.

### Database (Vitest against the cloud **dev** project, using supabase-js clients signed in as each seeded role)
- For each role, prove it **can** access what it should and **cannot** access another org's patients, other nurses' caseloads (for nurses), or unlinked patients (for caregivers).
- Patients/caregivers cannot update medications or flags.
- `audit_log` rejects UPDATE and DELETE.
- Audit rows are written on insert/update/delete.

### Wording test
A test that scans `apps/web/src`, `packages/core/src`, and `rules/` for banned phrases (Hard Rule 2) and fails if any appear in user-facing strings.

### PHI logging test
A test or lint rule that fails if `console.log`/`console.error` is called with patient objects in `apps/web/src` (e.g. ESLint `no-console` except a safe `logger` that only accepts IDs).

### End-to-end (Playwright, against the cloud dev project with seed data and `AI_PROVIDER=mock`)
1. Patient signs in, marks a dose taken, completes a check-in that shows their tailored questions.
1b. Nurse starts a new medication → the patient's check-in template regenerates and now includes a question related to that medicine.
2. Caregiver confirms a dose for a linked patient and cannot open an unlinked patient by URL.
3. Nurse starts a new medication; patient logs a matching symptom 3 days later (use a test clock or seeded dates); flag engine runs; nurse sees the flag with evidence and acknowledges it.
4. Missed dose → caregiver alert → agency escalation.
5. Nurse generates a visit summary PDF.
6. Admin views dashboard, invites a user, exports pilot metrics; audit log shows the export.
7. Session timeout signs the user out.
8. Axe accessibility check passes on each main page.

---

## 12. Build phases and acceptance checks

| Phase | Build | Done when |
| --- | --- | --- |
| 1. Scaffold | Monorepo, Vite app, Tailwind theme, ESLint/Prettier, Vitest, Playwright, Supabase CLI linked to the cloud dev project, `vercel.json`, scripts, docs skeleton, demo banner | `npm run dev` shows a styled shell connected to the cloud project; all scripts run |
| 2. Schema and security | All migrations (pushed with `db:push`), RLS helpers and policies, audit triggers, symptom catalog, `pg_cron`/`pg_net` | DB/RLS tests pass for all roles against the dev project |
| 3. Core engines | Rule files + schemas, rule loader, adherence engine, flag engine, summary builder, rules check-in builder | Core unit tests pass, coverage ≥90% |
| 4. Seed data | Synthetic generator (Section 13) | `npm run db:reset -- --yes` reseeds the dev project; flag engine produces the expected flags |
| 5. Auth and shell | Sign-in, MFA, invitations, role routing, timeout, alerts bell | E2E 7 passes |
| 6. AI tailoring | `AiProvider` interface, mock and gateway providers, `tailor-checkin` function, validation, fallback, templates, fingerprint trigger | AI tailoring tests pass; `npm run ai:smoke` documented |
| 7. Patient and caregiver | Section 10 patient and caregiver screens, tailored check-in | E2E 1, 1b, 2 pass |
| 8. Nurse | Caseload, patient detail with timeline chart, meds, flags, doses, symptoms, summaries, flag inbox, template view and regenerate | E2E 3 and 5 pass |
| 9. Jobs and alerts | Remaining Edge Functions deployed, cron, SMS provider interface | E2E 4 passes; jobs idempotent (run twice, no duplicates) |
| 10. Admin | Dashboard (incl. AI check-ins card), patients, team, settings, audit log, pilot metrics | E2E 6 passes |
| 11. Hardening and deploy prep | Accessibility pass, wording and PHI tests, bundle secret scan, empty/error states, performance (dashboard loads <2s with seed data), Vercel config verified with a production build, docs complete | Full test suite green; `npm run build` succeeds; `FINAL_REPORT.md` written |

---

## 13. Synthetic seed data

Create a deterministic generator (fixed random seed) in `supabase/seed/`:

- **Organization:** "Riverbend Home Health (Demo)", timezone America/New_York.
- **Users (password `Demo!2345` for all, MFA disabled for demo accounts and noted in README):**
  - `admin@demo.medwatch` (agency_admin)
  - `nurse1@demo.medwatch`, `nurse2@demo.medwatch`, `nurse3@demo.medwatch` (nurses, ~8 patients each)
  - `caregiver1@demo.medwatch`, `caregiver2@demo.medwatch` (each linked to 2 patients)
  - `patient1@demo.medwatch` (patient-user linked to self)
- **25 fictional patients,** ages 68–94, each on 4–12 medications, with 45 days of history: dose events (mostly given, realistic missed patterns), daily check-ins (~80% completion), occasional symptoms.
- **Five scripted stories** so the demo always tells a clear story:
  1. A sedating sleep medicine is started; dizziness and a near-fall begin on day 3; doses all reported taken → **high** temporal-correlation flag.
  2. A new blood pressure medicine starts; doses are mostly missed; symptoms appear → flag with **lowered** score and explanation noting missed doses.
  3. A patient on an anticoagulant also has a long-term NSAID → **interaction** flag.
  4. A patient misses 4 consecutive evening doses → **adherence** flag plus escalated alerts.
  5. A patient whose symptoms **improve** after a medication is stopped → no flag; timeline visibly shows improvement (good for demos).
- Set `last_visit_at` on patients 3–20 days ago so "since last visit" summaries have content.
- Generate an active check-in template for every seeded patient using the **rules** builder (no AI calls during seeding), so the demo works with AI off.
- Print a seed summary at the end: counts per table and the expected flags.

---

## 14. Environment and deployment

### Environment files
Two example files, both committed; real values never committed (`.env*` in `.gitignore` except the examples). In the cloud sandbox, real values arrive as environment variables from the cloud environment settings, and `scripts/write-env.mjs` writes the two gitignored files from them.

**`.env.example`** (frontend and scripts; anything prefixed `VITE_` ends up in the browser, so only public values):
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — public client values for the dev project
- `VITE_APP_ENV` — `development` | `staging` | `production` (controls the demo banner)
- `SUPABASE_DEV_PROJECT_REF` — the only project destructive scripts may touch
- `SUPABASE_SERVICE_ROLE_KEY` — used only by Node scripts (seed, tests); never `VITE_`
- `APP_ENV` — same values as above, for scripts
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` — for non-interactive Supabase CLI use in the cloud sandbox (link, `db push`, `functions deploy`, `secrets set`); scripts only, never `VITE_`

**`.env.functions.example`** (synced to Edge Function secrets with `npm run secrets:sync`):
- `AI_ENABLED` (`true`|`false`), `AI_PROVIDER` (`gateway`|`mock`)
- `AI_GATEWAY_URL`, `AI_GATEWAY_API_KEY`, `AI_GATEWAY_AUTH_HEADER` (default `x-api-key`), `AI_MODEL` (default `claude-sonnet-5-5`)
- `SMS_PROVIDER` (`console`|`twilio`), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- `CRON_SECRET`

Validate both sets with Zod at startup and fail with a clear message listing any missing variable.

### Vercel
- `vercel.json`: build command `npm run build -w apps/web`, output `apps/web/dist`, SPA rewrite of all routes to `/index.html`, and headers: `Content-Security-Policy` (allow self plus the Supabase project URL for `connect-src`), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` disabling camera, microphone, geolocation.
- Vercel only serves static files. Patient data flows browser → Supabase directly, and AI calls run in Supabase Edge Functions, so no patient data passes through Vercel functions. Do not add Vercel serverless functions that touch patient data.
- Set the `VITE_` variables in the Vercel project settings per environment (Preview → dev Supabase project; Production → production project later).

### Rules
- `APP_ENV` other than `production` shows the demo banner. In `production`, refuse to run the seed or reset scripts.

### README
Sections: prerequisites (a Supabase account with a dev project, a Vercel account, a GitHub repo; for cloud sessions, the environment variables, network allowlist and setup script from the top of BUILD_SPEC.md; for local work, Node 20+ and the Supabase CLI via `npx`; Docker never needed), first-time setup (create dev project, `supabase link`, `db:push`, `secrets:sync`, `functions:deploy`, `db:reset -- --yes`), daily dev, running tests, resetting data, demo logins, turning on the AI gateway (`AI_ENABLED=true`, `AI_PROVIDER=gateway`, then `npm run ai:smoke`), deploying to Vercel, and a **"Before real patients" checklist**: separate production Supabase project on a plan with a signed BAA and the HIPAA add-on; BAA covering the AI gateway and model provider; SMS vendor BAA; confirm Vercel's terms if any patient data could touch it; attorney review of privacy policy, terms, consent forms; clinician sign-off on every rule file (change status from PLACEHOLDER) and on the check-in prompt; MFA enforced for all staff; backups and point-in-time recovery; incident response plan; security review.

---

## 15. Final deliverables checklist

- [ ] All 11 phases complete, committed, and pushed
- [ ] `PROGRESS.md` lists any domains blocked by the network allowlist and any tests not run in the sandbox
- [ ] `npm run typecheck`, `lint`, `test`, `test:e2e` all pass
- [ ] `npm run db:reset -- --yes` reseeds the cloud dev project with all five stories and expected flags
- [ ] Tailored check-ins work with the mock provider and fall back to rules on every failure case
- [ ] No AI or service-role key appears in the built frontend bundle
- [ ] `npm run build` succeeds with the Vercel configuration
- [ ] Every user-facing string lives in `src/copy/` and passes the wording test
- [ ] RLS tests prove cross-org and cross-caseload isolation
- [ ] `docs/ARCHITECTURE.md`, `DATA_MODEL.md`, `SECURITY.md`, `CLINICAL_RULES.md` written
- [ ] `README.md`, `PROGRESS.md`, `DECISIONS.md`, `FINAL_REPORT.md` written
- [ ] `FINAL_REPORT.md` lists known gaps and the human review items

Begin now: read this spec fully, write `PLAN.md`, then start Phase 1.
