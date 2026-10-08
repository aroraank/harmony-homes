#!/usr/bin/env bash
# Runs the database test suite against a freshly reset local Supabase database.
#   supabase start            # once (needs Docker)
#   npm run test:db
set -euo pipefail
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
if command -v supabase >/dev/null 2>&1 && [ "${SKIP_RESET:-0}" != "1" ]; then
  supabase db reset --local
fi
psql "$DB_URL" -X -q -o /dev/null -v ON_ERROR_STOP=1 -f supabase/tests/database.test.sql
