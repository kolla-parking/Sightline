#!/usr/bin/env bash
# Copy the Sightline Postgres data from one database to another
# (e.g. Render's expiring free Postgres -> Supabase).
#
# Usage:
#   SOURCE_URL='postgresql://...render external URL...' \
#   TARGET_URL='postgresql://postgres.<ref>:<pw>@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require' \
#   scripts/migrate_postgres.sh
#
# Notes:
# - Needs pg_dump/psql at least as new as the SOURCE server (Render runs
#   Postgres 18; Homebrew's postgresql@14 pg_dump will refuse). Install a
#   current client with `brew install libpq` and put it on PATH:
#     export PATH="$(brew --prefix libpq)/bin:$PATH"
# - Data only, public schema, no ownership/privilege statements, so it
#   applies cleanly on Supabase where the role is `postgres`, not `sightline`.
# - Safest on an EMPTY target: run it before pointing Render at the target,
#   so the schema comes from the dump and the API's idempotent startup
#   migrations then no-op. If the API has already migrated the target, the
#   schema step is skipped and the data copy will fail on duplicate keys for
#   any rows both sides share (e.g. the seeded demo client); truncate the
#   target's public tables first in that case.
# - Use the Supabase *Session* pooler (port 5432); the transaction pooler
#   (6543) breaks psql's multi-statement restore.

set -euo pipefail

: "${SOURCE_URL:?set SOURCE_URL to the source Postgres URL}"
: "${TARGET_URL:?set TARGET_URL to the target Postgres URL}"

command -v pg_dump >/dev/null || { echo "pg_dump not found on PATH" >&2; exit 1; }
command -v psql >/dev/null || { echo "psql not found on PATH" >&2; exit 1; }

echo "source server: $(psql "$SOURCE_URL" -Atc 'show server_version')"
echo "target server: $(psql "$TARGET_URL" -Atc 'show server_version')"
echo "pg_dump:       $(pg_dump --version)"

# 1. Schema first (idempotent with the API's migrations: CREATE TABLE IF NOT
#    EXISTS is not what pg_dump emits, so only do this if the target has no
#    tables yet).
target_tables=$(psql "$TARGET_URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")
if [ "$target_tables" = "0" ]; then
  echo "target is empty: copying schema"
  pg_dump "$SOURCE_URL" --schema=public --schema-only --no-owner --no-privileges \
    | psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q
else
  echo "target already has $target_tables tables: skipping schema (data only)"
fi

# 2. Data. Disable triggers so FK order doesn't matter.
echo "copying data"
pg_dump "$SOURCE_URL" --schema=public --data-only --no-owner --no-privileges --disable-triggers \
  | psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q

echo "done. row counts on target:"
psql "$TARGET_URL" -Atc "
  select relname || ': ' || n_live_tup
  from pg_stat_user_tables where schemaname='public' order by relname"
