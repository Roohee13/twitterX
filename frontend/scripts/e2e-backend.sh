#!/usr/bin/env bash
# Starts the backend for development and browser tests: scratch database, local Redis, rate limits off, port 8080.
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

DB_URL="jdbc:postgresql://localhost:5432/$DB" \
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}" \
RATE_LIMIT_ENABLED=false \
PORT="${PORT:-8080}" \
exec java -jar target/Xclone-backend-0.0.1-SNAPSHOT.jar
