# MedWatch — Build Plan

Source of truth: `BUILD_SPEC.md` (committed as `BUILD_SEPC.md` in the original repo; renamed — see `DECISIONS.md`).
Work proceeds phase by phase. After each phase: `npm run typecheck`, `npm run lint`, `npm run test`, update `PROGRESS.md`, commit, push.

## Phase 1 — Scaffold

- [x] npm workspaces monorepo (`apps/web`, `packages/core`)
- [x] Vite + React 18 + TS strict app shell, Tailwind theme (Section 9 palette), demo banner
- [x] ESLint (flat config, `no-console`, `react/jsx-no-literals`) + Prettier
- [x] Vitest root config, Playwright config
- [x] `scripts/write-env.mjs` (writes `.env` and `.env.functions` from `process.env`, fails with missing list)
- [x] `.env.example`, `.env.functions.example`, `.gitignore`
- [x] Supabase CLI config (`supabase/config.toml`), link script
- [x] `vercel.json` (SPA rewrite + security headers)
- [x] Root scripts: dev, build, typecheck, lint, test, test:e2e, db:push, db:reset, seed, functions:deploy, secrets:sync
- [x] docs skeleton (`ARCHITECTURE.md`, `DATA_MODEL.md`, `SECURITY.md`, `CLINICAL_RULES.md`)

## Phase 2 — Schema and security

- [x] Migrations: all Section 5 tables, indexes, `updated_at` triggers
- [x] RLS helpers `auth_org_id()`, `auth_role()`, `can_access_patient()` + MFA-aware access
- [x] RLS policies on every table; patient/caregiver column restrictions on dose confirmation
- [x] Audit triggers; append-only `audit_log`; `log_view` / `log_export` RPCs
- [x] Invitations table + `accept_invitation` RPC
- [x] Symptom catalog seed (20 symptoms, 4 core)
- [x] `pg_cron` / `pg_net` (guarded), cron schedules via Vault secrets
- [x] DB/RLS tests: cloud (supabase-js per role) + local Postgres verification harness
- [x] `docs/DATA_MODEL.md` with Mermaid ER diagram

## Phase 3 — Core engines (`packages/core`)

- [x] Rule files + Zod schemas + generated JSON Schemas; rule loader
- [x] Timezone utilities (DST-safe)
- [x] Adherence engine
- [x] Flag engine (4 flag types, scoring, dedupe, upgrade, evidence)
- [x] Visit summary builder
- [x] Rules check-in builder + medication fingerprint
- [x] Wording guard
- [x] Unit tests, coverage ≥ 90%

## Phase 4 — Seed data

- [x] Deterministic generator (25 patients, 45 days, 5 stories, rules templates)
- [x] Writers: Supabase (cloud) and Postgres (local verification)
- [x] Guards per Hard Rule 10 (`APP_ENV`, project ref, `--yes`)
- [x] Test: generator output + expected flags

## Phase 5 — Auth and shell

- [x] Sign in, forgot/reset password, MFA enroll/challenge, accept invitation
- [x] Role routing + guards, top bar, alerts bell, session timeout modal
- [x] `invite-user` edge function
- [x] E2E 7

## Phase 6 — AI tailoring

- [x] `AiProvider`, `AnthropicGatewayProvider`, `MockAiProvider`
- [x] Prompt `checkin_v1.ts`, validator, core-merge, fallback, rate limit
- [x] `tailor-checkin` function, fingerprint trigger
- [x] AI tests (all failure cases, PHI-free request, metadata-only `ai_requests`, bundle scan)
- [x] `npm run ai:smoke`

## Phase 7 — Patient and caregiver

- [x] `/me`: Today, check-in flow (tailored), My medicines
- [x] `/care`: My people, patient tabs, alerts
- [ ] E2E 1, 1b, 2

## Phase 8 — Nurse

- [x] Caseload, patient detail (timeline chart, meds, flags, doses, symptoms, summary + PDF, people), flag inbox
- [x] Template view + regenerate
- [ ] E2E 3, 5

## Phase 9 — Jobs and alerts

- [x] `generate-doses`, `check-missed-doses`, `run-flag-engine`, `send-alert`
- [x] SMS provider interface (Console, Twilio)
- [x] Idempotency tests; E2E 4

## Phase 10 — Admin

- [ ] Dashboard (needs attention, KPIs, charts, AI card), patients, team, settings, audit log, pilot metrics + report
- [ ] E2E 6

## Phase 11 — Hardening and deploy prep

- [ ] Axe pass, wording + PHI tests, bundle secret scan, empty/error states
- [ ] Production build with Vercel config
- [ ] README, FINAL_REPORT, docs complete
