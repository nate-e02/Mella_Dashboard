#!/bin/sh
# Nightly logical backup of the MellaFx database.
#
#   DATABASE_URL=postgresql://... BACKUP_DIR=/backups ./scripts/db-backup.sh
#
# Writes <BACKUP_DIR>/mellafx-<UTC timestamp>.dump (pg_dump custom format:
# compressed, restorable table by table with pg_restore), verifies it can be
# read back, and deletes dumps older than BACKUP_RETENTION_DAYS (default 30).
# If BACKUP_GPG_RECIPIENT is set the dump is encrypted to that public key and
# the plaintext is removed. Copy BACKUP_DIR to a second facility in Ethiopia
# (see the go-live plan: personal data must stay in-country).
#
# This is the baseline. For point-in-time recovery add WAL archiving
# (pgBackRest or WAL-G) on the database host.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/mellafx-$stamp.dump"
# pg_dump does not understand Prisma's ?schema= parameter.
url="$(printf '%s' "$DATABASE_URL" | sed -E 's/[?&]schema=[^&]*//')"

pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="$file.partial" "$url"
# A dump that pg_restore cannot list is not a backup.
pg_restore --list "$file.partial" > /dev/null
mv "$file.partial" "$file"

if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  gpg --batch --yes --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" --output "$file.gpg" --encrypt "$file"
  rm -f "$file"
  file="$file.gpg"
fi

find "$BACKUP_DIR" -maxdepth 1 -name 'mellafx-*.dump*' -type f -mtime +"$RETENTION_DAYS" -delete
echo "backup ok: $file ($(du -h "$file" | cut -f1))"
