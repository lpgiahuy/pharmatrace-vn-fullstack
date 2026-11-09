#!/bin/bash
set -euo pipefail

: "${APP_DB_PASSWORD:?Set APP_DB_PASSWORD in the root .env file}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_password="$APP_DB_PASSWORD" \
  --file=/docker-entrypoint-initdb.d/security/access/create_app_user.sql
