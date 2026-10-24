#!/bin/sh
# Backs up one deployment into backups/<UTC time>/ and copies it to a second
# place: the database (pg_dump, custom format, with CREATE DATABASE and its
# grants), the material files volume and the mounted instance.
#
#   ./backup.sh                 in the compose directory, e.g. daily from cron:
#   17 3 * * * cd /srv/chromatis && ./backup.sh >> backups/backup.log 2>&1
#
# BACKUP_TARGET in .env is an rsync destination (user@host:path, for example a
# Hetzner Storage Box in another location, or a local directory); without it
# the backup stays on this server. BACKUP_KEEP (default 14) backups are kept.
set -eu
cd "$(dirname "$0")"

setting() {
  sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1 | sed 's/^"\(.*\)"$/\1/'
}
target=$(setting BACKUP_TARGET)
keep=$(setting BACKUP_KEEP)
keep=${keep:-14}

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
directory="backups/$stamp"
mkdir -p "$directory"
chmod 700 backups

docker compose exec -T db pg_dump -U postgres --format=custom --create app \
  > "$directory/app.dump"
docker compose run --rm --no-deps -T --entrypoint tar caddy \
  -C /srv/files -czf - . > "$directory/files.tar.gz"
tar -C instance -czf "$directory/instance.tar.gz" .
(cd "$directory" && sha256sum app.dump files.tar.gz instance.tar.gz > SHA256SUMS)
echo "[backup] $directory: $(du -sh "$directory" | cut -f1)"

# Oldest first; everything but the newest $keep goes.
ls -1d backups/*/ | sort | head -n -"$keep" | xargs -r rm -rf

if [ -n "$target" ]; then
  rsync -a --delete --exclude backup.log backups/ "$target/"
  echo "[backup] copied to $target"
fi
