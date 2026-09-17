#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
database_path="${DATABASE_PATH:-$repo_root/var/data/wa-blast.db}"
uploads_path="${UPLOADS_PATH:-$repo_root/var/uploads}"
backup_root="${WA_BLAST_BACKUP_DIR:-$repo_root/var/backups}"
daily_keep="${WA_BLAST_DAILY_KEEP:-14}"
weekly_keep="${WA_BLAST_WEEKLY_KEEP:-8}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required for an online SQLite backup" >&2
  exit 1
fi
if ! command -v sha256sum >/dev/null 2>&1; then
  echo "sha256sum is required for backup verification" >&2
  exit 1
fi
if [[ ! -f "$database_path" ]]; then
  echo "database does not exist: $database_path" >&2
  exit 1
fi
if [[ ! -d "$uploads_path" ]]; then
  echo "uploads directory does not exist: $uploads_path" >&2
  exit 1
fi

secure_directory() {
  local directory="$1"
  mkdir -p -- "$directory"
  if ! chmod 700 "$directory" 2>/dev/null; then
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*) ;;
      *) echo "could not secure backup directory: $directory" >&2; return 1 ;;
    esac
  fi
}
secure_directory "$backup_root/daily"
secure_directory "$backup_root/weekly"
stage="$(mktemp -d "$backup_root/.staging.XXXXXX")"
cleanup() { rm -rf -- "$stage"; }
trap cleanup EXIT

sqlite3 "$database_path" ".timeout 5000" ".backup '$stage/database.sqlite3'"
if [[ "$(sqlite3 "$stage/database.sqlite3" 'PRAGMA integrity_check;')" != "ok" ]]; then
  echo "SQLite integrity check failed for backup" >&2
  exit 1
fi

tar -C "$(dirname -- "$uploads_path")" -czf "$stage/uploads.tar.gz" "$(basename -- "$uploads_path")"
(
  cd -- "$uploads_path"
  find . -type f -print0 | sort -z | xargs -0 -r sha256sum
) > "$stage/UPLOAD_SHA256SUMS"
(
  cd -- "$stage"
  sha256sum database.sqlite3 uploads.tar.gz UPLOAD_SHA256SUMS > SHA256SUMS
)

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
daily_archive="$backup_root/daily/wa-blast-$timestamp.tar.gz"
tar -C "$stage" -czf "$daily_archive" database.sqlite3 uploads.tar.gz UPLOAD_SHA256SUMS SHA256SUMS
chmod 600 "$daily_archive"

if [[ "$(date -u +%u)" == "7" ]]; then
  weekly_archive="$backup_root/weekly/wa-blast-$timestamp.tar.gz"
  cp -- "$daily_archive" "$weekly_archive"
  chmod 600 "$weekly_archive"
fi

rotate() {
  local directory="$1"
  local keep="$2"
  mapfile -t archives < <(find "$directory" -maxdepth 1 -type f -name 'wa-blast-*.tar.gz' -printf '%T@ %p\n' | sort -rn | tail -n +$((keep + 1)) | cut -d' ' -f2-)
  for archive in "${archives[@]}"; do
    [[ -n "$archive" ]] && rm -f -- "$archive"
  done
}
rotate "$backup_root/daily" "$daily_keep"
rotate "$backup_root/weekly" "$weekly_keep"

echo "backup created: $daily_archive"
