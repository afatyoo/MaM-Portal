# Mail Proxy (IMAPS / POP3S / SMTPS) — Spec & Rencana Kerja

Status: **v1 terimplementasi** (`mail/`), sudah diuji di lab (lihat "Hasil uji lab").

## Tujuan

Satu hostname (mis. `mail.provider.com`) untuk IMAPS 993, POP3S 995 dan SMTPS 465.
MaM membaca login user, menentukan server Carbonio tempat akun berada (peta domain
`MaMKey_*` yang sama dengan login webmail), lalu meneruskan sesi ke server itu.

Di luar scope v1: STARTTLS (143/110/587), cache user→server, probe admin SOAP, TPROXY.

## Arsitektur

- Modul di dalam MaM, satu proses dengan `server.js`:
  - `mail/common.js` — listener TLS, limiter, logger, resolver backend, koneksi TLS ke backend.
  - `mail/imap.js`, `mail/pop3.js`, `mail/smtp.js` — state machine pra-login per protokol.
- Diaktifkan dari seksi `[MAIL]`; kalau `enabled = false` tidak ada port yang dibuka.
- Tiap koneksi diisolasi: error di satu sesi hanya menutup sesi itu, tidak menjatuhkan proses.

```
client ──TLS(cert mail.provider.com)──▶ MaM mail proxy ──TLS(verify ca_file)──▶ Carbonio A / B
```

## Konfigurasi

```ini
[MAIL]
enabled = true
imaps_port = 993
pop3s_port = 995
smtps_port = 465
tls_cert_file = certs/mail.crt
tls_key_file = certs/mail.key
hostname = mail.provider.com
; backend port default; bisa dioverride per MaMKey
; imap_port / pop3_port / smtps_port di seksi MaMKey_N
send_originating_ip = true     ; ID X-ORIGINATING-IP, XOIP, XCLIENT
max_conn_per_ip = 20
max_conn_total = 2000
prelogin_timeout_sec = 60
auth_fail_per_ip = 10          ; per 10 menit
auth_fail_per_user = 5         ; per 10 menit
```

Per `MaMKey_N` (opsional): `mail_host` (default: host dari `server`), `imap_port=993`,
`pop3_port=995`, `smtps_port=465`. `ca_file` / `insecure_tls` dipakai ulang.

## Resolusi backend (v1)

1. Ambil domain dari username (tanpa `@` → `default_domain`).
2. `findCandidates()` yang sudah ada.
3. Coba login ke kandidat sesuai urutan; berhenti di yang pertama berhasil.
4. Tidak ada kandidat → tolak login (pesan generik).

Catatan risiko: domain yang ada di dua server → password salah dicoba di dua server,
bisa memicu lockout di keduanya. Mitigasi v1: limiter per user di MaM berlaku sebelum
mencoba backend. Solusi penuh (cache + probe admin SOAP) dirancang di bagian "Nanti".

## Alur per protokol

### IMAPS
1. TLS handshake → `* OK [CAPABILITY IMAP4rev1 ID AUTH=PLAIN SASL-IR] ready`.
2. Pra-login yang dilayani sendiri: `CAPABILITY`, `NOOP`, `ID`, `LOGOUT`, `LOGIN`, `AUTHENTICATE PLAIN` (dengan/tanpa SASL-IR). Literal `{n}` / `{n+}` didukung untuk LOGIN. Perintah lain → `BAD`.
3. Ke backend: TLS, baca greeting, `ID ("X-ORIGINATING-IP" "<ip>")`, lalu `LOGIN` dengan kredensial asli.
4. Sukses → kirim ke client `<tag> OK [CAPABILITY ...backend...] Logged in`, lalu pipe dua arah.
5. Gagal → `<tag> NO [AUTHENTICATIONFAILED] Authentication failed`, coba kandidat berikutnya hanya jika ada.

### POP3S
1. `+OK ready`. Pra-login: `CAPA`, `USER`, `PASS`, `AUTH PLAIN`, `QUIT`.
2. Ke backend: TLS, greeting, `XOIP <ip>`, `USER`/`PASS`.
3. Sukses → `+OK`, pipe. Gagal → `-ERR [AUTH] Authentication failed`.

### SMTPS 465
1. `220 mail.provider.com ESMTP`. Pra-login: `EHLO`/`HELO`, `AUTH PLAIN`, `AUTH LOGIN`, `RSET`, `NOOP`, `QUIT`. `MAIL` sebelum AUTH → `530`.
2. Ke backend: TLS ke 465, `EHLO`, `XCLIENT ADDR=<ip>` (jika diiklankan backend; lalu EHLO ulang), `AUTH PLAIN`.
3. Sukses → `235`, pipe. Gagal → `535 5.7.8`.

## Keamanan

