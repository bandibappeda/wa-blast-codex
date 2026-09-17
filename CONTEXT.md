# WhatsApp Blast

Konteks ini mengelola persiapan, persetujuan, pengiriman, dan pelacakan
kampanye pesan WhatsApp kepada penerima yang memiliki consent.

## Organization and Access

**Organization**:
Pemilik tunggal instalasi aplikasi beserta seluruh user, contact, gateway
connection, dan campaign di dalamnya.
_Avoid_: Tenant, workspace, account

**User**:
Anggota internal organization yang dapat masuk ke aplikasi dan memiliki satu
role.
_Avoid_: Account, contact, recipient

**Admin**:
User yang dapat mengelola user dan gateway connection, menyetujui campaign,
membatalkan pengiriman, dan mengelola suppression.
_Avoid_: Superuser, owner

**Operator**:
User yang dapat mengelola contact, message template, dan draft campaign serta
mengajukan campaign untuk persetujuan.
_Avoid_: Agent, staff

## Audience

**Contact**:
Data penerima yang dapat digunakan kembali oleh lebih dari satu campaign.
_Avoid_: Customer, audience member, recipient

**Consent**:
Bukti bahwa sebuah nomor telepon telah memberi izin untuk menerima pesan,
termasuk sumber dan waktu pemberian izin.
_Avoid_: Subscription, approval

**Suppression**:
Larangan aktif untuk mengirim pesan ke sebuah nomor telepon, terlepas dari
consent yang pernah diberikan.
_Avoid_: Unsubscribe, blacklist, block

## Messaging

**Gateway Connection**:
Identitas nomor pengirim yang tersedia bagi organization dan dapat dipilih oleh
sebuah campaign.
_Avoid_: Device, session, sender account

**Message Template**:
Isi pesan yang dapat digunakan kembali dan dapat memiliki variabel
personalisasi serta satu lampiran opsional.
_Avoid_: Campaign, canned response

**Campaign**:
Rencana pengiriman yang menggunakan satu gateway connection, satu message
template, jadwal, dan kumpulan contact.
_Avoid_: Blast, broadcast, job

**Campaign Recipient**:
Snapshot seorang contact beserta nilai personalisasinya saat campaign
disetujui.
_Avoid_: Contact, audience

**Message Job**:
Unit pengiriman yang mewakili satu campaign recipient.
_Avoid_: Campaign, queue item, message

**Delivery Attempt**:
Satu percobaan untuk mengirim sebuah message job melalui gateway connection.
_Avoid_: Retry, delivery event

**Delivery Event**:
Fakta status pengiriman yang diterima atau dihasilkan untuk sebuah message job.
_Avoid_: Delivery attempt, current status

## Governance

**Approval**:
Keputusan admin yang membekukan isi dan penerima campaign serta mengizinkannya
untuk dijadwalkan atau dikirim.
_Avoid_: Review, publish

**Audit Entry**:
Catatan permanen mengenai tindakan penting user atau perubahan status sistem.
_Avoid_: Log line, delivery event
