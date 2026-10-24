#!/bin/sh
# Restores a backup made by backup.sh into this deployment, replacing the
# database and the material files. The mounted instance is restored only with
# --instance (a deploy writes it anyway).
#
#   ./restore.sh backups/2026-10-24T031700Z [--instance]
#
# The roles come from .env through the init script, so on a new server deploy
# once (same secrets), then restore. Copy a backup from the second place first:
#   rsync -a user@host:path/2026-10-24T031700Z backups/
set -eu
cd "$(dirname "$0")"
backup=${1:?usage: ./restore.sh <backup directory> [--instance]}
backup=${backup%/}
(cd "$backup" && sha256sum -c --quiet SHA256SUMS)

docker compose stop app caddy
docker compose up -d --wait db
docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 -d postgres \
  -c "DROP DATABASE IF EXISTS app WITH (FORCE)"
docker compose exec -T db pg_restore -U postgres --exit-on-error --create \
  -d postgres < "$backup/app.dump"
docker compose run --rm --no-deps -T --user 0 --entrypoint sh app \
  -c 'find /files -mindepth 1 -delete && tar -xzf - -C /files' \
  < "$backup/files.tar.gz"
if [ "${2:-}" = "--instance" ]; then
  find instance -mindepth 1 -delete
  tar -C instance -xzf "$backup/instance.tar.gz"
fi
docker compose up -d
echo "[restore] $backup restored"
