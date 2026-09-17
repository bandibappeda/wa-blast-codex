# WA Blast VPS deployment

The production process is intentionally split into an API unit and a delivery
worker. Both run as the dedicated `wa-blast` user; Nginx is the only public
listener.

## Initial setup

1. Install Bun 1.4.2, SQLite, Nginx, and a TLS issuer such as Certbot.
2. Create the service account and release directories:

   ```sh
   sudo useradd --system --home /srv/wa-blast --shell /usr/sbin/nologin wa-blast
   sudo install -d -o wa-blast -g wa-blast -m 750 /srv/wa-blast/current
   sudo install -d -o wa-blast -g wa-blast -m 750 /srv/wa-blast/shared/data /srv/wa-blast/shared/uploads
   sudo install -d -o root -g wa-blast -m 750 /etc/wa-blast
   ```

3. Put an environment file at `/etc/wa-blast/wa-blast.env` with absolute
   paths. Keep it root-owned and mode `640`:

   ```dotenv
   APP_ENV=production
   APP_ORIGIN=https://blast.example.com
   API_HOST=127.0.0.1
   API_PORT=3000
   DATABASE_PATH=/srv/wa-blast/shared/data/wa-blast.db
   UPLOADS_PATH=/srv/wa-blast/shared/uploads
   DEFAULT_PHONE_COUNTRY=ID
   ORGANIZATION_TIME_ZONE=Asia/Jakarta
   SESSION_TTL_HOURS=12
   SESSION_COOKIE_SECURE=true
   ATTACHMENT_MAX_BYTES=10485760
   GATEWAY_ENCRYPTION_KEY=<base64url-encoded-32-byte-key>
   ```

4. Create the DNS record, issue the certificate, and replace the example
   hostname and certificate paths in `deploy/nginx/wa-blast.conf`.

## Release sequence

Build releases in a separate directory, verify them, and atomically move the
release symlink. Do not edit files in the live release directory.

```sh
release=/srv/wa-blast/releases/$(date -u +%Y%m%d%H%M%S)
git clone --branch main <repository-url> "$release"
cd "$release"
bun install --frozen-lockfile
bun run check
bun run build
sudo chown -R wa-blast:wa-blast "$release"
sudo ln -sfn "$release" /srv/wa-blast/current
sudo systemctl daemon-reload
sudo systemctl restart wa-blast-api.service wa-blast-worker.service
curl --fail https://blast.example.com/api/health
```

The API unit runs migrations as `ExecStartPre`. The worker has its own
migration preflight and a longer stop timeout so active leases can be released.
The first installation creates the organization and administrator once:

```sh
sudo -u wa-blast --preserve-env=BOOTSTRAP_ADMIN_PASSWORD \
  bun --cwd /srv/wa-blast/current --filter @wa-blast/server bootstrap-admin \
  --email admin@example.com --name "Workspace Admin"
```

Prefer an interactive password prompt or inject `BOOTSTRAP_ADMIN_PASSWORD`
through a one-shot protected environment. Never put the bootstrap password in
the repository or shell history.

## Rollback and inspection

Keep at least two verified releases. Roll back by repointing `current` to the
previous release, then restarting both units. Database migrations are forward
only; a rollback that needs an older schema must be treated as a restore drill.

```sh
sudo systemctl status wa-blast-api wa-blast-worker
sudo journalctl -u wa-blast-api -u wa-blast-worker -n 100 --no-pager
curl --fail https://blast.example.com/api/health
```

Install the provided units and Nginx config with root ownership:

```sh
sudo install -o root -g root -m 644 deploy/systemd/*.service /etc/systemd/system/
sudo install -o root -g root -m 644 deploy/nginx/wa-blast.conf /etc/nginx/sites-available/wa-blast.conf
sudo ln -sfn /etc/nginx/sites-available/wa-blast.conf /etc/nginx/sites-enabled/wa-blast.conf
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now wa-blast-api wa-blast-worker nginx
```

Nginx serves only `apps/web/dist`, forwards `/api/` and gateway webhooks to
`127.0.0.1:3000`, enforces HTTPS, and blocks database, upload, environment,
and key files from direct access.
