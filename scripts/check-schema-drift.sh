#!/usr/bin/env bash
# Fails when TypeORM entities have drifted from the applied migrations.
# `schema:log` always exits 0 (it only prints SQL), so this wraps it and treats
# any generated synchronization query as drift.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[schema-drift] ERROR: DATABASE_URL is required." >&2
  exit 1
fi

output="$(npm run --silent typeorm -- schema:log 2>&1)"
echo "$output"

if grep -q 'schema is up to date' <<<"$output"; then
  echo "[schema-drift] OK: entities match the applied migrations."
  exit 0
fi

echo "[schema-drift] ERROR: entity/migration drift detected. Generate a migration to reconcile." >&2
exit 1
