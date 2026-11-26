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
idle_timeout_sec = 2100
backend_timeout_sec = 15
handshake_timeout_sec = 30     ; batas TLS handshake yang menggantung
auth_fail_per_ip = 10          ; per 10 menit
auth_fail_per_user = 5         ; per 10 menit
fail_limiter_max_keys = 20000  ; batas IP/user di penghitung gagal login
route_cache_enabled = true     ; cache email -> server (lihat bagian Cache)
route_cache_file = data/mail-route-cache.json
route_cache_ttl_days = 90
route_cache_max_entries = 50000
```

Per `MaMKey_N` (opsional): `mail_host` (default: host dari `server`), `imap_port=993`,
`pop3_port=995`, `smtps_port=465`. `ca_file` / `insecure_tls` dipakai ulang.

## Resolusi backend (v1)

1. Ambil domain dari username (tanpa `@` → `default_domain`).
2. `findCandidates()` yang sudah ada.
3. Kalau domain ada di lebih dari satu server dan cache punya jawaban untuk alamat itu,
coba server dari cache lebih dulu.
4. Coba login ke kandidat sesuai urutan; berhenti di yang pertama berhasil.
5. Login berhasil pada domain multi-server → simpan email → server ke cache.
6. Tidak ada kandidat → tolak login (pesan generik).

Catatan risiko: domain yang ada di dua server → password salah dicoba di dua server,
bisa memicu lockout di keduanya. Mitigasi v1: limiter per user di MaM berlaku sebelum
mencoba backend. Cache mengurangi kasus ini karena login berikutnya langsung ke server
yang benar. Probe admin SOAP tetap di bagian "Nanti".

## Cache email → server

Kenapa ada: backend yang menolak login menahan jawaban sekitar 10 detik, jadi login ke
domain yang punya dua server bisa 12 detik (sukses) sampai 25 detik (password salah).
Cache memotong percobaan yang salah itu.

- File JSON (`route_cache_file`, default `data/mail-route-cache.json`), mode `0600`,
karena isinya alamat email. Tidak pernah berisi password.
- Ditulis lewat nama temp acak + `fsync` + `rename`, dibaca dengan `O_NOFOLLOW` dan
batas ukuran, jadi symlink atau file rusak tidak diikuti.
- Isi: `email → { server, at }`. TTL (`route_cache_ttl_days`, default 90) dan batas
jumlah entri (`route_cache_max_entries`).
- Hanya dipakai kalau domain ada di lebih dari satu server; domain satu server tidak
butuh cache.
- Entri yang salah tidak dihapus saat login gagal (password salah bukan bukti cache
salah). Login sukses ke server lain langsung memperbarui cache.
- Bisa dikosongkan dari admin UI atau `DELETE /api/admin/mail/cache` (opsional
`?email=` untuk satu alamat).

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
- Sebelum login, satu koneksi maks 200 perintah, dan semua perintah yang gagal diparse ikut dihitung. Tanpa ini client bisa menahan slot pra-login selamanya karena tiap perintah mereset timeout.
- `maxConnTotal` juga dipasang sebagai `maxConnections` listener, dan TLS handshake dibatasi `handshake_timeout_sec`, karena limiter koneksi baru jalan setelah TLS selesai.
- `hostname` dibersihkan dari karakter kontrol saat config dibaca, jadi tidak bisa memecah baris greeting atau `EHLO` ke backend.
- Tag IMAP hanya boleh ASCII tercetak; tag dengan byte kontrol ditolak agar tidak dipantulkan kembali ke client.
- Penghitung gagal login dibatasi `fail_limiter_max_keys` supaya spray IP/username tidak membengkakkan memori.
- Cache disimpan `0600` dan ditulis atomik; file tidak diikuti bila berupa symlink.
- Password tidak pernah di-log, tidak disimpan, buffer kredensial dibuang setelah login.
- Pesan error ke client generik (tidak membocorkan apakah user/domain ada).
- Log JSONL: `timestamp, proto, ip, email, domain, server_key, result, reason, ms`.
- Port privileged: `CAP_NET_BIND_SERVICE` (systemd `AmbientCapabilities`) atau root; `start.sh` disesuaikan.

## Prasyarat di tiap backend Carbonio/Zimbra (butuh izin)

- IP MaM ke `zimbraMailTrustedIP`, lalu **restart mailboxd** (`systemctl restart carbonio-appserver` /
  `zmmailboxdctl restart`). Nilainya dibaca saat start, jadi menambah tanpa restart tidak berefek.
- `imap_port` / `pop3_port` **harus menunjuk mailboxd** (7993 / 7995), bukan 993 / 995. Di Carbonio
  maupun Zimbra, 993 dan 995 dilayani nginx; nginx yang menutup TLS lalu meneruskan ke mailboxd,
  sehingga `ID X-ORIGINATING-IP` dan `XOIP` berhenti di nginx dan `oip` tetap IP proxy. Bukti uji ada
  di bagian hasil lab v1.2 di bawah.
- IP MaM ke `smtpd_authorized_xclient_hosts` Postfix → IP asli di SMTP (465 dilayani Postfix langsung,
  jadi tidak ada masalah nginx). Zimbra tidak punya atribut LDAP untuk ini, set lewat `postconf -e`,
  dan ingat baris itu bisa hilang saat config diregenerasi.
- Brute-force protection Carbonio (DoSFilter / lockout) perlu whitelist IP MaM agar satu IP proxy tidak ikut terblokir; limiter MaM yang mengganti perannya.

Kalau `send_originating_ip = false`, semua prasyarat di atas opsional: login tetap jalan, hanya IP
yang tercatat di backend adalah IP proxy.

## Admin UI

- Halaman **Mail Proxy** (`/admin/mail`): status tiap listener, koneksi aktif, uptime, limit yang berlaku, dan statistik cache (entri, hit rate, file, TTL) plus tombol kosongkan cache. Auto refresh 10 detik.
- Sumber datanya `GET /api/admin/mail/status`.
- Statistik dan log per protokol, memakai log JSONL yang sudah ada.

## Rencana kerja

1. `mail/common.js`: config `[MAIL]`, listener TLS, limiter, logger, resolver, connector backend + unit test (vitest).
2. `mail/imap.js` + test parser (LOGIN, literal, AUTHENTICATE PLAIN, SASL-IR) dengan backend palsu.
3. `mail/pop3.js` + test.
4. `mail/smtp.js` + test (AUTH PLAIN/LOGIN, XCLIENT).
5. Integrasi ke `server.js`, `config.sample.ini`, `start.sh`, README.
6. Admin UI: status + statistik per protokol. ✅ (halaman `/admin/mail`, 2026-11-26)
7. Uji lab: MaM di Mac (port 10993/10995/10465), Thunderbird + `openssl s_client`. Backend:
   - `192.168.10.201` — Carbonio 26.9.2 (Advanced), domain `demo.aktiva.co.id`. Port 993/995/465 dipakai Switchboard; tidak disentuh.
   - `192.168.10.2` — `ce-rea.afatyo.com`, Carbonio CE (core 4.5.14), domain `afatyo.com`, `afatyo.id`.
   - `192.168.10.20` — `kizuna.afatyo.com`, Zimbra 10.1.21 Network Edition (Rocky 9). Dinyalakan user dulu.
8. Uji routing multi-backend (Carbonio + Zimbra; protokol `ID`/`XOIP`/`XCLIENT`/`AuthRequest` sama).
9. Security review kode. ✅ (putaran 1: squatting pra-login, tag kontrol, batas memori limiter, 2026-11-26)

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

## Hasil uji lab v1.1 (2026-11-26)

MaM dijalankan di Mac (127.0.0.1:10993/10995/10465), urutan backend `afatyo.com`: Zimbra 10.20 lalu Carbonio CE 10.2.
Akun `mamproxy-ce@afatyo.com` hanya ada di CE, jadi jalur fallback sekaligus memverifikasi cache.

| Uji | Hasil |
|---|---|
| IMAPS login pertama (cache kosong) | OK, `cache: miss`, `attempted: [MaMKey_1, MaMKey_2]`, 311 ms |
| POP3S setelah cache terisi | OK, `cache: hit`, `attempted: [MaMKey_2]`, 108 ms |
| SMTPS setelah cache terisi | OK, `cache: hit`, `attempted: [MaMKey_2]`, 122 ms |
| Restart MaM, lalu login | entri dibaca dari file cache, `cache: hit` |
| Cache sengaja diarahkan ke server yang salah | `cache: stale`, dicoba 2 server, sukses di `MaMKey_2`, cache diperbarui |
| Password salah dengan cache terisi | 13 s (tanpa cache 22 s), entri cache **tidak** dihapus |
| File cache | mode `0600`, isi `email → {server, at}` |
| `DELETE /api/admin/mail/cache` | `removed: 1`, file cache ikut dihapus |
| `GET /api/admin/mail/status` | listener, limit, dan statistik cache sesuai |

Catatan:
- Zimbra 10.20 sekarang menerima TLS lalu langsung menutup sesi IMAP (lisensi expired 2026-11-23),
  jadi login sukses ke Zimbra masih belum bisa diuji. Semua jalur cache di atas terbukti lewat CE.
- Angka 12 s/25 s dari uji sebelumnya muncul saat backend menahan jawaban gagal ~10 s. Dengan cache,
  login sukses turun ke ~0,2 s karena tidak ada lagi percobaan ke server yang salah.
- `send_originating_ip = false` di lab, karena IP MaM belum masuk `zimbraMailTrustedIP`/XCLIENT.

## Hasil uji deploy (2026-11-26, server khusus 192.168.13.120)

MaM dipasang sebagai service systemd di host sendiri (Ubuntu 26.04, `deploy/install.sh`), port asli
993/995/465, sertifikat self-signed `CN=ubuntu26`, CA backend diverifikasi lewat `ca_file`
(bukan `insecure_tls`). Backend: Zimbra 10.20 (`MaMKey_1`) lalu Carbonio CE 10.2 (`MaMKey_2`).

| Uji | Hasil |
|---|---|
| IMAPS LOGIN + SELECT + IDLE | OK, 202–294 ms |
| POP3S AUTH PLAIN + STAT | OK, 173 ms |
| SMTPS AUTH PLAIN | OK, 222 ms |
| TLS client | terverifikasi terhadap `certs/mail.crt` (SAN `DNS:ubuntu26`, `IP:192.168.13.120`) |
| Cache kosong | `cache: miss`, `attempted: [MaMKey_1, MaMKey_2]` |
| Cache terisi | `cache: hit`, `attempted: [MaMKey_2]` |
| `systemctl status mam-portal` | active, 3 listener + portal di 8080 |
| `GET /api/admin/mail/status` | listener, limit, cache sesuai |

### IP asli client: dua kali gagal sebelum benar

Target: `oip` di backend harus IP client (192.168.13.250), bukan IP MaM (192.168.13.120).

| Percobaan | Konfigurasi | `mailbox.log` | Hasil |
|---|---|---|---|
| 1 | 993/995 (nginx), IP MaM baru masuk `zimbraMailTrustedIP` | `ip=192.168.10.2;oip=192.168.13.120`, `via=MaM-Portal` | ID diterima tapi `oip` tetap IP proxy |
| 2 | sama, mailboxd direstart | tidak berubah | bukan soal cache config |
| 3 | `imap_port=7993`, `pop3_port=7995` (mailboxd langsung) | `ip=192.168.13.120;oip=192.168.13.250` | **benar** |

Jadi dua syaratnya: IP MaM di `zimbraMailTrustedIP` (plus restart mailboxd) **dan** menembak mailboxd,
bukan nginx. SMTP tidak kena masalah ini karena 465 sudah dilayani Postfix langsung, dan XCLIENT
langsung diterima setelah `smtpd_authorized_xclient_hosts` diisi.


## Nanti (setelah v1)

- Probe `GetAccountInfo` via admin SOAP untuk domain yang ada di dua server (menggantikan
tebakan urutan saat cache masih kosong).
- STARTTLS 143/110/587.
- SNI per domain (gabungan dengan pendekatan Switchboard) jika perlu banyak nama.