- TLS via modul `tls` Node (OpenSSL); min TLS 1.2. Ke backend selalu TLS dengan verifikasi sertifikat (`ca_file`); `insecure_tls` hanya untuk lab dan dicatat sebagai warning saat start.
- Parser hanya aktif sampai login; panjang baris maks 8 KB, literal maks 8 KB, perintah tak dikenal ditolak.
- Limiter: koneksi per IP, total koneksi, timeout pra-login, gagal auth per IP dan per user (sliding window, backoff, respons gagal ditunda acak 1–3 detik).
- Password tidak pernah di-log, tidak disimpan, buffer kredensial dibuang setelah login.
- Pesan error ke client generik (tidak membocorkan apakah user/domain ada).
- Log JSONL: `timestamp, proto, ip, email, domain, server_key, result, reason, ms`.
- Port privileged: `CAP_NET_BIND_SERVICE` (systemd `AmbientCapabilities`) atau root; `start.sh` disesuaikan.

## Prasyarat di tiap backend Carbonio/Zimbra (butuh izin)

- IP MaM ke `zimbraMailTrustedIP` → IP asli di IMAP/POP.
- IP MaM ke `smtpd_authorized_xclient_hosts` Postfix → IP asli di SMTP. Tanpa ini SMTP tetap jalan, IP terlihat sebagai IP MaM.
- Brute-force protection Carbonio (DoSFilter / lockout) perlu whitelist IP MaM agar satu IP proxy tidak ikut terblokir; limiter MaM yang mengganti perannya.

## Admin UI

- Status listener (port, aktif/tidak, koneksi aktif).
- Statistik dan log per protokol, memakai log JSONL yang sudah ada.

## Rencana kerja

1. `mail/common.js`: config `[MAIL]`, listener TLS, limiter, logger, resolver, connector backend + unit test (vitest).
2. `mail/imap.js` + test parser (LOGIN, literal, AUTHENTICATE PLAIN, SASL-IR) dengan backend palsu.
3. `mail/pop3.js` + test.
4. `mail/smtp.js` + test (AUTH PLAIN/LOGIN, XCLIENT).
5. Integrasi ke `server.js`, `config.sample.ini`, `start.sh`, README.
6. Admin UI: status + statistik per protokol.
7. Uji lab: MaM di Mac (port 10993/10995/10465), Thunderbird + `openssl s_client`. Backend:
   - `192.168.10.201` — Carbonio 26.9.2 (Advanced), domain `demo.aktiva.co.id`. Port 993/995/465 dipakai Switchboard; tidak disentuh.
   - `192.168.10.2` — `ce-rea.afatyo.com`, Carbonio CE (core 4.5.14), domain `afatyo.com`, `afatyo.id`.
   - `192.168.10.20` — `kizuna.afatyo.com`, Zimbra 10.1.21 Network Edition (Rocky 9). Dinyalakan user dulu.
8. Uji routing multi-backend (Carbonio + Zimbra; protokol `ID`/`XOIP`/`XCLIENT`/`AuthRequest` sama).
9. Security review kode.

## Hasil uji lab (2026-11-25)

MaM dijalankan di Mac (127.0.0.1:10993/10995/10465), cert backend diverifikasi pakai CA masing-masing.
Urutan backend untuk `afatyo.com`: Zimbra 10.20 dulu, lalu Carbonio CE 10.2.
Akun uji `mamproxy-ce@afatyo.com` hanya ada di CE.

| Uji | Hasil |
|---|---|
| IMAPS LOGIN, SELECT INBOX, LOGOUT | OK; ditolak Zimbra lalu sukses di CE (`attempted: [MaMKey_1, MaMKey_2]`) |
| POP3S AUTH PLAIN, STAT, QUIT | OK, jalur fallback sama |
| SMTPS AUTH PLAIN + kirim email | OK, `250 2.0.0 Ok: queued` di CE |
| Password salah (3 protokol) | Ditolak dengan pesan generik, password tidak muncul di log |

Catatan:
- Login yang perlu fallback lambat: IMAP/POP sekitar 12 detik saat sukses dan 25 detik saat password salah, karena proxy backend menahan respons gagal kira-kira 10 detik. SMTP sekitar 2 detik. Ini alasan kuat untuk cache user→server di versi berikutnya.
- Akun baru di Zimbra 10.20 belum bisa dibuat karena lisensinya expired 2026-11-23, jadi login sukses ke Zimbra belum diuji.
- IP MaM belum didaftarkan di `zimbraMailTrustedIP`/XCLIENT backend, jadi IP asli client belum diterapkan di backend (login tetap jalan).

## Nanti (setelah v1)

- Cache user→server (file JSON, TTL) + probe `GetAccountInfo` via admin SOAP untuk domain yang ada di dua server.
- STARTTLS 143/110/587.
- SNI per domain (gabungan dengan pendekatan Switchboard) jika perlu banyak nama.
