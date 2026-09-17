# WA Blast

WA Blast adalah aplikasi internal untuk mengelola kontak berizin, template pesan,
campaign WhatsApp, approval admin, antrean delivery, dan audit operasional.

Status saat ini: MVP untuk pengujian lokal. Adapter gateway yang tersedia masih
`mock`, sehingga aplikasi belum mengirim pesan WhatsApp sungguhan.

## Fitur utama

- Login berbasis session cookie dan proteksi CSRF.
- Dashboard antrean, campaign aktif, kesehatan gateway, dan delivery.
- Import kontak CSV dengan normalisasi nomor dan pencatatan consent.
- Suppression/opt-out yang tetap menjadi sumber kebenaran.
- Template plain-text dengan variabel seperti `{{name}}` dan satu attachment opsional.
- Campaign dengan audience preview, jadwal, approval admin, dan snapshot recipient.
- Worker delivery dengan retry terbatas, lease, idempotency, dan webhook status.
- Manajemen user admin/operator serta audit history.
- SQLite untuk penyimpanan lokal.

## Prasyarat

- [Bun](https://bun.sh/) 1.4.2 atau kompatibel.
- Windows PowerShell, macOS/Linux shell, atau terminal yang mendukung perintah Bun.
- Browser modern.

Periksa versi Bun:

~~~sh
bun --version
~~~

## Menyiapkan lingkungan lokal

Clone repository dan pasang dependency:

~~~sh
git clone https://github.com/bandibappeda/wa-blast-codex.git
cd wa-blast
bun install --frozen-lockfile
~~~

Perintah `bun --filter` dijalankan dari direktori workspace masing-masing. Karena
itu konfigurasi lokal dibuat di dua file berikut, bukan hanya di `.env` root.

### `apps/server/.env`

~~~dotenv
APP_ENV=development
APP_ORIGIN=http://127.0.0.1:5174
API_HOST=127.0.0.1
API_PORT=3100
DATABASE_PATH=../../var/data/wa-blast.local.db
UPLOADS_PATH=../../var/uploads-local
DEFAULT_PHONE_COUNTRY=ID
ORGANIZATION_TIME_ZONE=Asia/Jakarta
SESSION_TTL_HOURS=12
SESSION_COOKIE_SECURE=false
ATTACHMENT_MAX_BYTES=10485760
GATEWAY_ENCRYPTION_KEY=<base64url-encoded-32-byte-key>
~~~

### `apps/web/.env`

~~~dotenv
API_PORT=3100
VITE_API_PROXY_TARGET=http://127.0.0.1:3100
~~~

Generate key gateway lokal dengan Bun, lalu masukkan hasilnya ke
`GATEWAY_ENCRYPTION_KEY`:

~~~sh
bun -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
~~~

Kedua file `.env` tersebut di-ignore Git. Jangan commit secret atau password ke
repository.

## Migrasi dan membuat admin pertama

Jalankan migrasi database:

~~~sh
bun --filter @wa-blast/server migrate
~~~

Buat admin pertama. Perintah ini akan meminta password secara interaktif:

~~~sh
bun --filter @wa-blast/server bootstrap-admin \
  --email admin@example.com \
  --name 'Local Admin'
~~~

Password minimal 12 karakter. Bootstrap hanya dapat dilakukan sekali untuk satu
database. Untuk otomasi lokal, password dapat diberikan melalui environment
sementara, tetapi jangan menyimpannya di repository:

~~~powershell
$env:BOOTSTRAP_ADMIN_PASSWORD = 'ganti-dengan-password-lokal'
bun --filter @wa-blast/server bootstrap-admin --email admin@example.com --name 'Local Admin'
Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD
~~~

## Menjalankan aplikasi

Buka tiga terminal pada root repository.

Terminal 1 — API:

~~~sh
bun run dev:api
~~~

Terminal 2 — delivery worker:

~~~sh
bun run dev:worker
~~~

Terminal 3 — web:

~~~sh
bun run dev:web -- --host 127.0.0.1 --port 5174
~~~

Buka aplikasi pada:

- Web: <http://127.0.0.1:5174>
- API health: <http://127.0.0.1:3100/api/health>

Health check yang berhasil menghasilkan:

~~~json
{"status":"ok","service":"api"}
~~~

Untuk menghentikan aplikasi, tekan `Ctrl+C` pada ketiga terminal.

## Alur pengoperasian

### 1. Gateway

Masuk sebagai admin, buka **Gateways**, lalu buat koneksi dengan adapter `mock`.
Sender identity dan rate per menit tetap harus diisi. Credential dapat dikosongkan
untuk mock gateway.

### 2. Kontak

Buka **Contacts**, lalu import CSV. Contoh format minimum:

~~~csv
phone,name,consent_source,consent_at
081234567890,Rina,web_form,2026-01-01T00:00:00.000Z
628111111111,Budi,manual_import,2026-01-01T00:00:00.000Z
~~~

Klik **Preview import**, periksa baris yang diterima/ditolak, lalu commit import.
Kontak yang tidak valid atau tersuppress tidak akan menjadi recipient yang eligible.

### 3. Template

Buka **Templates**, buat template plain-text, misalnya:

~~~text
Halo {{name}}, ini pesan informasi untuk Anda.
~~~

Preview akan menampilkan variabel yang hilang. Attachment opsional dibatasi oleh
`ATTACHMENT_MAX_BYTES` dan tipe file yang diizinkan aplikasi.

### 4. Campaign

Buka **Campaigns** dan lakukan langkah berikut:

1. Buat campaign dan pilih gateway.
2. Pilih audience yang eligible.
3. Pilih template pesan.
4. Simpan draft dan periksa preview.
5. Submit untuk approval.

### 5. Approval dan delivery

Admin membuka campaign yang menunggu approval, memeriksa ringkasan audience, lalu
menyetujui dengan konfirmasi dan password admin. Worker akan mengambil job yang
tersedia dan memprosesnya sesuai rate limit, retry policy, dan status campaign.

Progress dapat dipantau melalui **Dashboard** dan detail campaign. Karena adapter
yang tersedia masih mock, hasil delivery hanya simulasi untuk pengujian alur.

### 6. User dan audit

- **Users** hanya tersedia untuk admin.
- Pembuatan operator menghasilkan password sementara.
- Operator dapat mengelola dashboard, kontak, template, dan campaign, tetapi tidak
  dapat mengelola user, gateway, atau audit history.
- **Audit** menampilkan aktivitas penting tanpa membocorkan secret atau password.

## Perintah pengembangan

~~~sh
# Semua typecheck, test, dan build
bun run check

# Test unit dan integration
bun run test

# Build production artifact
bun run build

# End-to-end test dengan database dan port terisolasi
bun run e2e
~~~

E2E test menggunakan database di `var/e2e` dan tidak memakai database lokal
`var/data/wa-blast.local.db`.

## Data dan log lokal

- Database: `var/data/wa-blast.local.db`
- Upload: `var/uploads-local`
- Log API: `var/logs/api.log`
- Log worker: `var/logs/worker.log`
- Log web: `var/logs/web.log`

Untuk memeriksa API dari PowerShell:

~~~powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3100/api/health
~~~

## Troubleshooting

### Port sudah digunakan

Ubah `API_PORT` di `apps/server/.env`, ubah `VITE_API_PROXY_TARGET` di
`apps/web/.env`, dan jalankan web dengan port baru:

~~~sh
bun run dev:web -- --host 127.0.0.1 --port 5174
~~~

`APP_ORIGIN` di server juga harus sama dengan alamat web yang digunakan.

### `gateway_encryption_key_required`

Pastikan `GATEWAY_ENCRYPTION_KEY` ada, valid base64url, dan merepresentasikan tepat
32 byte. Key yang berbeda dari saat credential gateway disimpan tidak dapat
membuka credential lama.

### Admin belum dapat login

Pastikan database sudah dimigrasikan dan admin sudah dibuat dengan
`bootstrap-admin`. Jika database sudah memiliki organisasi, jangan jalankan
bootstrap ulang; gunakan user admin yang sudah ada.

### Reset database lokal

Hanya lakukan untuk data lokal yang boleh dihapus. Hentikan API dan worker dahulu,
lalu hapus database dan upload lokal:

~~~powershell
Remove-Item -LiteralPath .\var\data\wa-blast.local.db, .\var\data\wa-blast.local.db-wal, .\var\data\wa-blast.local.db-shm -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\var\uploads-local -Recurse -Force -ErrorAction SilentlyContinue
~~~

Setelah itu jalankan migrasi dan bootstrap admin kembali.

## Deployment

Deployment VPS belum dilakukan. Panduan deployment, systemd, Nginx, backup, dan
restore tersedia di [`docs/operations/deployment.md`](docs/operations/deployment.md)
dan [`docs/operations/backup-and-restore.md`](docs/operations/backup-and-restore.md).
