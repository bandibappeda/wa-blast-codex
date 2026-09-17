#!/usr/bin/env bash
set -Eeuo pipefail

archive="${1:-}"
if [[ -z "$archive" || ! -f "$archive" ]]; then
  echo "usage: restore-check.sh <backup-archive.tar.gz>" >&2
  exit 2
fi
if ! command -v sqlite3 >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1; then
  echo "sqlite3 and sha256sum are required for restore verification" >&2
  exit 1
fi

release_root="${WA_BLAST_RELEASE_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
restore_root="$(mktemp -d "${TMPDIR:-/tmp}/wa-blast-restore.XXXXXX")"
cleanup() { rm -rf -- "$restore_root"; }
trap cleanup EXIT

tar -xzf "$archive" -C "$restore_root" --no-same-owner
(
  cd -- "$restore_root"
  sha256sum -c SHA256SUMS
)
sqlite3 "$restore_root/database.sqlite3" ".timeout 5000" "PRAGMA integrity_check;" | grep -qx "ok"

tar -xzf "$restore_root/uploads.tar.gz" -C "$restore_root" --no-same-owner
if [[ -s "$restore_root/UPLOAD_SHA256SUMS" ]]; then
  (
    cd -- "$restore_root/uploads"
    sha256sum -c ../UPLOAD_SHA256SUMS
  )
fi

(
  cd -- "$release_root"
  DATABASE_PATH="$restore_root/database.sqlite3" \
  UPLOADS_PATH="$restore_root/uploads" \
  bun --filter @wa-blast/server migrate
)
sqlite3 "$restore_root/database.sqlite3" "PRAGMA integrity_check;" | grep -qx "ok"

echo "restore verification passed; live database was not modified"
