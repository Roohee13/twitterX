#!/usr/bin/env bash
# Starts the backend for the browser tests: scratch database, local Redis, rate limits off, port 8090. The e2e Vite server runs on
# 5174, which is where the emailed verify/reset links must point and the only origin the backend's CORS allows here (browsers send an
# Origin header on POSTs even through the Vite proxy). Output is also written to frontend/e2e/backend.log because the
# backend only logs emails when no SMTP is configured, and the tests read the links from there.
# Usage: scripts/e2e-backend.sh   (stays in the foreground; Ctrl+C stops it)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${E2E_DB:-xclone_e2e}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

psql -U postgres -h localhost -tAc "select 1 from pg_database where datname='$DB'" | grep -q 1 \
  || psql -U postgres -h localhost -qc "create database $DB"

docker compose -f "$ROOT/docker-compose.yml" up -d redis

cd "$ROOT"
./mvnw -q package -DskipTests

mkdir -p "$ROOT/frontend/e2e"
DB_URL="jdbc:postgresql://localhost:5432/$DB" \
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}" \
RATE_LIMIT_ENABLED=false \
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5174}" \
CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-http://localhost:5174}" \
PORT="${PORT:-8090}" \
java -jar target/Xclone-backend-0.0.1-SNAPSHOT.jar 2>&1 | tee "$ROOT/frontend/e2e/backend.log"
