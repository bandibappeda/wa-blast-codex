# Backup and restore drill

Backups must be made from the live SQLite database with SQLite's online backup
operation. Copying a WAL database with `cp` is not an acceptable backup.

## Scheduled backup

Set absolute production paths before installing the timer or cron entry:

```sh
export DATABASE_PATH=/srv/wa-blast/shared/data/wa-blast.db
export UPLOADS_PATH=/srv/wa-blast/shared/uploads
export WA_BLAST_BACKUP_DIR=/srv/wa-blast/shared/backups
/srv/wa-blast/current/scripts/backup.sh
```

The script writes a `daily/wa-blast-<UTC timestamp>.tar.gz` archive containing:

- an SQLite online backup and an integrity check result;
- a compressed attachment directory snapshot;
- `SHA256SUMS` for the database and attachment archive;
- `UPLOAD_SHA256SUMS` for every attachment file.

Sunday's archive is copied into `weekly/`. Daily and weekly retention defaults
are 14 and 8 archives and can be changed with `WA_BLAST_DAILY_KEEP` and
`WA_BLAST_WEEKLY_KEEP`. Restrict the backup directory to the service account
and a separate backup reader, and copy verified archives to separate storage.

A system cron example (run as `wa-blast`) is:

```cron
17 2 * * * DATABASE_PATH=/srv/wa-blast/shared/data/wa-blast.db UPLOADS_PATH=/srv/wa-blast/shared/uploads WA_BLAST_BACKUP_DIR=/srv/wa-blast/shared/backups /srv/wa-blast/current/scripts/backup.sh >>/var/log/wa-blast-backup.log 2>&1
```

## Restore verification

Restore checks always use a temporary directory. The live database and uploads
are never replaced:

```sh
/srv/wa-blast/current/scripts/restore-check.sh \
  /srv/wa-blast/shared/backups/daily/wa-blast-20260917T021700Z.tar.gz
```

The check verifies archive checksums, SQLite integrity, every attachment
checksum, and runs the current migrations against the restored copy. It prints
`restore verification passed` only after all checks succeed.

Run a restore drill at least monthly. Record the archive timestamp, elapsed
time, checksum result, migration result, and the operator who performed the
drill. A real disaster recovery restore should first stop the API and worker,
move the live database and uploads aside, restore into the shared paths, run
the migration command, and start the units again only after a health check.
