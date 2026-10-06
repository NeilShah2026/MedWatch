# MedWatch

Medication-safety web app for home health agencies caring for older adults on many medications.
It tracks medicine lists and changes, dose adherence and a 30-second daily symptom check-in, and
runs a deterministic **flag engine** that notices when a new or worsening symptom follows a
medicine change — routing every flag to a nurse **for clinician review**. It never diagnoses or
recommends treatment.

> **Demo build: synthetic data only. Not for clinical use.** See [Before real patients](#before-real-patients).

Docs: [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) ·
[Security](docs/SECURITY.md) · [Clinical rules](docs/CLINICAL_RULES.md) ·
[Decisions](DECISIONS.md) · [Progress](PROGRESS.md) · [Final report](FINAL_REPORT.md)

## Prerequisites

- A **Supabase** account with a **dev project** (synthetic data only), a **Vercel** account, and this GitHub repo.
- **Cloud sessions (Claude Code on the web):** configure the environment before the session starts
  (variables only reach new sessions):
  1. Environment variables, in `.env` format (never committed): `VITE_SUPABASE_URL`,
     `VITE_SUPABASE_ANON_KEY`, `VITE_APP_ENV=development`, `SUPABASE_DEV_PROJECT_REF`,
     `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENV=development`, `SUPABASE_ACCESS_TOKEN`,
     `SUPABASE_DB_PASSWORD`, plus optionally `AI_ENABLED`, `AI_PROVIDER`, `AI_GATEWAY_URL`,
     `AI_GATEWAY_API_KEY`, `AI_GATEWAY_AUTH_HEADER`, `AI_MODEL`, `SMS_PROVIDER`, `TWILIO_*`,
     `CRON_SECRET`, `APP_URL`.
  2. Network allowlist: `*.supabase.co`, `*.supabase.com`, `api.supabase.com`, your AI gateway's domain.
  3. Setup script: `npm ci || npm install`.
- **Local work:** Node 20+; the Supabase CLI runs via `npx` (installed as a dev dependency).
  **Docker is never needed.** Optional: PostgreSQL 16 server binaries for `npm run test:db:local`.

## First-time setup

```bash
npm ci
npm run env:write                  # writes gitignored .env and .env.functions from process.env
                                   # (lists anything missing; --partial writes what exists)
npm run db:link                    # npx supabase link --project-ref $SUPABASE_DEV_PROJECT_REF
npm run db:push                    # apply supabase/migrations to the dev project
npm run functions:deploy           # deploy all Edge Functions
npm run secrets:sync               # push .env.functions to function secrets + store the function
                                   # URL and CRON_SECRET in Vault (enables pg_cron and triggers)
npm run db:reset -- --yes          # wipe + reseed the DEV project with synthetic data
npm run dev                        # http://localhost:5173
```

`.env.example` and `.env.functions.example` document every variable. Only `VITE_*` values reach
the browser, and only public ones are allowed there.

## Daily development

```bash
npm run env:write      # at the start of every cloud session
npm run dev            # web app against the dev project
```

**No cloud project?** Run the whole app against the in-memory mock Supabase (seeded with the same
synthetic data, using the real flag engine and tailoring code):

```bash
npm run mock:supabase                                  # http://localhost:54399
VITE_SUPABASE_URL=http://localhost:54399 \
VITE_SUPABASE_ANON_KEY=mock-anon-key-for-local-ui \
  npm run dev
```

The mock is for UI work and demos only; it is not a security boundary.

## Running tests

| Command                 | What it runs                                                                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`     | `tsc` for all workspaces + `deno check` for every Edge Function                                                                                                                                                                                             |
| `npm run lint`          | ESLint (incl. `no-console`, `react/jsx-no-literals`) + Prettier                                                                                                                                                                                             |
| `npm run test`          | Vitest: core engines (coverage ≥ 90%), rule loader, AI tailoring with `MockAiProvider`, job idempotency, seed generator + guards, wording / PHI-logging / bundle-secret / catalog / vercel tests, and the cloud RLS suite (skipped without dev credentials) |
| `npm run test:coverage` | Same, with the core coverage thresholds enforced                                                                                                                                                                                                            |
| `npm run test:db:local` | Throwaway local Postgres: applies all migrations with a Supabase auth shim, runs RLS/audit/invitation tests, loads the full seed and checks RLS per demo account and dashboard timing                                                                       |
| `npm run test:e2e`      | Playwright against the dev project (seeded, `AI_PROVIDER=mock`): E2E 1–8 incl. axe. Without credentials only the public-page tests run.                                                                                                                     |
| `npm run test:e2e:mock` | Playwright against the mock Supabase: patient, caregiver, nurse and admin walk-throughs with axe, E2E 1b/3/4/5/6/7 equivalents                                                                                                                              |
| `npm run ai:smoke`      | **Manual, not CI:** sends one synthetic medicine list through the real AI gateway and prints the validated questions                                                                                                                                        |

Playwright uses the preinstalled Chromium in cloud sessions; locally run
`npx playwright install --with-deps chromium` once.

## Resetting data

```bash
npm run db:reset -- --yes   # deletes the demo org (cascade) and demo auth users, then reseeds
npm run seed -- --yes       # seeds only if the demo org does not exist
```

Both refuse to run unless `APP_ENV` is `local` or `development` **and** the project in
`VITE_SUPABASE_URL` is `SUPABASE_DEV_PROJECT_REF`; they print the target and require `--yes`.
The audit log is append-only, so old audit rows remain (with the org link cleared).

## Demo logins

All demo accounts use the password **`Demo!2345`**. **MFA is disabled for demo accounts**
(`mfa_required = false`); real staff invited through the app get MFA required.

| Email                      | Role         | Notes                                                    |
| -------------------------- | ------------ | -------------------------------------------------------- |
| `admin@demo.medwatch`      | Agency admin | Dashboard, clients, team, settings, audit, pilot metrics |
| `nurse1@demo.medwatch`     | Nurse        | Caseload of 8, including stories 1 and 2                 |
| `nurse2@demo.medwatch`     | Nurse        | Caseload of 8, including stories 3 and 4                 |
| `nurse3@demo.medwatch`     | Nurse        | Caseload of 9, including story 5                         |
| `caregiver1@demo.medwatch` | Caregiver    | Linked to the story 1 and story 2 clients                |
| `caregiver2@demo.medwatch` | Caregiver    | Linked to the story 3 and story 4 clients                |
| `patient1@demo.medwatch`   | Client       | The story 1 client                                       |

The five scripted stories: (1) a sleep medicine followed by dizziness and a near-fall → **high**
flags; (2) a new blood-pressure medicine mostly missed → **lowered** flag that mentions the missed
doses; (3) a blood thinner plus a long-term NSAID → **interaction** flag; (4) four evening doses
missed in a row → **adherence** flag and escalated alerts; (5) symptoms improve after a medicine is
stopped → no temporal flag, visible improvement on the timeline.

## Turning on the AI gateway

```bash
# in the environment / .env.functions
AI_ENABLED=true
AI_PROVIDER=gateway
AI_GATEWAY_URL=https://your-gateway.example.com     # POST {url}/v1/messages (Anthropic format)
AI_GATEWAY_API_KEY=…
AI_GATEWAY_AUTH_HEADER=x-api-key                    # default
AI_MODEL=claude-sonnet-5-5                          # default
npm run env:write && npm run secrets:sync
npm run ai:smoke                                    # verify the gateway end to end
```

With `AI_ENABLED=false` (the default) or on any AI failure, clients get the rules-based check-in.
The model only ever sees medicine names/classes, recent-change types, an age band and the symptom
catalog. If your gateway uses a different API format, adapt only `AnthropicGatewayProvider`.

## Deploying to Vercel

1. Import the repo in Vercel. `vercel.json` already sets the build (`npm run build -w apps/web`),
   output (`apps/web/dist`), SPA rewrites and security headers.
2. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_APP_ENV` per environment
   (**Preview → dev project**, **Production → production project** later).
3. Set `APP_URL` in the function secrets to the deployed URL (used in invitation links) and add it
   to Supabase Auth redirect URLs.
4. Do not add Vercel serverless functions that touch patient data.

## Before real patients

- [ ] Separate **production Supabase project** on a plan with a signed **BAA** and the **HIPAA add-on**
- [ ] **BAA** covering the AI gateway and model provider (or keep AI off)
- [ ] **SMS vendor BAA** (or keep `SMS_PROVIDER=console`)
- [ ] Confirm Vercel's terms if any patient data could touch it (by design none does)
- [ ] **Attorney review** of privacy policy, terms of use and consent forms (all marked DRAFT)
- [ ] **Clinician sign-off on every rule file** (change status from `PLACEHOLDER_REQUIRES_CLINICAL_REVIEW`) and on the check-in prompt
- [ ] **MFA enforced for all staff**; demo accounts removed
- [ ] Backups and point-in-time recovery enabled and tested
- [ ] Incident response plan
- [ ] Security review / penetration test (see [docs/SECURITY.md](docs/SECURITY.md))
- [ ] Pin the CSP `connect-src` to the production Supabase URL; set `VITE_APP_ENV=production`
