#!/bin/sh
# Restores a dump produced by db-backup.sh into DATABASE_URL.
#
#   DATABASE_URL=postgresql://.../mellafx_restore ./scripts/db-restore.sh backups/mellafx-20260924T001500Z.dump
#
# Refuses to run against a database that already has tables unless
# RESTORE_FORCE=true (then objects are dropped and recreated). Practise this
# on staging weekly: an untested backup is not a backup.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
dump="${1:?usage: db-restore.sh <file.dump|file.dump.gpg>}"
url="$(printf '%s' "$DATABASE_URL" | sed -E 's/[?&]schema=[^&]*//')"

case "$dump" in
  *.gpg)
    plain="$(mktemp)"
    trap 'rm -f "$plain"' EXIT
    gpg --batch --yes --output "$plain" --decrypt "$dump"
    dump="$plain"
    ;;
esac

tables="$(psql "$url" -tAc "select count(*) from information_schema.tables where table_schema='public'")"
clean=""
if [ "$tables" != "0" ]; then
  if [ "${RESTORE_FORCE:-false}" != "true" ]; then
    echo "target database has $tables tables; set RESTORE_FORCE=true to overwrite" >&2
    exit 1
  fi
  clean="--clean --if-exists"
fi

# shellcheck disable=SC2086
pg_restore --no-owner --no-privileges --exit-on-error $clean --dbname="$url" "$dump"
echo "restore ok: $(psql "$url" -tAc 'select count(*) from "User"') users, $(psql "$url" -tAc 'select count(*) from "TradingAccount"') accounts"
