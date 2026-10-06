# Progress

Resume instructions: read this file and `BUILD_SPEC.md`, run `npm run env:write`, continue from the first unfinished phase.

## Status

| Phase                  | Status                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Scaffold            | done — typecheck, lint, test (6), build, dev server verified                                                                                                                          |
| 2. Schema and security | done locally — 6 migrations; 37/37 local Postgres RLS/audit/invitation tests pass (`npm run test:db:local`). Cloud `db:push` + cloud RLS suite (`tests/db/cloud`) pending credentials |

## Blocked by network

- None so far (`api.supabase.com`, `*.supabase.co` and `registry.npmjs.org` reachable).

## Blocked by missing environment variables

- No Supabase variables were visible in the build session (`write-env` lists them). Cloud steps pending.
