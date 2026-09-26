#!/bin/bash
# Prepares a Claude Code on the web session so lint, typecheck and all test
# suites run (plan M0.4). Idempotent and non-interactive.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

pnpm install

# Local Postgres 16 for integration tests. Cloud sessions ship the system
# cluster; fall back to docker compose where it isn't installed.
if command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_ctlcluster 16 main start 2>/dev/null || true
  for _ in $(seq 1 20); do pg_isready -q && break; sleep 0.5; done
  su postgres -c "psql -tAc \"select 1 from pg_roles where rolname = 'hub'\"" | grep -q 1 ||
    su postgres -c "psql -c \"create role hub login password 'hub' superuser\""
  su postgres -c "psql -tAc \"select 1 from pg_database where datname = 'hub'\"" | grep -q 1 ||
    su postgres -c "psql -c \"create database hub owner hub\""
else
  docker compose up -d --wait db
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export DATABASE_URL=postgres://hub:hub@localhost:5432/hub' >> "$CLAUDE_ENV_FILE"
  # Use the pre-installed Chromium for Playwright instead of downloading one.
  if [ -x /opt/pw-browsers/chromium ]; then
    echo 'export PW_CHROMIUM_PATH=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
  fi
fi
