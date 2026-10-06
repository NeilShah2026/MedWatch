# Progress

Resume instructions: read this file and `BUILD_SPEC.md`, run `npm run env:write`, continue from the first unfinished phase.

## Status

| Phase                  | Status                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Scaffold            | done — typecheck, lint, test (6), build, dev server verified                                                                                                                                                                                                 |
| 2. Schema and security | done locally — 6 migrations; 37/37 local Postgres RLS/audit/invitation tests pass (`npm run test:db:local`). Cloud `db:push` + cloud RLS suite (`tests/db/cloud`) pending credentials                                                                        |
| 3. Core engines        | done — rule files + Zod/JSON Schemas, loader, DST-safe time utils, adherence, flag engine, summary, rules check-in, fingerprint, wording guard. 107 core tests, coverage 99.3% lines / 94% branches. Wording, PHI-logging and catalog-sync static tests pass |

## Blocked by network

- None so far (`api.supabase.com`, `*.supabase.co` and `registry.npmjs.org` reachable).

## Blocked by missing environment variables

- No Supabase variables were visible in the build session (`write-env` lists them). Cloud steps pending.
