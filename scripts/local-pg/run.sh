#!/usr/bin/env bash
# Spins up a throwaway local Postgres 16, applies the Supabase auth shim + all migrations,
# then runs the local DB/RLS test suite. Verification aid only (spec targets cloud Supabase).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ -z "$PGBIN" || ! -x "$PGBIN/initdb" ]]; then
  echo "local-pg: PostgreSQL server binaries not found; skipping local verification." >&2
  exit 0
fi
DIR="$ROOT/.local-pg"
PORT="${LOCAL_PG_PORT:-54329}"
AS=()
if [[ "$(id -u)" == "0" ]]; then AS=(runuser -u postgres --); fi

cleanup() { "${AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; }
trap cleanup EXIT

rm -rf "$DIR"
mkdir -p "$DIR"
[[ "$(id -u)" == "0" ]] && chown postgres "$DIR"
"${AS[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust -E UTF8 >/dev/null
"${AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1" -l "$DIR/pg.log" -w start >/dev/null

PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c "create database medwatch"
"${PSQL[@]}" -d medwatch -f "$ROOT/scripts/local-pg/shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "local-pg: applying $(basename "$f")"
  "${PSQL[@]}" -d medwatch -f "$f"
done
# Re-apply to prove the migrations' idempotent parts (catalog upsert, cron upserts) are safe.
"${PSQL[@]}" -d medwatch -f "$ROOT/supabase/migrations/20261006000005_symptom_catalog.sql"

export LOCAL_PG_URL="postgres://postgres@127.0.0.1:$PORT/medwatch"
cd "$ROOT"
npx vitest run --config tests/db/local/vitest.config.ts "$@"
